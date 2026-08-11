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
 *
 * Los riesgos tipo 'oportunidad' (riesgo positivo) se excluyen: su "ale" es en
 * realidad un beneficio esperado, no una pérdida — sumarlo a la "exposición
 * total" o hacerlo competir por el 80% de "prioriza el tratamiento aquí" no
 * tiene sentido (un beneficio grande no es más urgente de tratar, es al revés,
 * más deseable de perseguir). Los riesgos guardados antes de que existiera el
 * campo riskType no tienen ese dato — se tratan como 'amenaza' (su
 * comportamiento actual), no se excluyen.
 * @param {Array<{riskName:string, ale:number, riskType?:string}>} risks
 */
function calculateParetoAnalysis(risks) {
    const threats = risks.filter((r) => r.riskType !== 'oportunidad');
    const sorted = [...threats].sort((a, b) => b.ale - a.ale);
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
 * @param {Array<{sensitivity: Array<{key?:string, name:string, correlation:number}>}>} risks
 * @param {number} [topN=8]
 */
function calculateConsolidatedSensitivity(risks, topN = 8) {
    const totals = {};
    risks.forEach((risk) => {
        (risk.sensitivity || []).forEach((s) => {
            // key es el identificador estable (ver simulation.js); un riesgo guardado antes de
            // que existiera ese campo solo trae name, así que se usa como respaldo — sigue
            // agrupando bien porque name siempre fue estable para un mismo factor.
            const groupKey = s.key || s.name;
            if (!totals[groupKey]) totals[groupKey] = { key: s.key, name: s.name, sum: 0, count: 0 };
            totals[groupKey].sum += Math.abs(s.correlation);
            totals[groupKey].count += 1;
        });
    });

    return Object.values(totals)
        .map(({ key, name, sum, count }) => ({ key, name, averageCorrelation: sum / count }))
        .sort((a, b) => b.averageCorrelation - a.averageCorrelation)
        .slice(0, topN);
}

/**
 * Riesgo Residual del Portafolio: agrega el ALE/CVaR VIGENTE de cada riesgo tipo Amenaza —
 * el residual de su treatmentDecision si ya adoptó una estrategia (ver
 * App.RiskManagement.renderResidualStatus, mismo criterio aplicado ahí riesgo por riesgo), o el
 * ALE/CVaR inherente si todavía no decidió nada. Mismo filtro que calculateParetoAnalysis
 * (excluye 'oportunidad' — su ale es un beneficio, no una pérdida, no pertenece a un total de
 * exposición).
 *
 * El CVaR95 total es una aproximación CONSERVADORA, no un valor exacto: CVaR95 es una medida de
 * riesgo coherente, por lo que es subaditiva (CVaR de la suma <= suma de los CVaR individuales)
 * salvo en el caso especial de dependencia perfecta. Sumar los CVaR95 de riesgos independientes
 * sobreestima la cola real del portafolio — nunca la subestima — así que sigue siendo seguro
 * usarlo como cota superior, pero no se debe presentar como "el CVaR95 real del portafolio".
 *
 * No todas las decisiones tienen residualCVaR (ej. Transferir no lo calcula — ver
 * evaluateTreatmentStrategies) — esos riesgos se excluyen de la suma de CVaR (cvarSkippedCount)
 * pero SÍ entran en la suma de ALE, que sí está siempre disponible.
 * @param {Array<{riskType?:string, ale:number, cvar95?:number, treatmentDecision?:{residualALE:number, residualCVaR?:number}|null}>} risks
 */
function calculateResidualPortfolio(risks) {
    const threats = risks.filter((r) => r.riskType !== 'oportunidad');

    let totalResidualALE = 0;
    let totalResidualCVaR = 0;
    let cvarRiskCount = 0;
    let cvarSkippedCount = 0;
    let treatedCount = 0;

    threats.forEach((r) => {
        const decision = r.treatmentDecision;
        const residualALE = decision ? decision.residualALE : r.ale;
        totalResidualALE += residualALE;
        if (decision) treatedCount += 1;

        const residualCVaR = decision ? decision.residualCVaR : r.cvar95;
        if (typeof residualCVaR === 'number') {
            totalResidualCVaR += residualCVaR;
            cvarRiskCount += 1;
        } else {
            cvarSkippedCount += 1;
        }
    });

    return {
        totalResidualALE,
        totalResidualCVaR: cvarRiskCount > 0 ? totalResidualCVaR : null,
        cvarRiskCount,
        cvarSkippedCount,
        treatedCount,
        untreatedCount: threats.length - treatedCount,
        totalRiskCount: threats.length,
    };
}

module.exports = {
    getRiskMatrixZones,
    calculateParetoAnalysis,
    calculateConsolidatedSensitivity,
    calculateResidualPortfolio,
};
