'use strict';

const express = require('express');
const {
    attackerProfiles,
    defenseProfiles,
    riskProfiles,
    riskCatalog,
    lossFormsKeys,
    lossFormsLabels,
    defaultRiskCriteria,
} = require('../data/profiles');
const { hazardStandards, isoProcessClauses, rimsClauses } = require('../data/standardsReference');
const { normalizeRiskCriteria } = require('../lib/riskCriteria');
const { CALIBRATION_VERSION, ACCESS_LEVELS } = require('../lib/autocalc');
const { DEFAULT_OUTSIDE_OPTION_FRACTION } = require('../lib/stackelbergDeterrence');
const { EXPOSURE_UNITS } = require('../lib/exposure');
const { normalizeIncidentLog, validateIncidentLog, summarizeIncidentLog } = require('../lib/incidentLog');
const { asyncHandler } = require('../middleware/asyncHandler');

function createConfigRouter(store) {
    const router = express.Router();

    // --- Perfiles y catálogos (de solo lectura, vienen del código, no de la base) ---
    router.get('/profiles', (req, res) => {
        res.json({
            attackerProfiles,
            defenseProfiles,
            riskProfiles,
            riskCatalog,
            lossFormsKeys,
            lossFormsLabels,
            // Catálogo de normas/marcos (ver data/standardsReference.js) — base para mostrar,
            // en la ficha de un riesgo, contra qué norma/punto del proceso se sustenta (todavía
            // sin conectar a ninguna tarjeta, ver esa conversación).
            hazardStandards,
            isoProcessClauses,
            rimsClauses,
            // Versión vigente del modelo de Vulnerabilidad (ver lib/autocalc.js). El frontend la
            // compara contra el sello guardado en cada riesgo para avisar cuáles se calcularon
            // con una calibración anterior. Se expone desde aquí, y no como constante duplicada
            // en el frontend, para que no puedan quedar desincronizadas.
            calibrationVersion: CALIBRATION_VERSION,
            // Alternativa del atacante por perfil (ver lib/stackelbergDeterrence.js): cuánto
            // consigue en OTRO objetivo, como fracción del botín de este. Es el parámetro del que
            // depende la disuasión entera, y es juicio declarado, no medición. Se expone desde
            // acá, y no como constante duplicada en el frontend, por el mismo motivo que
            // calibrationVersion: dos copias del mismo juicio se desincronizan sin que nadie se
            // entere, y esta manda sobre un número que después se lleva a un comité.
            outsideOptionFractions: DEFAULT_OUTSIDE_OPTION_FRACTION,
            // Las unidades de exposición las necesita el wizard (Paso 2), no solo la bitácora:
            // ahora el RIESGO también declara en cuál se mide (ver lib/exposure.js).
            exposureUnits: EXPOSURE_UNITS,
            // Niveles de Acceso / Proximidad, para poblar el selector del Paso 2 sin duplicar la
            // tabla en el frontend (misma razón que calibrationVersion).
            accessLevels: ACCESS_LEVELS,
        });
    });

    // --- Criterios de Riesgo (Contexto — ISO 31000, 6.3.4) ---
    router.get(
        '/criteria',
        asyncHandler(async (req, res) => {
            const stored = await store.get('riskCriteria');
            const criteria = normalizeRiskCriteria(stored || defaultRiskCriteria);
            // declared: false mientras nadie haya guardado sus propios criterios (todavía
            // corriendo sobre defaultRiskCriteria, un número de código que nadie eligió) — lo usa
            // el candado obligatorio de primer uso (ver App.Criteria.isComplete() en el frontend)
            // para no dejar clasificar riesgos contra un ALE Crítico que nadie declaró.
            res.json({ ...criteria, declared: !!stored });
        }),
    );

    router.put(
        '/criteria',
        asyncHandler(async (req, res) => {
            const { rrtBands, aleAceptablePercent, aleCritico, aleUmbralExcedencia } = req.body;

            if (!rrtBands || !(rrtBands.medio < rrtBands.alto && rrtBands.alto < rrtBands.critico)) {
                return res
                    .status(400)
                    .json({ error: 'Los umbrales de Riesgo Residual deben ser crecientes: Medio < Alto < Crítico.' });
            }
            if (
                typeof aleAceptablePercent !== 'number' ||
                aleAceptablePercent <= 0 ||
                aleAceptablePercent >= 100 ||
                typeof aleCritico !== 'number'
            ) {
                return res.status(400).json({ error: 'La Pérdida Anual Aceptable (%) debe estar entre 0 y 100.' });
            }

            const criteria = {
                rrtBands,
                aleAceptablePercent,
                aleCritico,
                aleUmbralExcedencia: aleUmbralExcedencia || 0,
            };
            await store.set('riskCriteria', criteria);
            // declared: true — igual que en el GET (ver ahí), para que el frontend sepa de
            // inmediato que ya no está corriendo sobre el default sin necesidad de otra llamada.
            res.json({ ...criteria, declared: true });
        }),
    );

    // --- Valores por Defecto de la organización ---
    router.get(
        '/org-defaults',
        asyncHandler(async (req, res) => {
            res.json(await store.get('orgDefaults'));
        }),
    );

    router.put(
        '/org-defaults',
        asyncHandler(async (req, res) => {
            // mergeConfig lee y escribe en un solo paso atómico — un store.get() + store.set()
            // sueltos acá (como antes) dejaban una ventana real de carrera en Postgres entre las
            // dos llamadas (ver PostgresStore.mergeConfig).
            const updated = await store.mergeConfig('orgDefaults', req.body);
            res.json(updated);
        }),
    );

    // --- Bitácora de Incidentes (ver lib/incidentLog.js) ---
    //
    // Lo único que puede CONTRADECIR al modelo. Todo lo demás que la app calcula sale de juicio
    // experto y referencias del sector: un prior alimenta, no falsea. Todavía no se mezcla con
    // nada — no hay ponderación por credibilidad ni cambia ninguna cifra del Registro. Es el
    // enchufe puesto antes de que llegue la corriente.
    router.get(
        '/incident-log',
        asyncHandler(async (req, res) => {
            const log = normalizeIncidentLog(await store.get('incidentLog'));
            // El diagnóstico se calcula al leer y no se persiste: depende del Registro, que cambia
            // por su cuenta. Un resumen guardado envejecería en silencio.
            const register = (await store.get('riskRegister')) || [];
            res.json({ ...log, exposureUnits: EXPOSURE_UNITS, summary: summarizeIncidentLog(log, register) });
        }),
    );

    router.put(
        '/incident-log',
        asyncHandler(async (req, res) => {
            const error = validateIncidentLog(req.body);
            if (error) return res.status(400).json({ error });
            const log = normalizeIncidentLog(req.body);
            log.actualizadoEn = new Date().toISOString();
            await store.set('incidentLog', log);
            const register = (await store.get('riskRegister')) || [];
            res.json({ ...log, exposureUnits: EXPOSURE_UNITS, summary: summarizeIncidentLog(log, register) });
        }),
    );

    // --- Contexto Organizacional (RIMS RA.1-2015, 5.2 / ISO 28001) ---
    router.get(
        '/org-context',
        asyncHandler(async (req, res) => {
            res.json(await store.get('orgContext'));
        }),
    );

    router.put(
        '/org-context',
        asyncHandler(async (req, res) => {
            const updated = await store.mergeConfig('orgContext', req.body);
            res.json(updated);
        }),
    );

    return router;
}

module.exports = createConfigRouter;
