'use strict';

const { confidenceSpreadFactors } = require('../data/profiles');
const { getPertRandom, mulberry32 } = require('./random');

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

// Escala de la logística que convierte el margen TCap-RS en probabilidad de éxito — 15 puntos
// de margen ya inclinan bastante la balanza, sin techo/piso duro artificial. Valor curado a
// mano, documentado como tal (no viene de evidencia real todavía) — el script de calibración en
// tools/bayesian-calibration/ es el mecanismo para revisarlo con datos reales más adelante.
const LOGISTIC_SCALE = 15;
// Cuánto puede escalar su sofisticación un atacante que decide no retirarse ante un desafío —
// 0-30% de refuerzo sobre su Capacidad de Amenaza de esta iteración.
const MAX_ESCALATION = 0.3;

/**
 * Vulnerabilidad (%) = P(Capacidad de Amenaza > Fuerza de Resistencia) — dos distribuciones
 * INDEPENDIENTES que se comparan, nunca una que descuenta a la otra. Reemplaza la fórmula vieja
 * (`attackerScore * (1 - defenseScore/100)`), que hacía que subir el Nivel de Defensa bajara
 * directamente el número que representa la Motivación/Recursos/Capacidad/Persistencia/
 * Sofisticación del atacante — conceptualmente equivocado: tu defensa no cambia quién es el
 * atacante ni qué tan decidido está, cambia qué tan probable es que te tenga éxito.
 *
 * Devuelve un SAMPLER, no un número — compatible directo con el parámetro `sampleVuln` que
 * `runMonteCarloSimulation` (simulation.js) ya acepta desde la Tarea #25 de esta sesión,
 * exactamente para este propósito (ver el comentario ahí). Cada llamada al sampler es una
 * iteración: nunca es una fórmula fija, es una simulación real con su propia incertidumbre.
 *
 * @param {Object} attackerProfile Perfil de Atacante completo (ver profiles.js) — se necesita
 *   `persistence` además del promedio, para la escalada de abajo.
 * @param {Object} defenseProfile Perfil de Defensa completo.
 * @param {'alto'|'medio'|'bajo'} confidence
 * @returns {(rng: () => number) => number} Sampler que devuelve un decimal en [0,1] por llamada.
 */
function sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence) {
    const attackerScore = calculateProfileAverage(attackerProfile);
    const defenseScore = calculateProfileAverage(defenseProfile);
    const spread = getConfidenceSpread(confidence);
    // Triángulos de Capacidad de Amenaza (TCap) y Fuerza de Resistencia (RS) — cada uno sale
    // SOLO de su propio perfil. Ninguno se calcula a partir del otro.
    const tcap = { min: attackerScore * spread.min, mode: attackerScore, max: Math.min(100, attackerScore * spread.max) };
    const rs = { min: defenseScore * spread.min, mode: defenseScore, max: Math.min(100, defenseScore * spread.max) };
    const persistence = attackerProfile.persistence || 0;

    return (rng) => {
        const tcapSample = getPertRandom(tcap.min, tcap.mode, tcap.max, 4, rng);
        const rsSample = getPertRandom(rs.min, rs.mode, rs.max, 4, rng);

        // Escalada NO determinista: si la defensa va ganando ESTA iteración, un atacante
        // persistente tiene una probabilidad (proporcional a su PROPIA Persistencia, nunca a
        // nada de la defensa) de escalar su sofisticación en vez de desistir — un desafío que
        // lo motiva más, no lo disuade. Un atacante de Persistencia baja (oportunista) casi
        // nunca escala; uno de Persistencia alta (organizado, estado-nación) escala seguido. Se
        // vuelve a tirar cada iteración — nunca un `if` seco.
        let effectiveTcap = tcapSample;
        if (rsSample > tcapSample && rng() < persistence / 100) {
            effectiveTcap = Math.min(100, tcapSample * (1 + rng() * MAX_ESCALATION));
        }

        // Probabilidad de éxito de ESTA iteración: función logística del margen final — 50%
        // cuando están parejos, tiende a 0/1 en los extremos, sin techo/piso duro artificial.
        return 1 / (1 + Math.exp(-(effectiveTcap - rsSample) / LOGISTIC_SCALE));
    };
}

