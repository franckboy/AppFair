'use strict';

const express = require('express');
const { runFamilyCascadeSimulation } = require('../lib/cascadeSimulation');
const { summarizeLosses } = require('../lib/simulation');
const { evaluateFairThreat } = require('../lib/evaluation');
const { defaultRiskCriteria } = require('../data/profiles');
const { normalizeRiskCriteria } = require('../lib/riskCriteria');
const { validateIterations, validateSeed } = require('../lib/validate');
const { asyncHandler } = require('../middleware/asyncHandler');

function makeCurrencyFormatter() {
    const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return (value) => fmt.format(value);
}

function createCascadeRouter(store) {
    const router = express.Router();

    /**
     * POST /api/cascade/:riskName/simulate-family — simula, de forma correlacionada (misma
     * iteración Monte Carlo), la pérdida anual combinada de :riskName y todos sus descendientes
     * en el Árbol de Riesgos en Cascada (ver runFamilyCascadeSimulation en
     * lib/cascadeSimulation.js para el diseño completo). No cambia ni sustituye la simulación
     * individual de ningún riesgo — es una vista NUEVA, que el usuario dispara a propósito desde
     * "Simular Familia" en el árbol.
     *
     * Body:
     *  - iterations: number (default 10000)
     *  - seed: number (0 = aleatoria)
     */
    router.post(
        '/:riskName/simulate-family',
        asyncHandler(async (req, res) => {
            const rootRiskName = req.params.riskName;
            const { iterations = 10000, seed = 0 } = req.body;

            const iterationsError = validateIterations(iterations);
            if (iterationsError) return res.status(400).json({ error: iterationsError });

            const seedError = validateSeed(seed);
            if (seedError) return res.status(400).json({ error: seedError });

            const register = (await store.get('riskRegister')) || [];
            if (!register.some((r) => r.riskName === rootRiskName)) {
                return res.status(404).json({ error: `No se encontró "${rootRiskName}" en el Registro.` });
            }

            // La familia SIEMPRE se clasifica contra el Apetito de Riesgo GLOBAL de la
            // organización, nunca contra un override individual de alguno de sus miembros — un
            // override por riesgo sigue aplicando solo a la evaluación de ESE riesgo solo, no
            // existe un "apetito de familia" aparte (ver el plan de esta tarea).
            const criteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);
            const formatCurrency = makeCurrencyFormatter();

            let result;
            try {
                result = runFamilyCascadeSimulation({ rootRiskName, register, iterations, seed });
            } catch (err) {
                if (err.code === 'FAMILY_TOO_LARGE') {
                    return res.status(400).json({ error: err.message });
                }
                throw err;
            }

            const { familyAnnualLosses, usedSeed, familySize, includedRiskNames, excludedRiskNames, activationRates } =
                result;
            const summary = summarizeLosses(familyAnnualLosses, criteria.aleUmbralExcedencia);
            const evaluation = evaluateFairThreat(summary.average, summary.cvar95, criteria, formatCurrency);

            res.json({
                usedSeed,
                iterations,
                currency: 'USD',
                rootRiskName,
                familySize,
                includedRiskNames,
                excludedRiskNames,
                activationRates,
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
                annualLosses: familyAnnualLosses,
            });
        }),
    );

    return router;
}

module.exports = createCascadeRouter;
