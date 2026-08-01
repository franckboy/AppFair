'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mulberry32 } = require('../src/lib/random');
const { runMonteCarloSimulation, summarizeLosses, pearsonCorrelation } = require('../src/lib/simulation');
const { calculateVulnerability, calculateReduccionALE } = require('../src/lib/autocalc');
const { calculateInsuranceRetainedALE, calculateROSI } = require('../src/lib/treatment');
const { evaluateFairThreat } = require('../src/lib/evaluation');

test('mulberry32 es determinista: misma semilla -> misma secuencia', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const seqA = Array.from({ length: 5 }, () => rngA());
    const seqB = Array.from({ length: 5 }, () => rngB());
    assert.deepStrictEqual(seqA, seqB);
});

test('mulberry32: semillas distintas dan secuencias distintas', () => {
    const rngA = mulberry32(1);
    const rngB = mulberry32(2);
    assert.notStrictEqual(rngA(), rngB());
});

test('pearsonCorrelation detecta una correlación perfecta', () => {
    const x = [1, 2, 3, 4, 5];
    const y = x.map((v) => v * 2);
    assert.ok(Math.abs(pearsonCorrelation(x, y) - 1) < 1e-9);
});

test('runMonteCarloSimulation es reproducible con la misma semilla', () => {
    const params = {
        iterations: 2000, seed: 999,
        tef: { min: 5, mode: 10, max: 20 },
        vuln: { min: 20, mode: 30, max: 40 },
        lossMagnitudes: { productividad: { min: 30000, mode: 50000, max: 70000 } },
    };
    const runA = runMonteCarloSimulation(params);
    const runB = runMonteCarloSimulation(params);
    assert.deepStrictEqual(runA.annualLosses, runB.annualLosses);
});

test('summarizeLosses: mediana par calcula bien el promedio de los dos centrales', () => {
    const losses = [10, 20, 30, 40]; // par -> mediana = (20+30)/2 = 25
    const summary = summarizeLosses(losses);
    assert.strictEqual(summary.median, 25);
});

test('calculateVulnerability: atacante fuerte + defensa débil = vulnerabilidad alta', () => {
    const result = calculateVulnerability(90, 27, 'bajo');
    assert.ok(result.mode > 50, `esperaba vulnerabilidad alta, dio ${result.mode}`);
});

test('calculateVulnerability: atacante débil + defensa élite = vulnerabilidad casi nula', () => {
    const result = calculateVulnerability(18, 92, 'alto');
    assert.ok(result.mode <= 5, `esperaba vulnerabilidad casi nula, dio ${result.mode}`);
});

test('calculateReduccionALE: mejorar la defensa da reducción positiva', () => {
    assert.strictEqual(calculateReduccionALE(26, 75) > 0, true);
});

test('calculateReduccionALE: degradar la defensa NO da reducción (protección contra mal uso)', () => {
    assert.strictEqual(calculateReduccionALE(75, 26), 0);
});

test('calculateInsuranceRetainedALE: límite=0 significa CERO cobertura extra, no ilimitada', () => {
    const losses = [100000];
    const retained = calculateInsuranceRetainedALE(losses, 10000, 0, false);
    assert.strictEqual(retained, 100000); // se retiene casi toda la pérdida, el seguro no cubre nada arriba del deducible
});

test('calculateInsuranceRetainedALE: cobertura ilimitada sí cubre todo el excedente', () => {
    const losses = [100000];
    const retained = calculateInsuranceRetainedALE(losses, 10000, 0, true);
    assert.strictEqual(retained, 10000); // solo se retiene el deducible
});

test('calculateROSI: costo 0 devuelve null (no está definido matemáticamente)', () => {
    assert.strictEqual(calculateROSI(0, 50000), null);
});

test('evaluateFairThreat: clasifica correctamente como Crítico por encima del umbral', () => {
    const criteria = { aleAceptable: 50000, aleCritico: 250000 };
    const fmt = (n) => `$${n}`;
    const result = evaluateFairThreat(300000, 100000, criteria, fmt);
    assert.strictEqual(result.severity, 'critico');
});
