'use strict';

const express = require('express');
const { evaluateTreatmentStrategies } = require('../lib/treatment');
const { validateTreatmentBody } = require('../lib/validate');

// La app solo calcula en USD (ver la nota equivalente en register.js/assets.js).
function makeCurrencyFormatter() {
    const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return (value) => fmt.format(value);
}

function createTreatmentRouter() {
    const router = express.Router();

    /**
     * POST /api/treatment/evaluate
     * Body:
     *  - currentALE: number
     *  - currentCVaR: number (opcional — habilita residualCVaR en Mitigar/Evitar/Aceptar, ver
     *    evaluateTreatmentStrategies)
     *  - annualLosses: number[] (opcional pero recomendado — necesario para un cálculo
     *    preciso de Transferir/Seguro; si no viene, se usa el ALE promedio como aproximación)
     *  - mitigar: { cost, reductionPercent, reliability, delayDays }
     *  - transferir: { premium, deductible, limit, unlimited, reliability, delayDays }
     *  - evitar: { cost, reliability, delayDays }
     */
    router.post('/evaluate', (req, res) => {
        const { currentALE, currentCVaR, annualLosses, mitigar = {}, transferir = {}, evitar = {} } = req.body;

        if (typeof currentALE !== 'number') {
            return res.status(400).json({
                error: 'currentALE (número) es requerido — normalmente el promedio que devuelve /api/simulate.',
            });
        }

        const treatmentError = validateTreatmentBody(req.body);
        if (treatmentError) return res.status(400).json({ error: treatmentError });

        const formatCurrency = makeCurrencyFormatter();

        const result = evaluateTreatmentStrategies(
            {
                currentALE,
                currentCVaR,
                annualLosses,
                mitigar: {
                    cost: mitigar.cost || 0,
                    reductionPercent: mitigar.reductionPercent || 0,
                    // Residual REAL (re-simulado con el Nivel de Defensa Objetivo) — opcional, ver
                    // evaluateTreatmentStrategies. `typeof x === 'number'` en vez de `|| null`
                    // porque 0 es un residualALE válido (defensa perfecta) y no debe caer al `||`.
                    residualALE: typeof mitigar.residualALE === 'number' ? mitigar.residualALE : undefined,
                    residualCVaR: typeof mitigar.residualCVaR === 'number' ? mitigar.residualCVaR : undefined,
                    reliability: mitigar.reliability || 'media',
                    delayDays: mitigar.delayDays || 0,
                },
                transferir: {
                    premium: transferir.premium || 0,
                    deductible: transferir.deductible || 0,
                    limit: transferir.limit || 0,
                    unlimited: !!transferir.unlimited,
                    reliability: transferir.reliability || 'media',
                    delayDays: transferir.delayDays || 0,
                },
                evitar: {
                    cost: evitar.cost || 0,
                    reliability: evitar.reliability || 'alta',
                    delayDays: evitar.delayDays || 0,
                },
            },
            formatCurrency,
        );

        res.json(result);
    });

    return router;
}

module.exports = createTreatmentRouter;