/**
 * Corre un sampler (ver sampleVulnerabilityFromProfiles) muchas veces y resume el resultado
 * como {min, mode, max} en escala 0-100 (percentiles 10/50/90) — mismo shape que devolvía la
 * vieja calculateVulnerability, para que la vista previa del Paso 2 y los reportes no tengan que
 * cambiar. No necesita una semilla reproducible (es solo una vista previa, no la simulación
 * real) — por defecto usa Math.random.
 * @param {(rng: () => number) => number} sampler
 * @param {number} [iterations=2000]
 * @param {() => number} [rng=Math.random]
 */
function summarizeVulnerabilitySamples(sampler, iterations = 2000, rng = Math.random) {
    const samples = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        samples[i] = sampler(rng) * 100;
    }
    samples.sort((a, b) => a - b);
    const percentile = (p) => samples[Math.min(iterations - 1, Math.floor((p / 100) * iterations))];
    return {
        min: Math.round(Math.max(0, percentile(10))),
        mode: Math.round(Math.min(100, Math.max(0, percentile(50)))),
        max: Math.round(Math.min(100, percentile(90))),
    };
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
 * Reducción de ALE (%) al "Mitigar": compara la Vulnerabilidad SIMULADA (ver
 * sampleVulnerabilityFromProfiles) con el Nivel de Defensa ACTUAL contra la que resultaría con
 * el Nivel de Defensa OBJETIVO que se alcanzaría con el control propuesto — mismo Perfil de
 * Atacante en los dos casos, nunca se toca. Reemplaza la vieja fórmula cerrada
 * `(objetivo-actual)/(100-actual)`, que era exacta SOLO porque la vieja Vulnerabilidad era
 * lineal en el Nivel de Defensa — con el modelo TCap vs. RS eso ya no es cierto, así que la
 * reducción real se mide corriendo la simulación en los dos escenarios y comparando.
 * Si el objetivo resulta igual o peor que el actual, la reducción es 0 (no premia una mala
 * decisión).
 * @param {Object} attackerProfile
 * @param {Object} currentDefenseProfile
 * @param {Object} targetDefenseProfile
 * @param {'alto'|'medio'|'bajo'} confidence
 */
function calculateReduccionALEFromProfiles(attackerProfile, currentDefenseProfile, targetDefenseProfile, confidence) {
    // "Números aleatorios comunes": las dos corridas comparten la MISMA semilla, así que
    // cualquier ruido de muestreo se cancela simétricamente entre ellas — sin esto, comparar dos
    // corridas con Math.random() independiente podía dar una reducción falsa (positiva o
    // negativa) incluso con el mismo Nivel de Defensa en los dos lados, por puro ruido
    // estadístico, no porque de verdad hubiera una diferencia.
    const COMPARISON_SEED = 20260810;
    const currentSummary = summarizeVulnerabilitySamples(
        sampleVulnerabilityFromProfiles(attackerProfile, currentDefenseProfile, confidence),
        2000,
        mulberry32(COMPARISON_SEED),
    );
    const targetSummary = summarizeVulnerabilitySamples(
        sampleVulnerabilityFromProfiles(attackerProfile, targetDefenseProfile, confidence),
        2000,
        mulberry32(COMPARISON_SEED),
    );
    if (currentSummary.mode <= 0) return { currentSummary, targetSummary, reductionPercent: 0 };
    const reduccion = Math.round((1 - targetSummary.mode / currentSummary.mode) * 100);
    return { currentSummary, targetSummary, reductionPercent: Math.max(0, Math.min(100, reduccion)) };
}

module.exports = {
    calculateProfileAverage,
    getConfidenceSpread,
    sampleVulnerabilityFromProfiles,
    summarizeVulnerabilitySamples,
    calculateLossMagnitudeRange,
    calculateReduccionALEFromProfiles,
};
