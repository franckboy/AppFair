'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mulberry32, getTriangularRandom, getPertRandom, getLognormalRandom } = require('../src/lib/random');
const { runMonteCarloSimulation, summarizeLosses, pearsonCorrelation } = require('../src/lib/simulation');
const { calculateVulnerability, calculateReduccionALE } = require('../src/lib/autocalc');
const { calculateInsuranceRetainedALE, calculateROSI, evaluateTreatmentStrategies } = require('../src/lib/treatment');
const { evaluateFairThreat } = require('../src/lib/evaluation');
const { calculateParetoAnalysis } = require('../src/lib/register');

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
        iterations: 2000,
        seed: 999,
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

test('evaluateTreatmentStrategies: NO recomienda "Evitar" cuando su costo se dejó en el default (0) sin tocar', () => {
    // Bug real encontrado: avoidedLoss de Evitar es SIEMPRE currentALE (elimina el 100% del
    // riesgo por definición), a diferencia de Mitigar/Transferir cuyo avoidedLoss depende de
    // datos reales — sin este chequeo, Evitar quedaba "activa" con costo 0 (su default sin
    // tocar) y beneficio neto = 100% del ALE gratis, imposible de superar, así que ganaba la
    // recomendación siempre aunque el usuario nunca hubiera entrado a esa sección.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            mitigar: { cost: 15000, reductionPercent: 40, reliability: 'media', delayDays: 30 },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 }, // nunca tocado por el usuario
        },
        fmt,
    );
    assert.strictEqual(result.recommendation.strategy, 'mitigar');
    // Mismo problema a nivel de veredicto individual: sin este chequeo, la fila de "Evitar"
    // por sí sola mostraba "✅ SÍ conviene, sin costo capturado" — contradiciendo la
    // recomendación general de arriba.
    assert.strictEqual(result.evitar.verdict.verdict, 'sin_datos');
});

test('evaluateTreatmentStrategies: SÍ recomienda "Evitar" cuando tiene un costo real capturado y gana en beneficio neto', () => {
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            mitigar: { cost: 15000, reductionPercent: 40, reliability: 'media', delayDays: 30 },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 5000, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.recommendation.strategy, 'evitar');
    assert.strictEqual(result.recommendation.netBenefit, 95000);
});

test('evaluateFairThreat: clasifica correctamente como Crítico por encima del umbral', () => {
    const criteria = { aleAceptable: 50000, aleCritico: 250000 };
    const fmt = (n) => `$${n}`;
    const result = evaluateFairThreat(300000, 100000, criteria, fmt);
    assert.strictEqual(result.severity, 'critico');
});

test('calculateParetoAnalysis: excluye riesgos tipo "oportunidad" de la exposición total', () => {
    // Bug real: el "ale" de una oportunidad es un BENEFICIO esperado, no una pérdida — antes
    // de este chequeo, un beneficio grande se sumaba a la "exposición total" y competía por el
    // 80% de "prioriza el tratamiento aquí" como si fuera el peor riesgo del portafolio.
    const risks = [
        { riskName: 'Amenaza chica', ale: 50000, riskType: 'amenaza' },
        { riskName: 'Oportunidad grande', ale: 2000000, riskType: 'oportunidad' },
    ];
    const pareto = calculateParetoAnalysis(risks);
    assert.strictEqual(pareto.totalExposure, 50000);
    assert.strictEqual(pareto.totalRiskCount, 1);
    assert.ok(!pareto.risks.some((r) => r.riskName === 'Oportunidad grande'));
});

test('calculateParetoAnalysis: un riesgo sin riskType (guardado antes de que existiera el campo) se trata como amenaza', () => {
    const risks = [{ riskName: 'Riesgo viejo', ale: 80000 }];
    const pareto = calculateParetoAnalysis(risks);
    assert.strictEqual(pareto.totalExposure, 80000);
    assert.strictEqual(pareto.totalRiskCount, 1);
});

