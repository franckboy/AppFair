'use strict';

const { confidenceSpreadFactors } = require('../data/profiles');
const { getPertRandom, mulberry32 } = require('./random');
const { runMonteCarloSimulation, summarizeLosses } = require('./simulation');

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

// "Factor de decisividad" de la Función de Éxito de Contienda de Tullock (ver
// tullockSuccessProbability abajo) que usa el cálculo automático de Vulnerabilidad/Monte Carlo
// en vivo — m=1 es el caso base de la literatura de economía de conflicto (la ventaja de fuerza
// pesa de forma proporcional). Valor curado a mano, documentado como tal (no viene de evidencia
// real todavía) — el script de calibración en tools/bayesian-calibration/ es el mecanismo para
// revisarlo con datos reales más adelante. Deliberadamente INDEPENDIENTE del `m` que el usuario
// puede elegir en la sección de Equilibrio de Nash (nashEquilibrium.js): ese es un análisis
// exploratorio "qué pasaría si", nunca debe poder cambiar en silencio el resultado de la
// simulación real.
const TULLOCK_M = 1;
// Cuánto puede escalar su sofisticación un atacante que decide no retirarse ante un desafío —
// 0-30% de refuerzo sobre su Capacidad de Amenaza de esta iteración.
const MAX_ESCALATION = 0.3;

/**
 * Función de Éxito de Contienda de Tullock — probabilidad de que el lado "atacante" gane un
 * enfrentamiento contra el lado "defensa", en función de cuánta fuerza tiene cada uno. Fórmula
 * estándar de la economía de conflicto/teoría de juegos: `Atacante^m / (Atacante^m + Defensa^m)`.
 * A diferencia de una resta (`Atacante - Defensa`), es una RAZÓN — un empate a cualquier escala
 * (10 vs 10, o 90 vs 90) da 50% siempre, nunca depende de qué tan grandes sean los números en
 * juego. `m` controla qué tan decisiva es la diferencia: m=1 pesa la ventaja de forma
 * proporcional (caso base); m>1 hace que hasta una ventaja pequeña incline la balanza casi por
 * completo; m<1 deja al lado más débil con una probabilidad real de éxito incluso en desventaja.
 * @param {number} attackerStrength
 * @param {number} defenseStrength
 * @param {number} [m=TULLOCK_M]
 * @returns {number} decimal en [0,1]
 */
function tullockSuccessProbability(attackerStrength, defenseStrength, m = TULLOCK_M) {
    const a = Math.pow(Math.max(0, attackerStrength), m);
    const d = Math.pow(Math.max(0, defenseStrength), m);
    if (a === 0 && d === 0) return 0.5; // ambos en 0: empate por definición, evita 0/0 = NaN
    return a / (a + d);
}

/**
 * Vulnerabilidad (%) = P(Capacidad de Amenaza > Fuerza de Resistencia) — dos distribuciones
 * INDEPENDIENTES que se comparan (vía Tullock, ver tullockSuccessProbability arriba), nunca una
 * que descuenta a la otra. Reemplaza la fórmula vieja (`attackerScore * (1 - defenseScore/100)`),
 * que hacía que subir el Nivel de Defensa bajara directamente el número que representa la
 * Motivación/Recursos/Capacidad/Persistencia/Sofisticación del atacante — conceptualmente
 * equivocado: tu defensa no cambia quién es el atacante ni qué tan decidido está, cambia qué tan
 * probable es que te tenga éxito.
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
    const tcap = {
        min: attackerScore * spread.min,
        mode: attackerScore,
        max: Math.min(100, attackerScore * spread.max),
    };
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

        // Probabilidad de éxito de ESTA iteración: Función de Éxito de Contienda de Tullock
        // sobre TCap final vs. RS — 50% cuando están parejos (a cualquier escala), sin techo/
        // piso duro artificial.
        return tullockSuccessProbability(effectiveTcap, rsSample);
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

// Semilla fija para calculateResidualFromSimulation — reproducible (mismo criterio que el resto
// de la app: misma entrada, mismo resultado exacto), no necesita "números aleatorios comunes"
// como calculateReduccionALEFromProfiles porque acá solo se corre UNA simulación fresca (la del
// Nivel de Defensa Objetivo), no se comparan dos corridas entre sí.
const RESIDUAL_SIMULATION_SEED = 20260811;
const RESIDUAL_SIMULATION_ITERATIONS = 10000; // mismo rigor que POST /api/simulate
// vuln nunca se muestrea de acá (sampleVuln la reemplaza por completo, ver simulation.js) — el
// valor exacto no importa, runMonteCarloSimulation solo exige que sea un rango válido.
const UNUSED_VULN_PLACEHOLDER = { min: 0, mode: 50, max: 100 };

/**
 * Residual REAL de Mitigar (ALE y CVaR), re-simulando con el Nivel de Defensa OBJETIVO — a
 * diferencia de escalar `currentALE`/`currentCVaR` por un `reductionPercent` compartido (válido
 * SOLO bajo la vieja Vulnerabilidad lineal, ver el comentario de `calculateReduccionALEFromProfiles`
 * y el hallazgo que motivó esta función), esto corre el motor Monte Carlo completo con
 * `sampleVuln = sampleVulnerabilityFromProfiles(attackerProfile, targetDefenseProfile, confidence)`
 * — el mismo mecanismo que ya usa `POST /api/simulate` — y lee `residualALE`/`residualCVaR`
 * directo de esa corrida real, sin asumir que ALE y CVaR se reducen en la misma proporción.
 *
 * `reductionPercent` se deriva de `residualALE` (no de comparar Vulnerabilidad por moda) para
 * quedar consistente con el residual real que esta misma función devuelve. Se acota a [0,100]
 * (no premia una mala decisión, mismo criterio que `calculateReduccionALEFromProfiles`) — pero
 * SOLO el porcentaje mostrado se acota; `residualALE`/`residualCVaR` siempre son el número real
 * simulado, aunque sea peor que el actual (degradar la defensa a propósito debe verse en dólares
 * reales, no ocultarse detrás de un 0%).
 *
 * @param {Object} attackerProfile
 * @param {Object} targetDefenseProfile
 * @param {'alto'|'medio'|'bajo'} confidence
 * @param {{min:number, mode:number, max:number}} tef
 * @param {Object<string,{min:number, mode:number, max:number}>} lossMagnitudes
 * @param {number} currentALE Pérdida Anual Esperada actual (ya simulada, ej. entry.ale) — el
 *   punto de comparación para derivar reductionPercent; no hace falta volver a calcularla.
 * @returns {{residualALE:number, residualCVaR:number, reductionPercent:number}}
 */
