'use strict';

const { mulberry32, getTriangularRandom } = require('./random');
const { lossFormsKeys, lossFormsLabels } = require('../data/profiles');

/**
 * Corre la simulación Monte Carlo completa de un riesgo FAIR.
 *
 * @param {Object} params
 * @param {number} params.iterations Número de escenarios a simular (ej. 10000)
 * @param {number} params.seed Semilla del generador pseudoaleatorio (0 = aleatoria real)
 * @param {{min:number, mode:number, max:number}} params.tef Frecuencia de Evento de Amenaza (contactos/año)
 * @param {{min:number, mode:number, max:number}} params.vuln Vulnerabilidad, en % (0-100)
 * @param {Object<string,{min:number, mode:number, max:number}>} params.lossMagnitudes
 *        Un objeto con hasta 9 claves (una por categoría de pérdida), cada una con su rango
 * @returns {{annualLosses:number[], usedSeed:number, sensitivity:Array}}
 */
function runMonteCarloSimulation({ iterations, seed, tef, vuln, lossMagnitudes }) {
    const usedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
    const rng = mulberry32(usedSeed);

    const vulnDecimal = { min: vuln.min / 100, mode: vuln.mode / 100, max: vuln.max / 100 };

    const activeKeys = lossFormsKeys.filter((key) => lossMagnitudes[key]);
    const lmInputs = activeKeys.map((key) => lossMagnitudes[key]);

    const annualLosses = new Array(iterations);
    const tefSamples = new Array(iterations);
    const vulnSamples = new Array(iterations);
    const lmSamples = activeKeys.map(() => new Array(iterations));

    for (let i = 0; i < iterations; i++) {
        const tef_i = getTriangularRandom(tef.min, tef.mode, tef.max, rng);
        const vuln_i = getTriangularRandom(vulnDecimal.min, vulnDecimal.mode, vulnDecimal.max, rng);
        const lef_i = tef_i * vuln_i;

        let lm_i = 0;
        lmInputs.forEach((input, idx) => {
            const val = getTriangularRandom(input.min, input.mode, input.max, rng);
            lmSamples[idx][i] = val;
            lm_i += val;
        });

        tefSamples[i] = tef_i;
        vulnSamples[i] = vuln_i;
        annualLosses[i] = lef_i * lm_i;
    }

    const sensitivity = calculateSensitivity(annualLosses, tefSamples, vulnSamples, lmSamples, activeKeys);

    return { annualLosses, usedSeed, sensitivity };
}

/** Correlación de Pearson entre dos arreglos numéricos del mismo largo. */
function pearsonCorrelation(x, y) {
    const n = x.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
    const meanX = sumX / n, meanY = sumY / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX, dy = y[i] - meanY;
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
        ...activeKeys.map((key, idx) => ({ key: `lm:${key}`, name: `Magnitud: ${lossFormsLabels[key] || key}`, values: lmSamples[idx] })),
    ];

    const results = factors.map((f) => ({ key: f.key, name: f.name, correlation: pearsonCorrelation(f.values, losses) }));
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

    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];

    const min = sorted[0];
    const max = sorted[n - 1];
    const p90 = sorted[Math.floor(n * 0.90)];

    const cvarIndex = Math.floor(n * 0.95);
    const tailLosses = sorted.slice(cvarIndex);
    const cvar95 = tailLosses.length > 0
        ? tailLosses.reduce((a, b) => a + b, 0) / tailLosses.length
        : max;

    let probExceedance = null;
    if (typeof exceedanceThreshold === 'number') {
        probExceedance = (sorted.filter((l) => l > exceedanceThreshold).length / n) * 100;
    }

    return { average: avg, median, min, max, p90, cvar95, probExceedance, iterations: n };
}

module.exports = { runMonteCarloSimulation, calculateSensitivity, summarizeLosses, pearsonCorrelation };