// --- Validación estadística del muestreador triangular ---
// Las pruebas de arriba verifican comportamiento puntual (casos concretos). Estas verifican
// que, a gran escala, el muestreador reproduce las propiedades teóricas conocidas de la
// distribución triangular — media = (min+moda+max)/3, varianza = (min²+moda²+max²-min·moda-
// min·max-moda·max)/18 — en vez de solo confiar en que la fórmula "se ve bien" en el código.
test('getTriangularRandom: la media y varianza muestral convergen a las teóricas de la distribución triangular', () => {
    const rng = mulberry32(2026);
    const cases = [
        { min: 0, mode: 50, max: 100 }, // simétrica
        { min: 10, mode: 20, max: 100 }, // sesgada a la derecha
    ];
    const n = 200000;

    for (const { min, mode, max } of cases) {
        const samples = new Array(n);
        for (let i = 0; i < n; i++) samples[i] = getTriangularRandom(min, mode, max, rng);

        const mean = samples.reduce((a, b) => a + b, 0) / n;
        const theoreticalMean = (min + mode + max) / 3;
        const meanRelError = Math.abs(mean - theoreticalMean) / theoreticalMean;

        const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
        const theoreticalVariance = (min ** 2 + mode ** 2 + max ** 2 - min * mode - min * max - mode * max) / 18;
        const varianceRelError = Math.abs(variance - theoreticalVariance) / theoreticalVariance;

        assert.ok(
            meanRelError < 0.01,
            `min=${min} moda=${mode} max=${max}: media muestral ${mean.toFixed(2)} vs teórica ${theoreticalMean.toFixed(2)} (error ${(meanRelError * 100).toFixed(2)}%)`,
        );
        assert.ok(
            varianceRelError < 0.05,
            `min=${min} moda=${mode} max=${max}: varianza muestral ${variance.toFixed(2)} vs teórica ${theoreticalVariance.toFixed(2)} (error ${(varianceRelError * 100).toFixed(2)}%)`,
        );
    }
});

// --- Validación estadística del muestreador Beta-PERT (TEF/Vulnerabilidad) ---
test('getPertRandom: la media y varianza muestral convergen a las teóricas de Beta-PERT (lambda=4)', () => {
    const rng = mulberry32(2026);
    const lambda = 4;
    const cases = [
        { min: 0, mode: 50, max: 100 }, // simétrica
        { min: 10, mode: 20, max: 100 }, // sesgada a la derecha
    ];
    const n = 200000;

    for (const { min, mode, max } of cases) {
        const samples = new Array(n);
        for (let i = 0; i < n; i++) samples[i] = getPertRandom(min, mode, max, lambda, rng);

        const mean = samples.reduce((a, b) => a + b, 0) / n;
        const theoreticalMean = (min + lambda * mode + max) / (lambda + 2);
        const meanRelError = Math.abs(mean - theoreticalMean) / theoreticalMean;

        const alpha = 1 + (lambda * (mode - min)) / (max - min);
        const beta = 1 + (lambda * (max - mode)) / (max - min);
        const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
        const theoreticalVariance = ((max - min) ** 2 * (alpha * beta)) / ((alpha + beta) ** 2 * (alpha + beta + 1));
        const varianceRelError = Math.abs(variance - theoreticalVariance) / theoreticalVariance;

        assert.ok(
            meanRelError < 0.01,
            `min=${min} moda=${mode} max=${max}: media muestral ${mean.toFixed(2)} vs teórica ${theoreticalMean.toFixed(2)} (error ${(meanRelError * 100).toFixed(2)}%)`,
        );
        assert.ok(
            varianceRelError < 0.05,
            `min=${min} moda=${mode} max=${max}: varianza muestral ${variance.toFixed(2)} vs teórica ${theoreticalVariance.toFixed(2)} (error ${(varianceRelError * 100).toFixed(2)}%)`,
        );
    }
});

test('getPertRandom: nunca devuelve valores fuera de [min, max] (a diferencia de lognormal, sí tiene techo duro)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50000; i++) {
        const val = getPertRandom(10, 15, 20, 4, rng);
        assert.ok(val >= 10 && val <= 20, `valor fuera de rango: ${val}`);
    }
});

