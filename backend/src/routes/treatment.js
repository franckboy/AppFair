'use strict';

const express = require('express');
const { evaluateTreatmentStrategies } = require('../lib/treatment');

function makeCurrencyFormatter(currency = 'USD') {
    const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (value) => fmt.format(value);
}

function createTreatmentRouter() {
    const router = express.Router();

    /**
     * POST /api/treatment/evaluate
     * Body:
     *  - currentALE: number
     *  - annualLosses: number[] (opcional pero recomendado — necesario para un cálculo
     *    preciso de Transferir/Seguro; si no viene, se usa el ALE promedio como aproximación)
     *  - mitigar: { cost, reductionPercent, reliability, delayDays }
     *  - transferir: { premium, deductible, limit, unlimited, reliability, delayDays }
     *  - evitar: { cost, reliability, delayDays }
     *  - currency
     */
    router.post('/evaluate', (req, res) => {
        const {
            currentALE,
            annualLosses,
            mitigar = {}, transferir = {}, evitar = {},
            currency = 'USD',
        } = req.body;

        if (typeof currentALE !== 'number') {
            return res.status(400).json({ error: 'currentALE (número) es requerido — normalmente el promedio que devuelve /api/simulate.' });
        }

        const formatCurrency = makeCurrencyFormatter(currency);

        const result = evaluateTreatmentStrategies({
            currentALE,
            annualLosses,
            mitigar: { cost: mitigar.cost || 0, reductionPercent: mitigar.reductionPercent || 0, reliability: mitigar.reliability || 'media', delayDays: mitigar.delayDays || 0 },
            transferir: { premium: transferir.premium || 0, deductible: transferir.deductible || 0, limit: transferir.limit || 0, unlimited: !!transferir.unlimited, reliability: transferir.reliability || 'media', delayDays: transferir.delayDays || 0 },
            evitar: { cost: evitar.cost || 0, reliability: evitar.reliability || 'alta', delayDays: evitar.delayDays || 0 },
        }, formatCurrency);

        res.json(result);
    });

    return router;
}

module.exports = createTreatmentRouter;
