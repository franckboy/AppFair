'use strict';

const { mulberry32, getPertRandom, getLognormalRandom } = require('./random');
const { lossFormsKeys, lossFormsLabels } = require('../data/profiles');

/**
 * Corre la simulación Monte Carlo completa de un riesgo FAIR. TEF y Vulnerabilidad se
 * muestrean con Beta-PERT (concentra la probabilidad alrededor de la moda, ver
 * getPertRandom en random.js); Magnitud de Pérdida se muestrea lognormal (permite que la
 * pérdida real supere el "peor caso" estimado, ver getLognormalRandom) — ambas son las
 * distribuciones recomendadas en la práctica de FAIR/Monte Carlo para estimados de 3 puntos
 * de expertos, en vez de la triangular (que sí se sigue usando como respaldo cuando una
 * categoría de pérdida tiene min o moda en 0, donde lognormal no está definida).
 *
 * @param {Object} params
 * @param {number} params.iterations Número de escenarios a simular (ej. 10000)
 * @param {number} params.seed Semilla del generador pseudoaleatorio (0 = aleatoria real)
 * @param {{min:number, mode:number, max:number}} params.tef Frecuencia de Evento de Amenaza (contactos/año)
 * @param {{min:number, mode:number, max:number}} params.vuln Vulnerabilidad, en % (0-100) — se
 *        usa para armar el muestreo PERT por defecto (ver sampleVuln); sigue siendo obligatorio
 *        aunque se pase un sampleVuln propio, para no tener que tocar la validación de la ruta.
 * @param {Object<string,{min:number, mode:number, max:number}>} params.lossMagnitudes
 *        Un objeto con hasta 9 claves (una por categoría de pérdida), cada una con su rango
 * @param {(rng: () => number) => number} [params.sampleVuln] Punto de enchufe opcional: por
 *        defecto (sin pasar nada) es exactamente la PERT de siempre sobre `vuln` — mismo
 *        comportamiento bit a bit que antes de que este parámetro existiera. Pensado para que,
 *        en el futuro, un caller pase una función que muestree la Vulnerabilidad de una red
 *        bayesiana (ver bayesianNetwork.js, todavía sin conectar aquí) en vez de un rango fijo,
 *        sin tener que tocar el resto del motor. Debe devolver un decimal en [0,1] (no
 *        porcentaje), y consumir el mismo `rng` que se le pasa (para que la corrida siga siendo
 *        reproducible con una semilla).
 * @returns {{annualLosses:number[], usedSeed:number, sensitivity:Array, lefSamples:number[], magnitudeSamples:number[]}}
 */
function runMonteCarloSimulation({ iterations, seed, tef, vuln, lossMagnitudes, sampleVuln }) {
    const usedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
    const rng = mulberry32(usedSeed);

    const vulnDecimal = { min: vuln.min / 100, mode: vuln.mode / 100, max: vuln.max / 100 };
    const drawVuln = sampleVuln || ((r) => getPertRandom(vulnDecimal.min, vulnDecimal.mode, vulnDecimal.max, 4, r));

    const activeKeys = lossFormsKeys.filter((key) => lossMagnitudes[key]);
    const lmInputs = activeKeys.map((key) => lossMagnitudes[key]);

    const annualLosses = new Array(iterations);
    const tefSamples = new Array(iterations);
    const vulnSamples = new Array(iterations);
    // LEF (TEF × Vulnerabilidad) por iteración — no se usa para nada dentro de esta función
    // (annualLosses ya lo consume internamente), se expone tal cual porque cascadeSimulation.js
    // lo necesita para derivar, iteración por iteración, si ESTE riesgo se activó "este año"
    // (ver runFamilyCascadeSimulation: P(activado) = 1 − e^(−LEF)). No cambia ningún resultado
    // existente — es la misma variable que ya se calculaba, solo que antes se descartaba.
    const lefSamples = new Array(iterations);
    // Magnitud de pérdida total (lm_i) por iteración, ANTES de multiplicarla por lef_i — mismo
    // criterio que lefSamples arriba: no se usa para nada dentro de esta función (annualLosses ya
    // lo consume internamente), se expone porque cascadeSimulation.js la necesita para sumar SOLO
    // la magnitud del evento cuando un riesgo hijo ya se activó (ver el comentario en
    // runFamilyCascadeSimulation: sumar lef_i×lm_i otra vez ahí descontaría el LEF dos veces, una
    // para decidir si el evento ocurrió y otra dentro del monto sumado). No cambia ningún
    // resultado existente.
    const magnitudeSamples = new Array(iterations);
    const lmSamples = activeKeys.map(() => new Array(iterations));

    for (let i = 0; i < iterations; i++) {
        const tef_i = getPertRandom(tef.min, tef.mode, tef.max, 4, rng);
        const vuln_i = drawVuln(rng);
        const lef_i = tef_i * vuln_i;

        let lm_i = 0;
        lmInputs.forEach((input, idx) => {
            const val = getLognormalRandom(input.min, input.mode, input.max, rng);
            lmSamples[idx][i] = val;
            lm_i += val;
        });

        tefSamples[i] = tef_i;
        vulnSamples[i] = vuln_i;
        lefSamples[i] = lef_i;
        magnitudeSamples[i] = lm_i;
        annualLosses[i] = lef_i * lm_i;
    }

    const sensitivity = calculateSensitivity(annualLosses, tefSamples, vulnSamples, lmSamples, activeKeys);

    return { annualLosses, usedSeed, sensitivity, lefSamples, magnitudeSamples };
}

