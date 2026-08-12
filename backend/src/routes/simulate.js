'use strict';

const express = require('express');
const { runMonteCarloSimulation, summarizeLosses } = require('../lib/simulation');
const { evaluateFairThreat, evaluateFairOpportunity } = require('../lib/evaluation');
const { sampleVulnerabilityFromProfiles, calculateInherentRiskFromSimulation } = require('../lib/autocalc');
const { defaultRiskCriteria, lossFormsKeys, attackerProfiles, defenseProfiles } = require('../data/profiles');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../lib/riskCriteria');
const {
    validateTriangularRange,
    validateIterations,
    validateSeed,
    validateLossMagnitudes,
} = require('../lib/validate');
const { asyncHandler } = require('../middleware/asyncHandler');

// La app solo calcula en USD (ver la nota equivalente en register.js/assets.js) — no toma
// moneda del body, para no reabrir la puerta a mezclar monedas sin convertir en el Pareto/mapa
// de calor consolidado.
function makeCurrencyFormatter() {
    const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return (value) => fmt.format(value);
}

function createSimulateRouter(store) {
    const router = express.Router();

    /**
     * POST /api/simulate
     * Body:
     *  - iterations: number (default 10000)
     *  - seed: number (0 = aleatoria)
     *  - tef: { min, mode, max }
     *  - vuln: { min, mode, max }  (en %, 0-100) — sigue siendo obligatorio (ver sampleVuln en
     *    runMonteCarloSimulation) aunque no se use para muestrear cuando aplica el camino nuevo
     *    de abajo, para no tener que tocar esta validación.
     *  - attackerKey, defenseKey, confidence, vulnManualOverride: (opcionales) si vienen los
     *    tres primeros Y vulnManualOverride no es true, la Vulnerabilidad se SIMULA por
     *    iteración (Capacidad de Amenaza vs. Fuerza de Resistencia, ver
     *    sampleVulnerabilityFromProfiles en lib/autocalc.js) en vez de muestrear del `vuln` fijo
     *    de arriba. Sin ellos (riesgos guardados antes de este cambio, o con Vulnerabilidad
     *    editada a mano), cae al camino de siempre — retrocompatible al 100%.
     *  - lossMagnitudes: { [key]: { min, mode, max } }  — claves de lossFormsKeys
     *  - riskType: 'amenaza' | 'oportunidad'
     *  - riskCriteria: (opcional) sobreescribe los criterios guardados para esta corrida
     *
     * La respuesta incluye `summary.inherentALE`/`summary.inherentCVaR` — el Riesgo Inherente
     * REAL (Vulnerabilidad 100%, sin ningún control), re-simulado con
     * calculateInherentRiskFromSimulation (lib/autocalc.js), NO una aproximación algebraica.
     * `null` para riskType 'oportunidad' (una Oportunidad es un beneficio esperado, no una
     * pérdida — no tiene un "Riesgo Inherente" con el mismo sentido, mismo criterio que ya
     * excluye 'oportunidad' de calculateParetoAnalysis/calculateResidualPortfolio).
     */
    router.post(
        '/',
        asyncHandler(async (req, res) => {
            const {
                iterations = 10000,
                seed = 0,
                tef,
                vuln,
                attackerKey,
                defenseKey,
                confidence = 'medio',
                vulnManualOverride = false,
                lossMagnitudes = {},
                riskType = 'amenaza',
                riskCriteria,
            } = req.body;

            const iterationsError = validateIterations(iterations);
            if (iterationsError) return res.status(400).json({ error: iterationsError });

            const seedError = validateSeed(seed);
            if (seedError) return res.status(400).json({ error: seedError });

            const tefError = validateTriangularRange(tef, 'tef');
            if (tefError) return res.status(400).json({ error: tefError });

            const vulnError = validateTriangularRange(vuln, 'vuln', { min: 0, max: 100 });
            if (vulnError) return res.status(400).json({ error: vulnError });

            const lossMagnitudesError = validateLossMagnitudes(lossMagnitudes, lossFormsKeys);
            if (lossMagnitudesError) return res.status(400).json({ error: lossMagnitudesError });

            // Si vienen attackerKey/defenseKey, deben ser válidos (400 si no) — a diferencia de
            // cuando faltan del todo (undefined), que es el caso normal de retrocompatibilidad y
            // simplemente cae al camino legado, esto es un error real del cliente.
            let sampleVuln;
            if (attackerKey !== undefined || defenseKey !== undefined) {
                const attackerProfile = attackerProfiles[attackerKey];
                const defenseProfile = defenseProfiles[defenseKey];
                if (!attackerProfile || !defenseProfile) {
                    return res.status(400).json({ error: 'attackerKey o defenseKey inválido.' });
                }
                if (!vulnManualOverride) {
                    sampleVuln = sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence);
                }
            }

            // El global se resuelve SIEMPRE (haya o no override) porque validateRiskCriteriaOverride
            // necesita el ALE Crítico global real para exigir que un override individual nunca lo
            // supere ("mi máximo global es $1M, pero para este riesgo mi máximo es $2M" se
            // contradice a sí mismo — el override solo puede ser igual o más restrictivo).
            // normalizeRiskCriteria migra cualquier criterio guardado ANTES de que existiera
            // aleAceptablePercent (formato viejo, en dólares) — sin eso, aleAceptable sale NaN y
            // todo se clasifica como "Aceptable" en silencio, sin importar la severidad real.
            const globalCriteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);

            // riskCriteria (si viene) es un override explícito para ESTA corrida — se valida
            // antes de usarlo porque, a diferencia de PUT /api/config/criteria, nada más lo
            // revisa (ver validateRiskCriteriaOverride).
            const overrideError = validateRiskCriteriaOverride(riskCriteria, globalCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            const criteria = normalizeRiskCriteria(riskCriteria || globalCriteria);
            const formatCurrency = makeCurrencyFormatter();

            const { annualLosses, usedSeed, sensitivity } = runMonteCarloSimulation({
                iterations,
                seed,
                tef,
                vuln,
                lossMagnitudes,
                sampleVuln,
            });

            const summary = summarizeLosses(annualLosses, criteria.aleUmbralExcedencia);

            const evaluation =
                riskType === 'oportunidad'
                    ? evaluateFairOpportunity(summary.average, criteria, formatCurrency)
                    : evaluateFairThreat(summary.average, summary.cvar95, criteria, formatCurrency);

            // Riesgo Inherente REAL (sin ningún control) — solo tiene sentido para Amenaza, mismo
            // criterio que evaluateFairOpportunity/evaluateFairThreat de arriba.
            const inherent =
                riskType === 'oportunidad'
                    ? { inherentALE: null, inherentCVaR: null }
                    : calculateInherentRiskFromSimulation(tef, lossMagnitudes);

            // Clasifica el Riesgo Inherente contra los MISMOS Criterios de Riesgo que ya
            // clasifican el actual (evaluateFairThreat) — bug real corregido: antes esto se
            // reimplementaba en el frontend (App.FairRegister.classifyAleAgainstCriteria), una
            // copia que solo miraba `ale` y nunca `cvar95` — así que el caso de "Crítico por cola
            // de riesgo" (cvar95 > aleCritico aunque ale no lo supere, ver evaluateFairThreat más
            // arriba) podía clasificar el Inherente de forma más optimista de lo real. Se calcula
            // una sola vez aquí y se persiste (ver PUT /api/register), para que el frontend nunca
            // tenga que reimplementar el banding — misma filosofía que POST /api/simulate/evaluate.
            const inherentEvaluation =
                riskType === 'oportunidad'
                    ? null
                    : evaluateFairThreat(inherent.inherentALE, inherent.inherentCVaR, criteria, formatCurrency);

            res.json({
                usedSeed,
                iterations,
                currency: 'USD',
                riskType,
                summary: {
                    average: summary.average,
                    median: summary.median,
                    min: summary.min,
                    max: summary.max,
                    p90: summary.p90,
                    cvar95: summary.cvar95,
                    probExceedance: summary.probExceedance,
                    exceedanceThreshold: criteria.aleUmbralExcedencia,
                    inherentALE: inherent.inherentALE,
                    inherentCVaR: inherent.inherentCVaR,
                },
                evaluation,
                // Clasificación del Riesgo Inherente (ver el comentario junto a inherentEvaluation
                // arriba) — null para Oportunidad, igual que inherentALE/inherentCVaR.
                inherentEvaluation,
                sensitivity: sensitivity.slice(0, 10),
                // El arreglo completo de pérdidas se regresa aparte (puede ser grande) para que el
                // cliente decida si lo necesita, ej. para la estrategia de Transferir/Seguro.
                annualLosses,
            });
        }),
    );

    /**
     * POST /api/simulate/evaluate — clasifica un ALE/CVaR95 YA CONOCIDO contra los Criterios de
     * Riesgo, sin volver a correr Monte Carlo. Pensado para reclasificar el Residual Canónico de
     * un riesgo ya tratado (ver App.RiskManagement.renderResidualStatus, Gestión de Riesgos) —
     * misma lógica de evaluateFairThreat que ya usa POST /api/simulate para el riesgo inherente,
     * nunca reimplementada en el frontend (una sola fuente de verdad para los umbrales).
     * Body: { ale: number, cvar95: number, riskCriteriaOverride: (opcional) }
     */
    router.post(
        '/evaluate',
        asyncHandler(async (req, res) => {
            const { ale, cvar95, riskCriteriaOverride } = req.body;

            if (typeof ale !== 'number' || typeof cvar95 !== 'number') {
                return res.status(400).json({ error: 'ale y cvar95 (números) son requeridos.' });
            }

            const globalCriteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);
            const overrideError = validateRiskCriteriaOverride(riskCriteriaOverride, globalCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            // riskCriteriaOverride es PARCIAL (solo aleAceptablePercent/aleCritico propios de
            // este riesgo, ver entry.riskCriteriaOverride en register.js) — se combina con el
            // global igual que ya hace PUT /api/register, nunca se reemplaza entero.
            const criteria = riskCriteriaOverride ? { ...globalCriteria, ...riskCriteriaOverride } : globalCriteria;
            const formatCurrency = makeCurrencyFormatter();

            res.json({ evaluation: evaluateFairThreat(ale, cvar95, criteria, formatCurrency) });
        }),
    );

    return router;
}

module.exports = createSimulateRouter;
