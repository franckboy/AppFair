'use strict';

/**
 * Migra en LECTURA la forma vieja de "Riesgo Desencadenante" (`triggeredByRiskName`/
 * `triggeredByProbability`, un solo valor suelto) a la nueva (`triggeredBy`, un array — un
 * riesgo puede tener más de una causa) — mismo espíritu que normalizeRiskCriteria en
 * riskCriteria.js. Necesaria porque la app tiene despliegue real (ver README.md) con riesgos
 * ya guardados en la forma vieja; el PUT nunca necesita esto (las escrituras nuevas siempre
 * llegan ya con `triggeredBy`, por validación — ver routes/register.js).
 * @param {Array<Object>} register
 * @returns {Array<Object>}
 */
function normalizeTriggeredBy(register) {
    return register.map((r) => {
        if (Array.isArray(r.triggeredBy)) return r;
        if (r.triggeredByRiskName) {
            return {
                ...r,
                triggeredBy: [{ riskName: r.triggeredByRiskName, probability: r.triggeredByProbability ?? null }],
            };
        }
        return { ...r, triggeredBy: [] };
    });
}

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
 * ALE/CVaR ACTUAL (con el Nivel de Defensa vigente, `r.ale`/`r.cvar95` — NO el Riesgo Inherente
 * real sin controles, ver calculateInherentPortfolio más abajo) si todavía no decidió nada.
 * Mismo filtro que calculateParetoAnalysis
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
 *
 * `totalResidualCVaRFloor` existe por ese desfase: `totalResidualCVaR` cubre solo los riesgos con
 * CVaR conocido, mientras que `totalResidualALE` cubre TODOS — clasificar el portafolio cruzando
 * esos dos totales compara canastas distintas. Como el escalón de "Crítico por cola de riesgo"
 * (ver evaluateFairThreat) es lo ÚNICO que mira el CVaR, ese desfase solo puede fallar en una
 * dirección: dejar de marcar como Crítico un portafolio que sí lo es — o sea, SUBESTIMAR, que es
 * la dirección peligrosa en una herramienta de riesgo.
 *
 * El piso sustituye cada CVaR desconocido por el residualALE de ESE riesgo, y por eso cubre la
 * canasta completa. Es una sustitución conservadora y matemáticamente válida: el CVaR95 es el
 * promedio del peor 5% de los escenarios, así que nunca puede quedar por debajo del promedio
 * general (el ALE) de la misma distribución. Sigue siendo un piso, no el valor real — puede
 * quedarse corto — pero nunca menos que tratar el dato faltante como cero, que es lo que hacía
 * excluirlo de la suma.
 * @param {Array<{riskType?:string, ale:number, cvar95?:number, treatmentDecision?:{residualALE:number, residualCVaR?:number}|null}>} risks
 */
function calculateResidualPortfolio(risks) {
    const threats = risks.filter((r) => r.riskType !== 'oportunidad');

    let totalResidualALE = 0;
    let totalResidualCVaR = 0;
    let totalResidualCVaRFloor = 0;
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
            totalResidualCVaRFloor += residualCVaR;
            cvarRiskCount += 1;
        } else {
            totalResidualCVaRFloor += residualALE;
            cvarSkippedCount += 1;
        }
    });

    return {
        totalResidualALE,
        totalResidualCVaR: cvarRiskCount > 0 ? totalResidualCVaR : null,
        // Cubre siempre las mismas amenazas que totalResidualALE — se usa para CLASIFICAR el
        // portafolio, no para mostrarlo (el número que se muestra sigue siendo totalResidualCVaR,
        // acompañado de la nota de cobertura que ya arma App.RiskManagement.renderPortfolio).
        totalResidualCVaRFloor: threats.length > 0 ? totalResidualCVaRFloor : null,
        cvarRiskCount,
        cvarSkippedCount,
        treatedCount,
        untreatedCount: threats.length - treatedCount,
        totalRiskCount: threats.length,
    };
}

/**
 * Análisis 80-20 (Pareto) sobre el Riesgo RESIDUAL — mismo criterio que calculateParetoAnalysis
 * (ordena de mayor a menor, % acumulado, corte del 80%), pero sobre el ALE VIGENTE de cada
 * Amenaza (el residual de su treatmentDecision si ya adoptó una estrategia, o el ACTUAL si
 * no — mismo criterio que calculateResidualPortfolio) en vez del ACTUAL puro. Responde una
 * pregunta distinta a la de calculateParetoAnalysis: esa prioriza "dónde enfocar el esfuerzo de
 * análisis/tratamiento" ANTES de decidir nada; esta responde "qué riesgos siguen concentrando la
 * exposición DESPUÉS de tratar" — útil para notar una estrategia ya adoptada que resultó
 * insuficiente frente al resto del portafolio, o qué riesgo sin tratar es ahora el más urgente.
 * Mismo filtro que calculateParetoAnalysis (excluye 'oportunidad').
 *
 * Devuelve una lista más liviana que calculateParetoAnalysis (solo riskName/residualALE/treated/
 * cumulativePercent, no el resto de cada entrada) — a propósito: mezclar el residualALE (el
 * número que aquí importa) con el `ale` inherente de la misma entrada en un solo objeto invitaría
 * a confundirlos en el frontend.
 * @param {Array<{riskName:string, riskType?:string, ale:number, treatmentDecision?:{residualALE:number}|null}>} risks
 */