/** Correlación de Pearson entre dos arreglos numéricos del mismo largo. */
function pearsonCorrelation(x, y) {
    const n = x.length;
    let sumX = 0,
        sumY = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
    }
    const meanX = sumX / n,
        meanY = sumY / n;
    let num = 0,
        denX = 0,
        denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX,
            dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
}

/**
 * Análisis de Sensibilidad (RIMS RA.1-2015, 6.3.4.3): ranking de qué tanto
 * influye cada variable de entrada en el resultado final, medido por su
 * correlación de Pearson contra las pérdidas simuladas.
 */
function calculateSensitivity(losses, tefSamples, vulnSamples, lmSamples, activeKeys) {
    // key es el identificador estable que usa el frontend para traducir el nombre a Modo
    // Simple/Técnico (ver LOSS_FORM_LABELS y SENSITIVITY_LABELS en app_fair.html) — name se
    // manda también para no romper a un cliente que no sepa de esa traducción.
    const factors = [
        { key: 'tef', name: 'Frecuencia de Evento (TEF)', values: tefSamples },
        { key: 'vulnerabilidad', name: 'Vulnerabilidad', values: vulnSamples },
        ...activeKeys.map((key, idx) => ({
            key: `lm:${key}`,
            name: `Magnitud: ${lossFormsLabels[key] || key}`,
            values: lmSamples[idx],
        })),
    ];

    const results = factors.map((f) => ({
        key: f.key,
        name: f.name,
        correlation: pearsonCorrelation(f.values, losses),
    }));
    results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    return results;
}

/**
 * Estadísticas resumen de un arreglo de pérdidas simuladas: promedio,
 * mediana, mínimo, máximo, P90, CVaR 95% y probabilidad de exceder un umbral.
 * @param {number[]} losses NO necesita venir ordenado — esta función lo ordena.
 * @param {number} [exceedanceThreshold]
 */
function summarizeLosses(losses, exceedanceThreshold) {
    const sorted = [...losses].sort((a, b) => a - b);
    const n = sorted.length;

    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / n;

    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

    const min = sorted[0];
    const max = sorted[n - 1];
    const p90 = sorted[Math.floor(n * 0.9)];

    const cvarIndex = Math.floor(n * 0.95);
    const tailLosses = sorted.slice(cvarIndex);
    const cvar95 = tailLosses.length > 0 ? tailLosses.reduce((a, b) => a + b, 0) / tailLosses.length : max;

    let probExceedance = null;
    if (typeof exceedanceThreshold === 'number') {
        probExceedance = (sorted.filter((l) => l > exceedanceThreshold).length / n) * 100;
    }

    return { average: avg, median, min, max, p90, cvar95, probExceedance, iterations: n };
}

module.exports = { runMonteCarloSimulation, calculateSensitivity, summarizeLosses, pearsonCorrelation };