function calculateResidualFromSimulation(
    attackerProfile,
    targetDefenseProfile,
    confidence,
    tef,
    lossMagnitudes,
    currentALE,
) {
    const { annualLosses } = runMonteCarloSimulation({
        iterations: RESIDUAL_SIMULATION_ITERATIONS,
        seed: RESIDUAL_SIMULATION_SEED,
        tef,
        vuln: UNUSED_VULN_PLACEHOLDER,
        lossMagnitudes,
        sampleVuln: sampleVulnerabilityFromProfiles(attackerProfile, targetDefenseProfile, confidence),
    });
    const summary = summarizeLosses(annualLosses);
    const residualALE = summary.average;
    const residualCVaR = summary.cvar95;
    const reductionPercent =
        currentALE > 0 ? Math.max(0, Math.min(100, Math.round((1 - residualALE / currentALE) * 100))) : 0;
    return { residualALE, residualCVaR, reductionPercent };
}

// Semilla fija propia (distinta de RESIDUAL_SIMULATION_SEED) para
// calculateInherentRiskFromSimulation — mismo criterio de reproducibilidad que el resto de la
// app, sin compartir semilla con el residual (son corridas independientes, no se comparan entre
// sí iteración por iteración, así que no hace falta "números aleatorios comunes").
const INHERENT_SIMULATION_SEED = 20260812;
const INHERENT_SIMULATION_ITERATIONS = 10000; // mismo rigor que el resto

/**
 * Riesgo Inherente REAL (ALE y CVaR) — la exposición SIN ningún control, Vulnerabilidad al 100%.
 * Reemplaza la aproximación algebraica que usaba `computeFairRiskEquivalents`
 * (frontend/src/modules/fair-register.js: `entry.ale * (100 / vulnMean)`, "des-mitigar" el ALE
 * dividiendo entre la Vulnerabilidad media) — válida solo bajo la vieja Vulnerabilidad lineal,
 * igual que la aproximación que ya se reemplazó una vez para el residual de Mitigar (ver
 * calculateResidualFromSimulation arriba). Corre el motor Monte Carlo completo con
 * `sampleVuln` fijo en 100% en vez de reescalar un resultado ya simulado.
 *
 * A diferencia de `calculateResidualFromSimulation`, no hace falta ningún perfil de Atacante/
 * Defensa — "sin ningún control" no depende de a quién te enfrentas, es un escalar fijo.
 *
 * @param {{min:number, mode:number, max:number}} tef
 * @param {Object<string,{min:number, mode:number, max:number}>} lossMagnitudes
 * @returns {{inherentALE:number, inherentCVaR:number}}
 */
function calculateInherentRiskFromSimulation(tef, lossMagnitudes) {
    const { annualLosses } = runMonteCarloSimulation({
        iterations: INHERENT_SIMULATION_ITERATIONS,
        seed: INHERENT_SIMULATION_SEED,
        tef,
        vuln: UNUSED_VULN_PLACEHOLDER,
        lossMagnitudes,
        // No consume rng: Vulnerabilidad=100% (sin ningún control) es un escalar fijo, no hace
        // falta muestrearlo — el motor ya tolera un número variable de tiradas por iteración
        // (rejection sampling en getPertRandom/sampleGamma), esto no rompe nada nuevo.
        sampleVuln: () => 1,
    });
    const summary = summarizeLosses(annualLosses);
    return { inherentALE: summary.average, inherentCVaR: summary.cvar95 };
}

module.exports = {
    calculateProfileAverage,
    getConfidenceSpread,
    tullockSuccessProbability,
    sampleVulnerabilityFromProfiles,
    summarizeVulnerabilitySamples,
    calculateLossMagnitudeRange,
    calculateReduccionALEFromProfiles,
    calculateResidualFromSimulation,
    calculateInherentRiskFromSimulation,
};