// --- Validación estadística del muestreador lognormal (Magnitud de Pérdida) ---
test('getLognormalRandom: la media muestral converge a la teórica, y ln(muestras) converge a Normal(mu, sigma²)', () => {
    // La varianza de la lognormal en sí (no la de sus logaritmos) explota con sigma grande —
    // su estimador necesita muchísimas más de 200,000 muestras para converger de forma
    // estable, por la cola derecha pesada (no es un defecto del muestreador, es una propiedad
    // conocida de la distribución). La forma correcta y estable de validar la fórmula es en
    // espacio logarítmico: por construcción, ln(muestra) = mu + sigma·Z con Z ~ Normal(0,1),
    // así que ln(muestras) debe converger a Normal(mu, sigma²) — eso sí converge rápido.
    const rng = mulberry32(2026);
    const Z90 = 1.6448536269514722;
    const cases = [
        { min: 10000, mode: 50000, max: 150000 },
        { min: 1000, mode: 5000, max: 200000 }, // muy sesgada — el caso típico de Magnitud de Pérdida
    ];
    const n = 200000;

    for (const { min, mode, max } of cases) {
        const sigma = (Math.log(max) - Math.log(min)) / (2 * Z90);
        const mu = Math.log(mode) + sigma * sigma;

        const samples = new Array(n);
        for (let i = 0; i < n; i++) samples[i] = getLognormalRandom(min, mode, max, rng);

        const mean = samples.reduce((a, b) => a + b, 0) / n;
        const theoreticalMean = Math.exp(mu + (sigma * sigma) / 2);
        const meanRelError = Math.abs(mean - theoreticalMean) / theoreticalMean;
        assert.ok(
            meanRelError < 0.05,
            `min=${min} moda=${mode} max=${max}: media muestral ${mean.toFixed(2)} vs teórica ${theoreticalMean.toFixed(2)} (error ${(meanRelError * 100).toFixed(2)}%)`,
        );

        const logs = samples.map((x) => Math.log(x));
        const logMean = logs.reduce((a, b) => a + b, 0) / n;
        const logVariance = logs.reduce((sum, x) => sum + (x - logMean) ** 2, 0) / n;
        const logMeanAbsError = Math.abs(logMean - mu);
        const logVarRelError = Math.abs(logVariance - sigma * sigma) / (sigma * sigma);

        assert.ok(
            logMeanAbsError < 0.02,
            `min=${min} moda=${mode} max=${max}: media de ln(muestras) ${logMean.toFixed(4)} vs mu teórico ${mu.toFixed(4)} (dif ${logMeanAbsError.toFixed(4)})`,
        );
        assert.ok(
            logVarRelError < 0.05,
            `min=${min} moda=${mode} max=${max}: varianza de ln(muestras) ${logVariance.toFixed(4)} vs sigma² teórico ${(sigma * sigma).toFixed(4)} (error ${(logVarRelError * 100).toFixed(2)}%)`,
        );
    }
});

test('getLognormalRandom: SÍ puede superar max (percentil 95, no techo duro) — a diferencia de PERT/triangular', () => {
    const rng = mulberry32(3);
    let exceedsMax = false;
    for (let i = 0; i < 50000; i++) {
        if (getLognormalRandom(10000, 50000, 150000, rng) > 150000) {
            exceedsMax = true;
            break;
        }
    }
    assert.ok(exceedsMax, 'con 50,000 muestras, se esperaba que al menos una superara max (percentil 95, no absoluto)');
});

test('getLognormalRandom: con min o moda en 0 (categoría de pérdida sin costo en ese punto), cae a triangular en vez de reventar', () => {
    const rngA = mulberry32(55);
    const rngB = mulberry32(55);
    const fromLognormal = getLognormalRandom(0, 5000, 20000, rngA);
    const fromTriangular = getTriangularRandom(0, 5000, 20000, rngB);
    assert.strictEqual(fromLognormal, fromTriangular);
});

test('pearsonCorrelation: dos variables independientes dan una correlación cercana a 0', () => {
    const rngX = mulberry32(11);
    const rngY = mulberry32(22);
    const n = 50000;
    const x = Array.from({ length: n }, () => rngX());
    const y = Array.from({ length: n }, () => rngY());
    const r = pearsonCorrelation(x, y);
    assert.ok(Math.abs(r) < 0.02, `correlación entre variables independientes debería ser ~0, dio ${r.toFixed(4)}`);
});
