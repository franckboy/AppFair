'use strict';

const express = require('express');
const { getRiskMatrixZones, calculateParetoAnalysis, calculateConsolidatedSensitivity } = require('../lib/register');
const { defaultRiskCriteria } = require('../data/profiles');

function createRegisterRouter(store) {
    const router = express.Router();

    // GET /api/register — lista todos los riesgos guardados + análisis consolidado
    router.get('/', (req, res) => {
        const risks = store.get('riskRegister') || [];
        const criteria = store.get('riskCriteria') || defaultRiskCriteria;

        if (risks.length === 0) {
            return res.json({ risks: [], pareto: null, consolidatedSensitivity: [], heatmapZones: getRiskMatrixZones(criteria.rrtBands) });
        }

        const pareto = calculateParetoAnalysis(risks);
        const consolidatedSensitivity = calculateConsolidatedSensitivity(risks);

        res.json({
            risks,
            pareto,
            consolidatedSensitivity,
            heatmapZones: getRiskMatrixZones(criteria.rrtBands),
        });
    });

    /**
     * PUT /api/register/:riskName — guarda o actualiza un riesgo en el registro.
     * Se llama normalmente justo después de un /api/simulate exitoso, con su
     * resultado. Body esperado: { asset, owner, ale, cvar95, evaluationLevel,
     * evaluationJustification, probExceedance, sensitivity, currency, aleCriticoUsado }
     */
    router.put('/:riskName', (req, res) => {
        const riskName = req.params.riskName;
        const criteria = store.get('riskCriteria') || defaultRiskCriteria;
        const {
            asset = '—', owner = '—', ale, cvar95, evaluationLevel, evaluationClasses,
            evaluationJustification, probExceedance = 0, sensitivity = [], currency = 'USD',
            securityPlan = '—',
        } = req.body;

        if (typeof ale !== 'number') {
            return res.status(400).json({ error: 'ale (número) es requerido.' });
        }

        const impactPercent = Math.max(0, Math.min(100, (ale / (criteria.aleCritico || 1)) * 100));

        const entry = {
            riskName, asset, owner, currency, ale, cvar95,
            evaluationLevel, evaluationClasses, evaluationJustification,
            impactPercent, probabilityPercent: probExceedance,
            sensitivity: sensitivity.slice(0, 5),
            securityPlan,
            date: new Date().toISOString(),
        };

        const register = store.upsertRiskInRegister(entry);
        res.json({ entry, totalRisks: register.length });
    });

    // DELETE /api/register/:riskName
    router.delete('/:riskName', (req, res) => {
        const register = store.deleteRiskFromRegister(req.params.riskName);
        res.json({ totalRisks: register.length });
    });

    return router;
}

module.exports = createRegisterRouter;
