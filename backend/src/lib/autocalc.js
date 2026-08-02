'use strict';

const { confidenceSpreadFactors } = require('../data/profiles');

/**
 * Promedio simple de los atributos numéricos de un perfil (Atacante o Defensa).
 * @param {Object} profile
 * @returns {number}
 */
function calculateProfileAverage(profile) {
    const values = Object.entries(profile)
        .filter(([key]) => key !== 'name')
        .map(([, value]) => value);
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function getConfidenceSpread(confidence) {
    return confidenceSpreadFactors[confidence] || confidenceSpreadFactors.medio;
}

/**
 * Vulnerabilidad (%) = probabilidad de que la amenaza tenga éxito = capacidad
 * del atacante vs. fuerza de la defensa (FAIR: Threat Capability vs.
 * Resistance Strength). El ancho del rango Mín/Máx depende del Nivel de
 * Confianza declarado.
 * @param {number} attackerScore Factor de Amenaza (0-100)
 * @param {number} defenseScore Nivel de Defensa (0-100)
 * @param {'alto'|'medio'|'bajo'} confidence
 */
function calculateVulnerability(attackerScore, defenseScore, confidence) {
    const spread = getConfidenceSpread(confidence);
    const mode = Math.min(99, Math.max(1, Math.round(attackerScore * (1 - defenseScore / 100))));
    const min = Math.max(0, Math.round(mode * spread.min));
    const max = Math.min(100, Math.round(mode * spread.max));
    return { min, mode, max, attackerScore, defenseScore };
}

/**
 * Dado el costo "Más Probable" de una categoría de Magnitud de Pérdida y el
 * Nivel de Confianza, deriva Mínimo y Máximo. El usuario solo da el valor
 * más probable — no tiene que adivinar el rango completo.
 * @param {number} mode
 * @param {'alto'|'medio'|'bajo'} confidence
 */
function calculateLossMagnitudeRange(mode, confidence) {
    const spread = getConfidenceSpread(confidence);
    return {
        min: Math.max(0, Math.round(mode * spread.min)),
        mode,
        max: Math.round(mode * spread.max),
    };
}

/**
 * Reducción de ALE (%) al "Mitigar": compara el Nivel de Defensa ACTUAL contra
 * el Nivel de Defensa OBJETIVO que se alcanzaría con el control propuesto.
 * Reducción% = (Objetivo - Actual) / (100 - Actual) * 100, acotado a [0, 100].
 * Si el objetivo es igual o peor que el actual, la reducción es 0 (no premia
 * una mala decisión).
 * @param {number} currentDefenseScore
 * @param {number} targetDefenseScore
 */
function calculateReduccionALE(currentDefenseScore, targetDefenseScore) {
    let reduccion = 0;
    if (targetDefenseScore > currentDefenseScore && currentDefenseScore < 100) {
        reduccion = Math.round(((targetDefenseScore - currentDefenseScore) / (100 - currentDefenseScore)) * 100);
    }
    return Math.max(0, Math.min(100, reduccion));
}

module.exports = {
    calculateProfileAverage,
    getConfidenceSpread,
    calculateVulnerability,
    calculateLossMagnitudeRange,
    calculateReduccionALE,
};
