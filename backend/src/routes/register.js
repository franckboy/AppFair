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
     * evaluationJustification, probExceedance, sensitivity, currency, securityPlan,
     * tef, vuln, lossMagnitudes, seed, riskType }
     */
    router.put('/:riskName', (req, res) => {
        const riskName = req.params.riskName;
        const criteria = store.get('riskCriteria') || defaultRiskCriteria;
        const {
            asset = '—', owner = '—', ale, cvar95, evaluationLevel, evaluationClasses, severity = null,
            evaluationJustification, probExceedance = 0, sensitivity = [], currency = 'USD',
            securityPlan = '—',
            // tef/vuln/lossMagnitudes/seed son opcionales (un riesgo guardado antes de que
            // existiera esto no los trae) — se guardan tal cual para poder re-simular este
            // riesgo después desde el botón "Simular" del Registro, sin volver a pedirle los
            // datos al usuario. La reproducibilidad exacta la da la semilla (ver /api/simulate).
            tef = null, vuln = null, lossMagnitudes = null, seed = null,
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
        } = req.body;

        if (typeof ale !== 'number') {
            return res.status(400).json({ error: 'ale (número) es requerido.' });
        }

        const impactPercent = Math.max(0, Math.min(100, (ale / (criteria.aleCritico || 1)) * 100));

        const entry = {
            riskName, asset, owner, currency, ale, cvar95, riskType,
            evaluationLevel, evaluationClasses, severity, evaluationJustification,
            impactPercent, probabilityPercent: probExceedance,
            sensitivity: sensitivity.slice(0, 5),
            securityPlan,
            tef, vuln, lossMagnitudes, seed,
            sourceRiskId,
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
