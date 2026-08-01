'use strict';

/**
 * Genera las zonas del mapa de calor 2D (Impacto x Probabilidad) a partir de
 * las bandas Alto/Crítico configuradas en los Criterios de Riesgo, en vez de
 * usar números fijos.
 * @param {{alto:number, critico:number}} rrtBands
 */
function getRiskMatrixZones(rrtBands) {
    const { alto, critico } = rrtBands;
    return [
        { level: 'Bajo', color: '#90EE90', x: [0, alto], y: [0, alto] },
        { level: 'Medio', color: '#FFD700', x: [alto, 100], y: [0, alto] },
        { level: 'Medio', color: '#FFD700', x: [0, alto], y: [alto, 100] },
        { level: 'Alto', color: '#FF8C00', x: [alto, 100], y: [alto, 100] },
        { level: 'Crítico', color: '#B22222', x: [critico, 100], y: [critico, 100] },
        { level: 'Alto', color: '#FF8C00', x: [critico, 100], y: [alto, critico] },
        { level: 'Alto', color: '#FF8C00', x: [alto, critico], y: [critico, 100] },
    ];
}

/**
 * Análisis 80-20 (Pareto): ordena los riesgos de mayor a menor ALE y calcula
 * el % acumulado, para saber cuántos riesgos concentran el 80% de la
 * exposición total.
 * @param {Array<{riskName:string, ale:number}>} risks
 */
function calculateParetoAnalysis(risks) {
    const sorted = [...risks].sort((a, b) => b.ale - a.ale);
    const total = sorted.reduce((sum, r) => sum + r.ale, 0);

    let running = 0;
    const withCumulative = sorted.map((r) => {
        running += r.ale;
        return { ...r, cumulativePercent: total > 0 ? (running / total) * 100 : 0 };
    });

    const idx80 = withCumulative.findIndex((r) => r.cumulativePercent >= 80);
    const count80 = idx80 === -1 ? sorted.length : idx80 + 1;

    return {
        risks: withCumulative,
        totalExposure: total,
        riskCountFor80Percent: count80,
        totalRiskCount: sorted.length,
    };
}

/**
 * Promedia la sensibilidad (|correlación|) de cada variable, considerando
 * todos los riesgos guardados en el registro.
 * @param {Array<{sensitivity: Array<{name:string, correlation:number}>}>} risks
 * @param {number} [topN=8]
 */
function calculateConsolidatedSensitivity(risks, topN = 8) {
    const totals = {};
    risks.forEach((risk) => {
        (risk.sensitivity || []).forEach((s) => {
            if (!totals[s.name]) totals[s.name] = { sum: 0, count: 0 };
            totals[s.name].sum += Math.abs(s.correlation);
            totals[s.name].count += 1;
        });
    });

    return Object.entries(totals)
        .map(([name, v]) => ({ name, averageCorrelation: v.sum / v.count }))
        .sort((a, b) => b.averageCorrelation - a.averageCorrelation)
        .slice(0, topN);
}

module.exports = { getRiskMatrixZones, calculateParetoAnalysis, calculateConsolidatedSensitivity };