function calculateResidualParetoAnalysis(risks) {
    const threats = risks.filter((r) => r.riskType !== 'oportunidad');
    const withResidual = threats.map((r) => ({
        riskName: r.riskName,
        residualALE: r.treatmentDecision ? r.treatmentDecision.residualALE : r.ale,
        treated: !!r.treatmentDecision,
    }));
    const sorted = [...withResidual].sort((a, b) => b.residualALE - a.residualALE);
    const total = sorted.reduce((sum, r) => sum + r.residualALE, 0);

    let running = 0;
    const withCumulative = sorted.map((r) => {
        running += r.residualALE;
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
 * Waterfall Inherente → Actual del Portafolio: agrega, por separado, el Riesgo Inherente REAL
 * (sin ningún control, `r.inherentALE`/`r.inherentCVaR` — ver calculateInherentRiskFromSimulation,
 * lib/autocalc.js) y el Riesgo Actual (con el Nivel de Defensa vigente, `r.ale`/`r.cvar95`) de
 * cada Amenaza del Registro. La tercera etapa (Riesgo Residual, después de Tratamiento) ya la
 * agrega calculateResidualPortfolio — esta función NO la duplica, el frontend combina ambos
 * payloads para armar el waterfall completo de 3 etapas.
 *
 * `totalActualALE`/`totalActualCVaR` DUPLICAN a propósito la suma que ya hace
 * calculateParetoAnalysis (mismo filtro) — es una decoupling deliberada, mismo criterio que ya
 * usa calculateResidualParetoAnalysis frente a calculateParetoAnalysis (reimplementa en vez de
 * reusar), para que este payload sea autocontenido y el frontend no dependa de que también haya
 * pedido el Pareto. Si el filtro de "qué cuenta como Amenaza" cambia alguna vez, hay que
 * actualizar las dos funciones — no es un descuido, es la misma duplicación ya aceptada arriba.
 *
 * `inherentRiskCount`/`inherentMissingCount`: no todo riesgo guardado tiene `inherentALE`
 * persistido — los guardados ANTES de que existiera esta función no lo traen, y se recalculan
 * solos la próxima vez que se vuelvan a simular (sin migración/backfill, mismo criterio ya usado
 * con vulnManualOverride). `totalInherentALE`/`totalInherentCVaR` son `null` si NINGÚN riesgo
 * tiene el dato todavía — no se muestra un total parcial disfrazado de completo.
 *
 * `comparableActualALE` existe precisamente por ese hueco: es el ALE Actual sumado SOLO sobre los
 * riesgos que además tienen `inherentALE`, o sea la MISMA canasta que `totalInherentALE`. Es el
 * único total contra el que tiene sentido restar el Inherente (Efectividad de Controles, ver
 * App.RiskManagement.renderPortfolio) — restarle `totalActualALE`, que cubre TODAS las amenazas,
 * mezcla dos canastas distintas.
 *
 * Bug real corregido: esa resta cruzada daba porcentajes de efectividad negativos y un waterfall
 * imposible (Riesgo Inherente MENOR que el Actual, cuando por definición el inherente —sin ningún
 * control— nunca puede ser menor). Medido con 3 amenazas, una sin `inherentALE`: la app reportaba
 * −133.3% de efectividad cuando la real era +66.7%, o sea le decía al usuario que sus controles
 * empeoraban el riesgo. Con cobertura completa (`inherentMissingCount === 0`) ambos totales
 * coinciden, que es por lo que el error pasaba desapercibido en los casos limpios.
 * @param {Array<{riskType?:string, ale:number, cvar95?:number, inherentALE?:number|null, inherentCVaR?:number|null}>} risks
 */
function calculateInherentPortfolio(risks) {
    const threats = risks.filter((r) => r.riskType !== 'oportunidad');

    let totalInherentALE = 0;
    let totalInherentCVaR = 0;
    let inherentRiskCount = 0;
    let totalActualALE = 0;
    let totalActualCVaR = 0;
    let actualCvarCount = 0;
    let comparableActualALE = 0;

    threats.forEach((r) => {
        totalActualALE += r.ale;
        if (typeof r.cvar95 === 'number') {
            totalActualCVaR += r.cvar95;
            actualCvarCount += 1;
        }
        if (typeof r.inherentALE === 'number') {
            totalInherentALE += r.inherentALE;
            inherentRiskCount += 1;
            comparableActualALE += r.ale;
        }
        if (typeof r.inherentCVaR === 'number') {
            totalInherentCVaR += r.inherentCVaR;
        }
    });

    return {
        totalInherentALE: inherentRiskCount > 0 ? totalInherentALE : null,
        totalInherentCVaR: inherentRiskCount > 0 ? totalInherentCVaR : null,
        inherentRiskCount,
        inherentMissingCount: threats.length - inherentRiskCount,
        totalActualALE,
        totalActualCVaR: actualCvarCount > 0 ? totalActualCVaR : null,
        comparableActualALE: inherentRiskCount > 0 ? comparableActualALE : null,
        totalRiskCount: threats.length,
    };
}

module.exports = {
    normalizeTriggeredBy,
    getRiskMatrixZones,
    calculateParetoAnalysis,
    calculateConsolidatedSensitivity,
    calculateResidualPortfolio,
    calculateResidualParetoAnalysis,
    calculateInherentPortfolio,
};
