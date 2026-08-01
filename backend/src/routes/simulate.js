'use strict';

const express = require('express');
const { runMonteCarloSimulation, summarizeLosses } = require('../lib/simulation');
const { evaluateFairThreat, evaluateFairOpportunity } = require('../lib/evaluation');
const { defaultRiskCriteria, lossFormsKeys } = require('../data/profiles');
const { validateTriangularRange, validateIterations, validateSeed } = require('../lib/validate');

function makeCurrencyFormatter(currency = 'USD') {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
     *  - currency: 'USD' | 'EUR' | 'MXN' | ...
     *  - riskCriteria: (opcional) sobreescribe los criterios guardados para esta corrida
     */
    router.post('/', (req, res) => {
        const {
            iterations = 10000,
            seed = 0,
            tef,
            vuln,
            lossMagnitudes = {},
            riskType = 'amenaza',
            currency = 'USD',
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
            return res.status(400).json({ error: `Categorías de pérdida no reconocidas: ${invalidKeys.join(', ')}` });
        }
        for (const [key, range] of Object.entries(lossMagnitudes)) {
            const lmError = validateTriangularRange(range, `lossMagnitudes.${key}`);
            if (lmError) return res.status(400).json({ error: lmError });
        }

        const criteria = riskCriteria || store.get('riskCriteria') || defaultRiskCriteria;
        const formatCurrency = makeCurrencyFormatter(currency);

        const { annualLosses, usedSeed, sensitivity } = runMonteCarloSimulation({
            iterations, seed, tef, vuln, lossMagnitudes,
        });

        const summary = summarizeLosses(annualLosses, criteria.aleUmbralExcedencia);

        const evaluation = riskType === 'oportunidad'
            ? evaluateFairOpportunity(summary.average, criteria, formatCurrency)
            : evaluateFairThreat(summary.average, summary.cvar95, criteria, formatCurrency);

        res.json({
            usedSeed,
            iterations,
            currency,
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
    });

    return router;
}

module.exports = createSimulateRouter;
