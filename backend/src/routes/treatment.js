'use strict';

const express = require('express');
const { evaluateTreatmentStrategies } = require('../lib/treatment');
const { calculateResidualFromReduction } = require('../lib/autocalc');
const { validateTreatmentBody, validateTriangularRange, validateLossMagnitudes } = require('../lib/validate');
const { lossFormsKeys } = require('../data/profiles');

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
     *  - mitigar: { cost, reductionPercent, reliability, delayDays, residualALE, residualCVaR }
     *  - tef, vuln, lossMagnitudes: (opcionales) los inputs simulables del riesgo. Si vienen Y
     *    Mitigar no trae ya un residual re-simulado (modo manual: el usuario tecleó la Reducción
     *    de ALE en vez de elegir un Nivel de Defensa Objetivo), el residual de Mitigar se calcula
     *    corriendo Monte Carlo de verdad con la Vulnerabilidad escalada, en vez de suponer que la
     *    cola se reduce en la misma proporción que el promedio (ver calculateResidualFromReduction).
     *    Sin ellos se cae al escalado proporcional de siempre — retrocompatible.
     *  - seed: (opcional) la semilla de la corrida original del riesgo. Parea las dos corridas para
     *    que la diferencia sea el tratamiento y no el ruido de muestreo.
     *  - transferir: { premium, deductible, limit, unlimited, reliability, delayDays }
     *  - evitar: { cost, reliability, delayDays }
     */
    router.post('/evaluate', (req, res) => {
        const {
            currentALE,
            currentCVaR,
            annualLosses,
            mitigar = {},
            transferir = {},
            evitar = {},
            tef,
            vuln,
            lossMagnitudes,
            seed,
        } = req.body;

        if (typeof currentALE !== 'number') {
            return res.status(400).json({
                error: 'currentALE (número) es requerido — normalmente el promedio que devuelve /api/simulate.',
            });
        }

        const treatmentError = validateTreatmentBody(req.body);
        if (treatmentError) return res.status(400).json({ error: treatmentError });

        // Residual REAL para el modo MANUAL de Mitigar. En modo automático el frontend ya lo trae
        // re-simulado con el Nivel de Defensa Objetivo (POST /api/autocalc/reduccion-ale) y esto
        // no se toca; acá se cubre el único hueco que quedaba, donde el residual se deducía
        // multiplicando el CVaR actual por el mismo porcentaje que el ALE.
        const mitigarResuelto = { ...mitigar };
        const necesitaResidual =
            typeof mitigarResuelto.residualCVaR !== 'number' && (mitigarResuelto.reductionPercent || 0) > 0;
        if (necesitaResidual && tef && vuln && lossMagnitudes) {
            const rangeError =
                validateTriangularRange(tef, 'tef') ||
                validateTriangularRange(vuln, 'vuln', { min: 0, max: 100 }) ||
                validateLossMagnitudes(lossMagnitudes, lossFormsKeys);
            if (rangeError) return res.status(400).json({ error: rangeError });

            const residual = calculateResidualFromReduction({
                tef,
                vuln,
                lossMagnitudes,
                reductionPercent: mitigarResuelto.reductionPercent,
                currentALE,
                currentCVaR,
                seed,
                damageCap: mitigarResuelto.damageCap,
            });
            mitigarResuelto.residualALE = residual.residualALE;
            mitigarResuelto.residualCVaR = residual.residualCVaR;
            mitigarResuelto.residualLossExceedanceCurve = residual.residualLossExceedanceCurve;
        }

        const formatCurrency = makeCurrencyFormatter();

        const result = evaluateTreatmentStrategies(
            {
                currentALE,
                currentCVaR,
                annualLosses,
                mitigar: {
                    cost: mitigarResuelto.cost || 0,
                    reductionPercent: mitigarResuelto.reductionPercent || 0,
                    // Residual REAL (re-simulado con el Nivel de Defensa Objetivo) — opcional, ver
                    // evaluateTreatmentStrategies. `typeof x === 'number'` en vez de `|| null`
                    // porque 0 es un residualALE válido (defensa perfecta) y no debe caer al `||`.
                    residualALE:
                        typeof mitigarResuelto.residualALE === 'number' ? mitigarResuelto.residualALE : undefined,
                    residualCVaR:
                        typeof mitigarResuelto.residualCVaR === 'number' ? mitigarResuelto.residualCVaR : undefined,
                    residualLossExceedanceCurve: mitigarResuelto.residualLossExceedanceCurve,
                    reliability: mitigarResuelto.reliability || 'media',
                    delayDays: mitigarResuelto.delayDays || 0,
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
