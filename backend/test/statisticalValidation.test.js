'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { jStat } = require('jstat');

const {
    mulberry32,
    getPertRandom,
    getLognormalRandom,
    triangularVariance,
    solveLognormalSigmaSquared,
} = require('../src/lib/random');

/**
 * Validación estadística POR DISTRIBUCIÓN COMPLETA (no solo media/varianza, ver las pruebas de
 * convergencia en lib.test.js) de los muestreadores Beta-PERT y lognormal, usando el estadístico
 * de Kolmogorov-Smirnov de una muestra: D = max_i |ECDF(x_i) - CDF_teórica(x_i)|.
 *
 * jstat es SOLO devDependency — nunca se debe importar desde backend/src/ (rompería la filosofía
 * de este motor: matemática simple y auditable a mano para el motor de riesgo). Este es el ÚNICO
 * archivo del repo que hace require('jstat'), a propósito, para que ese límite sea trivial de
 * verificar (ej. grep -rn "jstat" backend/src debe no dar resultados).
 *
 * Como la semilla es fija, esto es 100% determinista y reproducible — NO es una prueba de
 * hipótesis estadística "puede fallar al azar" (por eso el umbral no sale de una tabla de
 * valores críticos de KS pensada para datos en vivo/aleatorios de verdad): se corrió primero,
 * se observó el D real obtenido para cada caso (~0.005-0.0074 con la implementación correcta),
 * y el umbral de assert se fijó con margen amplio (>2.5x) por encima de eso. Como control de que
 * el test de verdad tiene poder de detección: un bug deliberado de alpha/beta invertidos da
 * D=0.838, y usar lambda=2 en vez de 4 da D=0.057 — ambos muy por encima del umbral.
 */

/** D = max sobre las muestras ordenadas de |ECDF(x_i) - CDF_teórica(x_i)| (KS de una muestra). */
function ksStatistic(samples, theoreticalCdf) {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    let D = 0;
    for (let i = 0; i < n; i++) {
        const F = theoreticalCdf(sorted[i]);
        const upper = (i + 1) / n - F; // ECDF salta a (i+1)/n justo en x_i
        const lower = F - i / n; // ECDF vale i/n justo antes de x_i
        if (upper > D) D = upper;
        if (lower > D) D = lower;
    }
    return D;
}

const N = 20000; // mismo orden de magnitud que runFamilyCascadeSimulation en lib.test.js
const KS_THRESHOLD = 0.02; // margen >2.5x sobre el D observado (~0.005-0.0074) con implementación correcta

test('getPertRandom: la distribución empírica coincide con Beta(alpha,beta) reescalada a [min,max] (KS)', () => {
    const rng = mulberry32(2026);
    const lambda = 4;
    // 3 casos: simétrico, sesgado a la izquierda (moda baja), sesgado a la derecha (moda alta) —
    // para atrapar un bug de parametrización (ej. alpha/beta invertidos) que un solo caso
    // simétrico no distinguiría (ahí alpha=beta, así que invertirlos no cambia nada).
    const cases = [
        { min: 0, mode: 50, max: 100 },
        { min: 10, mode: 20, max: 100 },
        { min: 5, mode: 90, max: 100 },
    ];

    for (const { min, mode, max } of cases) {
        const samples = new Array(N);
        for (let i = 0; i < N; i++) samples[i] = getPertRandom(min, mode, max, lambda, rng);

        const alpha = 1 + (lambda * (mode - min)) / (max - min);
        const beta = 1 + (lambda * (max - mode)) / (max - min);
        const D = ksStatistic(samples, (x) => jStat.beta.cdf((x - min) / (max - min), alpha, beta));

        assert.ok(
            D < KS_THRESHOLD,
            `min=${min} moda=${mode} max=${max}: D=${D.toFixed(4)} (esperado <${KS_THRESHOLD})`,
        );
    }
});

test('getLognormalRandom: la distribución empírica coincide con Lognormal(mu,sigma) implicada por min/moda/max (KS)', () => {
    const rng = mulberry32(2026);
    const cases = [
        { min: 10000, mode: 50000, max: 150000 },
        { min: 1000, mode: 5000, max: 200000 }, // muy sesgada
        { min: 100, mode: 20000, max: 40000 },
    ];

    for (const { min, mode, max } of cases) {
        const sigmaSquared = solveLognormalSigmaSquared(mode, triangularVariance(min, mode, max));
        const sigma = Math.sqrt(sigmaSquared);
        const mu = Math.log(mode) + sigmaSquared;

        const samples = new Array(N);
        for (let i = 0; i < N; i++) samples[i] = getLognormalRandom(min, mode, max, rng);

        const D = ksStatistic(samples, (x) => jStat.lognormal.cdf(x, mu, sigma));

        assert.ok(
            D < KS_THRESHOLD,
            `min=${min} moda=${mode} max=${max}: D=${D.toFixed(4)} (esperado <${KS_THRESHOLD})`,
        );
    }
});
