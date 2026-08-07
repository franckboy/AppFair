'use strict';

const express = require('express');
const { runMonteCarloSimulation, summarizeLosses } = require('../lib/simulation');
const { evaluateFairThreat, evaluateFairOpportunity } = require('../lib/evaluation');
const { defaultRiskCriteria, lossFormsKeys } = require('../data/profiles');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../lib/riskCriteria');
const { validateTriangularRange, validateIterations, validateSeed } = require('../lib/validate');
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
     *  - vuln: { min, mode, max }  (en %, 0-100)
     *  - lossMagnitudes: { [key]: { min, mode, max } }  — claves de lossFormsKeys
     *  - riskType: 'amenaza' | 'oportunidad'
     *  - riskCriteria: (opcional) sobreescribe los criterios guardados para esta corrida
     */
    router.post(
        '/',
        asyncHandler(async (req, res) => {
            const {
                iterations = 10000,
                seed = 0,
                tef,
                vuln,
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

            const invalidKeys = Object.keys(lossMagnitudes).filter((k) => !lossFormsKeys.includes(k));
            if (invalidKeys.length > 0) {
                return res
                    .status(400)
                    .json({ error: `Categorías de pérdida no reconocidas: ${invalidKeys.join(', ')}` });
            }
            for (const [key, range] of Object.entries(lossMagnitudes)) {
                const lmError = validateTriangularRange(range, `lossMagnitudes.${key}`);
                if (lmError) return res.status(400).json({ error: lmError });
            }

            // riskCriteria (si viene) es un override explícito para ESTA corrida — se valida
            // antes de usarlo porque, a diferencia de PUT /api/config/criteria, nada más lo
            // revisa (ver validateRiskCriteriaOverride). normalizeRiskCriteria además migra
            // cualquier criterio guardado ANTES de que existiera aleAceptablePercent (formato
            // viejo, en dólares) — sin eso, aleAceptable sale NaN y todo se clasifica como
            // "Aceptable" en silencio, sin importar la severidad real.
            const overrideError = validateRiskCriteriaOverride(riskCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            const criteria = normalizeRiskCriteria(
                riskCriteria || (await store.get('riskCriteria')) || defaultRiskCriteria,
            );
            const formatCurrency = makeCurrencyFormatter();

            const { annualLosses, usedSeed, sensitivity } = runMonteCarloSimulation({
                iterations,
                seed,
                tef,
                vuln,
                lossMagnitudes,
            });

            const summary = summarizeLosses(annualLosses, criteria.aleUmbralExcedencia);

            const evaluation =
                riskType === 'oportunidad'
                    ? evaluateFairOpportunity(summary.average, criteria, formatCurrency)
                    : evaluateFairThreat(summary.average, summary.cvar95, criteria, formatCurrency);

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
                },
                evaluation,
                sensitivity: sensitivity.slice(0, 10),
                // El arreglo completo de pérdidas se regresa aparte (puede ser grande) para que el
                // cliente decida si lo necesita, ej. para la estrategia de Transferir/Seguro.
                annualLosses,
            });
        }),
    );

    return router;
}

module.exports = createSimulateRouter;
