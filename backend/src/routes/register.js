'use strict';

const express = require('express');
const { getRiskMatrixZones, calculateParetoAnalysis, calculateConsolidatedSensitivity } = require('../lib/register');
const { defaultRiskCriteria } = require('../data/profiles');
const { asyncHandler } = require('../middleware/asyncHandler');

function createRegisterRouter(store) {
    const router = express.Router();

    // GET /api/register — lista todos los riesgos guardados + análisis consolidado
    router.get(
        '/',
        asyncHandler(async (req, res) => {
            const risks = (await store.get('riskRegister')) || [];
            const criteria = (await store.get('riskCriteria')) || defaultRiskCriteria;

            if (risks.length === 0) {
                return res.json({
                    risks: [],
                    pareto: null,
                    consolidatedSensitivity: [],
                    heatmapZones: getRiskMatrixZones(criteria.rrtBands),
                });
            }

            const pareto = calculateParetoAnalysis(risks);
            const consolidatedSensitivity = calculateConsolidatedSensitivity(risks);

            res.json({
                risks,
                pareto,
                consolidatedSensitivity,
                heatmapZones: getRiskMatrixZones(criteria.rrtBands),
            });
        }),
    );

    /**
     * PUT /api/register/:riskName — guarda o actualiza un riesgo en el registro.
     * Se llama normalmente justo después de un /api/simulate exitoso, con su
     * resultado. Body esperado: { asset, owner, ale, cvar95, evaluationLevel,
     * evaluationJustification, probExceedance, sensitivity, securityPlan,
     * tef, vuln, lossMagnitudes, seed, riskType }
     */
    router.put(
        '/:riskName',
        asyncHandler(async (req, res) => {
            const riskName = req.params.riskName;
            const criteria = (await store.get('riskCriteria')) || defaultRiskCriteria;
            const {
                asset = '—',
                // Vínculo real hacia el Catálogo de Activos (/api/assets), a diferencia de
                // `asset` (arriba), que es solo el nombre copiado en el momento de guardar —
                // permite reconocer qué riesgos referencian a un activo aunque el activo
                // cambie de nombre después. null si el riesgo no se armó desde el catálogo.
                assetId = null,
                owner = '—',
                ale,
                cvar95,
                evaluationLevel,
                evaluationClasses,
                severity = null,
                evaluationJustification,
                probExceedance = 0,
                sensitivity = [],
                // Resto del resumen de la simulación (antes solo se leía del DOM en el momento del
                // reporte individual) — necesarios para reconstruir la tabla de resultados completa
                // de cualquier riesgo del Registro, no solo ale/cvar95.
                median = null,
                min = null,
                max = null,
                p90 = null,
                securityPlan = '—',
                // tef/vuln/lossMagnitudes/seed son opcionales (un riesgo guardado antes de que
                // existiera esto no los trae) — se guardan tal cual para poder re-simular este
                // riesgo después desde el botón "Simular" del Registro, sin volver a pedirle los
                // datos al usuario. La reproducibilidad exacta la da la semilla (ver /api/simulate).
                tef = null,
                vuln = null,
                lossMagnitudes = null,
                seed = null,
                // Antes no se guardaba nada: cada riesgo quedaba asumido como 'amenaza' para
                // siempre, sin importar qué se eligió en el wizard. Una 'oportunidad' (riesgo
                // positivo — su "ale" es en realidad un BENEFICIO esperado, no una pérdida) mezclada
                // sin distinguir en el Pareto/mapa de calor (que asumen "más alto = más urgente
                // tratar") terminaba graficada en la esquina "Crítico" y sumada a la "exposición
                // total", como si un beneficio grande fuera el peor riesgo del portafolio — ver
                // calculateParetoAnalysis, que ahora excluye 'oportunidad' de esa suma.
                riskType = 'amenaza',
                // Vínculo opcional hacia el riesgo de origen en /api/risks (Análisis Rápido) — permite
                // a la tabla concentrada del Registro reconocer que esta entrada FAIR es la
                // continuación del mismo riesgo, en vez de mostrarlo como dos filas separadas.
                sourceRiskId = null,
                // Apetito de Riesgo (Pérdida Anual Aceptable %/ALE Crítico) propio de este riesgo,
                // si el frontend definió uno para él (ver App.FairWizard.openCriteriaOverrideEditor)
                // — null usa los criterios globales de la organización, igual que antes de que
                // existiera esto. Afecta impactPercent (abajo), para que la posición de este riesgo
                // en la Matriz de Riesgos sea consistente con el criterio que en verdad se usó para
                // evaluarlo (ver POST /api/simulate, que ya acepta el mismo override para el cálculo).
                riskCriteriaOverride = null,
                // Riesgo en cascada: el nombre de OTRO riesgo del Registro que, de ocurrir,
                // desencadena este — ej. un incendio que desencadena una interrupción operativa. Se
                // referencia por riskName (no por id) porque el Registro mismo se identifica así en
                // todos lados (ver PUT/DELETE por :riskName) — es solo organizativo por ahora, no
                // alimenta ningún cálculo, así que una referencia por nombre es suficiente y
                // consistente con el resto de este archivo.
                triggeredByRiskName = null,
                description = null,
                // Id propio de esta entrada del Registro, si el cliente ya la conoce (re-simular un
                // riesgo cargado desde aquí — ver App.FairWizard.loadRegisteredRiskIntoForm). Junto
                // con sourceRiskId, es lo que le permite al store (ver findRegisterEntryIndex)
                // reconocer que esto es una ACTUALIZACIÓN de la misma entrada y no una nueva, sin
                // depender de que el nombre no haya cambiado ni de que sea único.
                id = null,
                // Todo lo de aquí abajo antes solo vivía en el formulario en pantalla (o en
                // localStorage) — el Reporte individual (PDF de un solo riesgo) lo leía directo del
                // DOM, así que un riesgo YA guardado en el Registro no tenía forma de reconstruir su
                // reporte completo después (por ejemplo, para el Informe Consolidado). Se guarda
                // aquí tal cual, sin validar cada campo uno por uno (mismo criterio que el resto de
                // este archivo) porque es información descriptiva, no un cálculo.
                threat = '—',
                effect = 'material',
                timeHorizon = '1',
                reviewDate = null,
                dataSource = null,
                dataConfidence = null,
                dataNotes = null,
                assessor = null,
                assessmentDate = null,
                assessmentLocation = null,
                attackerProfileName = null,
                attackerScore = null,
                defenseProfileName = null,
                defenseScore = null,
                // Identificadores internos (ej. 'estandar'), a diferencia de
                // attacker/defenseProfileName de arriba (solo el nombre para mostrar) — los
                // necesita la página de Tratamiento para poder recalcular "Reducción de ALE"
                // (POST /api/autocalc/reduccion-ale) sin depender de que el wizard siga abierto
                // con ese riesgo cargado.
                attackerKey = null,
                defenseKey = null,
                // Snapshot de las 4 estrategias de tratamiento (ISO 31000, 6.5) tal como estaban
                // configuradas al guardar — permite reconstruir la Sección 9 del reporte para
                // CUALQUIER riesgo del Registro, no solo el que esté abierto en el wizard.
                mitigar = null,
                transferir = null,
                evitar = null,
                aceptarJustificacion = null,
                // El histograma ya viene agrupado en barras (~20 valores) desde el frontend — no se
                // guardan los 10,000 resultados crudos de la simulación, solo lo necesario para
                // volver a dibujar el mismo gráfico en un reporte futuro.
                chartLabels = null,
                chartData = null,
            } = req.body;

            if (typeof ale !== 'number') {
                return res.status(400).json({ error: 'ale (número) es requerido.' });
            }

            const effectiveCriteria = riskCriteriaOverride ? { ...criteria, ...riskCriteriaOverride } : criteria;
            const impactPercent = Math.max(0, Math.min(100, (ale / (effectiveCriteria.aleCritico || 1)) * 100));

            const entry = {
                // La app solo calcula en USD — no es un default, es fijo (ver la nota equivalente
                // en assets.js). Eliminar la variable de moneda evita por construcción que el
                // Pareto/mapa de calor terminen sumando/comparando riesgos en monedas distintas.
                id,
                riskName,
                asset,
                assetId,
                owner,
                currency: 'USD',
                ale,
                cvar95,
                median,
                min,
                max,
                p90,
                riskType,
                evaluationLevel,
                evaluationClasses,
                severity,
                evaluationJustification,
                impactPercent,
                probabilityPercent: probExceedance,
                sensitivity: sensitivity.slice(0, 5),
                securityPlan,
                tef,
                vuln,
                lossMagnitudes,
                seed,
                sourceRiskId,
                riskCriteriaOverride,
                triggeredByRiskName,
                description,
                threat,
                effect,
                timeHorizon,
                reviewDate,
                dataSource,
                dataConfidence,
                dataNotes,
                assessor,
                assessmentDate,
                assessmentLocation,
                attackerProfileName,
                attackerScore,
                defenseProfileName,
                defenseScore,
                attackerKey,
                defenseKey,
                mitigar,
                transferir,
                evitar,
                aceptarJustificacion,
                chartLabels,
                chartData,
                date: new Date().toISOString(),
            };

            // upsertRiskInRegister muta `entry.id` en el sitio (le asigna el id existente o genera
            // uno nuevo) — por eso responder con `entry` tal cual ya trae el id correcto.
            const register = await store.upsertRiskInRegister(entry);
            res.json({ entry, totalRisks: register.length });
        }),
    );

    // DELETE /api/register/:riskName — sourceRiskId (o id) por query string, cuando el cliente
    // los conoce, para borrar la entrada correcta incluso si otro riesgo distinto comparte el
    // mismo riskName (ver findRegisterEntryIndex). Sin ninguno de los dos, cae al comportamiento
    // histórico (por riskName, solo para entradas sin sourceRiskId).
    router.delete(
        '/:riskName',
        asyncHandler(async (req, res) => {
            const { id = null, sourceRiskId = null } = req.query;
            const register = await store.deleteRiskFromRegister(req.params.riskName, { id, sourceRiskId });
            res.json({ totalRisks: register.length });
        }),
    );

    return router;
}

module.exports = createRegisterRouter;
