'use strict';

const express = require('express');
const { attackerProfiles, defenseProfiles, riskProfiles, riskCatalog, lossFormsKeys, lossFormsLabels, defaultRiskCriteria } = require('../data/profiles');
const { asyncHandler } = require('../middleware/asyncHandler');

function createConfigRouter(store) {
    const router = express.Router();

    // --- Perfiles y catálogos (de solo lectura, vienen del código, no de la base) ---
    router.get('/profiles', (req, res) => {
        res.json({ attackerProfiles, defenseProfiles, riskProfiles, riskCatalog, lossFormsKeys, lossFormsLabels });
    });

    // --- Criterios de Riesgo (Contexto — ISO 31000, 6.3.4) ---
    router.get('/criteria', asyncHandler(async (req, res) => {
        const criteria = (await store.get('riskCriteria')) || defaultRiskCriteria;
        res.json(criteria);
    }));

    router.put('/criteria', asyncHandler(async (req, res) => {
        const { rrtBands, aleAceptable, aleCritico, aleUmbralExcedencia } = req.body;

        if (!rrtBands || !(rrtBands.medio < rrtBands.alto && rrtBands.alto < rrtBands.critico)) {
            return res.status(400).json({ error: 'Los umbrales de Riesgo Residual deben ser crecientes: Medio < Alto < Crítico.' });
        }
        if (typeof aleAceptable !== 'number' || typeof aleCritico !== 'number' || !(aleAceptable < aleCritico)) {
            return res.status(400).json({ error: 'El ALE Aceptable debe ser menor que el ALE Crítico.' });
        }

        const criteria = { rrtBands, aleAceptable, aleCritico, aleUmbralExcedencia: aleUmbralExcedencia || 0 };
        await store.set('riskCriteria', criteria);
        res.json(criteria);
    }));

    // --- Valores por Defecto de la organización ---
    router.get('/org-defaults', asyncHandler(async (req, res) => {
        res.json(await store.get('orgDefaults'));
    }));

    router.put('/org-defaults', asyncHandler(async (req, res) => {
        const current = await store.get('orgDefaults');
        const updated = { ...current, ...req.body };
        await store.set('orgDefaults', updated);
        res.json(updated);
    }));

    // --- Contexto Organizacional (RIMS RA.1-2015, 5.2 / ISO 28001) ---
    router.get('/org-context', asyncHandler(async (req, res) => {
        res.json(await store.get('orgContext'));
    }));

    router.put('/org-context', asyncHandler(async (req, res) => {
        const current = await store.get('orgContext');
        const updated = { ...current, ...req.body };
        await store.set('orgContext', updated);
        res.json(updated);
    }));

    return router;
}

module.exports = createConfigRouter;
