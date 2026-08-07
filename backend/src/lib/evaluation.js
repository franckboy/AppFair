'use strict';

/**
 * Evalúa el Riesgo Residual (%) de Análisis Rápido contra las bandas
 * Medio/Alto/Crítico, con un límite máximo opcional (apetito de riesgo
 * declarado para ese riesgo en particular).
 * @param {number} value Riesgo Residual, 0-100
 * @param {{medio:number, alto:number, critico:number}} rrtBands
 * @param {number|null} [hardCap]
 */
function evaluateResidualRisk(value, rrtBands, hardCap = null) {
    const { medio, alto, critico } = rrtBands;

    if (hardCap !== null && hardCap > 0 && value > hardCap) {
        return {
            level: 'Inaceptable',
            severity: 'critico',
            justification: `Supera el límite máximo aceptable definido para este riesgo específico (${hardCap.toFixed(1)}%).`,
        };
    }
    if (value > critico) {
        return {
            level: 'Crítico',
            severity: 'critico',
            justification: `Supera el umbral Crítico (${critico}%) por ${(value - critico).toFixed(1)} puntos porcentuales.`,
        };
    }
    if (value > alto) {
        return {
            level: 'Alto',
            severity: 'alto',
            justification: `Está en la banda Alta (entre ${alto}% y ${critico}%). Requiere tratamiento.`,
        };
    }
    if (value > medio) {
        return {
            level: 'Medio',
            severity: 'medio',
            justification: `Está en la banda Media (entre ${medio}% y ${alto}%).`,
        };
    }
    return {
        level: 'Bajo',
        severity: 'bajo',
        justification: `Está por debajo del umbral Medio (${medio}%). No requiere tratamiento prioritario.`,
    };
}

/**
 * Evalúa el resultado de una simulación FAIR (Amenaza: riesgo negativo)
 * contra los criterios ALE Aceptable/Crítico.
 *
 * Entre Aceptable y Crítico antes había un solo tramo "Alto" indiferenciado — se parte a la
 * mitad exacta (decisión explícita del usuario, ver la conversación: sin agregar un tercer
 * valor configurado aparte) en Medio (mitad inferior) y Alto (mitad superior), así esta
 * clasificación deja de ser la única en la app sin nivel intermedio (la Matriz de Riesgos, ver
 * getRiskMatrixZones en register.js, ya tenía Bajo/Medio/Alto/Crítico). Bajo y Crítico NO se
 * mueven — siguen significando exactamente lo mismo que antes.
 * @param {number} ale Pérdida Anual Esperada (promedio simulado)
 * @param {number} cvar95 CVaR 95% (cola de riesgo)
 * @param {{aleAceptable:number, aleCritico:number}} criteria
 * @param {(n:number) => string} formatCurrency
 */
function evaluateFairThreat(ale, cvar95, criteria, formatCurrency) {
    const { aleAceptable, aleCritico } = criteria;
    const aleMedio = aleAceptable + (aleCritico - aleAceptable) / 2;

    if (ale > aleCritico) {
        return {
            level: 'Crítico — Requiere Acción Inmediata',
            severity: 'critico',
            justification: `La Pérdida Anual Esperada (${formatCurrency(ale)}) supera el criterio Crítico (${formatCurrency(aleCritico)}). Este riesgo debe tratarse antes que los demás.`,
        };
    }
    if (cvar95 > aleCritico) {
        return {
            level: 'Crítico (riesgo de cola) — Requiere Atención',
            severity: 'critico',
            justification: `Aunque la pérdida promedio (${formatCurrency(ale)}) está dentro de lo aceptable, el CVaR 95% (${formatCurrency(cvar95)}) — el promedio del peor 5% de los escenarios — supera el criterio Crítico. Hay una cola de riesgo relevante que el promedio no muestra.`,
        };
    }
    if (ale > aleMedio) {
        return {
            level: 'Alto — Requiere Tratamiento',
            severity: 'alto',
            justification: `La Pérdida Anual Esperada (${formatCurrency(ale)}) está en la mitad superior del tramo entre Aceptable (${formatCurrency(aleAceptable)}) y Crítico (${formatCurrency(aleCritico)}). Requiere tratamiento.`,
        };
    }
    if (ale > aleAceptable) {
        return {
            level: 'Medio — Vigilar',
            severity: 'medio',
            justification: `La Pérdida Anual Esperada (${formatCurrency(ale)}) está en la mitad inferior del tramo entre Aceptable (${formatCurrency(aleAceptable)}) y Crítico (${formatCurrency(aleCritico)}). No es urgente, pero conviene vigilarlo.`,
        };
    }
    return {
        level: 'Aceptable',
        severity: 'bajo',
        justification: `La Pérdida Anual Esperada (${formatCurrency(ale)}) está dentro del criterio de Aceptable (hasta ${formatCurrency(aleAceptable)}).`,
    };
}

/**
 * Evalúa el resultado de una simulación FAIR de tipo Oportunidad (riesgo
 * positivo): usa los mismos umbrales que Amenaza, pero invierte el
 * significado — un valor esperado alto es DESEABLE.
 * @param {number} benefit Beneficio Anual Esperado
 * @param {{aleAceptable:number, aleCritico:number}} criteria
 * @param {(n:number) => string} formatCurrency
 */
function evaluateFairOpportunity(benefit, criteria, formatCurrency) {
    const { aleAceptable, aleCritico } = criteria;

    if (benefit > aleCritico) {
        return {
            level: 'Oportunidad Significativa — Recomendable Perseguir',
            severity: 'bajo',
            justification: `El Beneficio Anual Esperado (${formatCurrency(benefit)}) supera el umbral alto (${formatCurrency(aleCritico)}). Vale la pena invertir recursos para capturar esta oportunidad.`,
        };
    }
    if (benefit > aleAceptable) {
        return {
            level: 'Oportunidad Moderada — Considerar Perseguir',
            severity: 'medio',
            justification: `El Beneficio Anual Esperado (${formatCurrency(benefit)}) es superior al umbral bajo (${formatCurrency(aleAceptable)}), pero no alcanza el umbral alto (${formatCurrency(aleCritico)}).`,
        };
    }
    return {
        level: 'Oportunidad Menor',
        severity: 'bajo',
        justification: `El Beneficio Anual Esperado (${formatCurrency(benefit)}) está por debajo del umbral bajo (${formatCurrency(aleAceptable)}) — probablemente no justifique un esfuerzo dedicado por sí solo.`,
    };
}

module.exports = { evaluateResidualRisk, evaluateFairThreat, evaluateFairOpportunity };
