'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
    mulberry32,
    getTriangularRandom,
    getPertRandom,
    getLognormalRandom,
    triangularVariance,
    solveLognormalSigmaSquared,
} = require('../src/lib/random');
const { runMonteCarloSimulation, summarizeLosses, pearsonCorrelation } = require('../src/lib/simulation');
const { calculateVulnerability, calculateReduccionALE } = require('../src/lib/autocalc');
const {
    calculateInsuranceRetainedALE,
    calculateROSI,
    expectedNetBenefit,
    evaluateMitigarConTransferir,
    RELIABILITY_TO_PROBABILITY,
    evaluateTreatmentStrategies,
} = require('../src/lib/treatment');
const { evaluateFairThreat } = require('../src/lib/evaluation');
const { calculateParetoAnalysis } = require('../src/lib/register');
const { sampleActivatedTransitions, walkMarkovChain } = require('../src/lib/markov');
const {
    cptKey,
    sampleFromDistribution,
    forwardSample,
    likelihoodWeightedSample,
    inferPosterior,
} = require('../src/lib/bayesianNetwork');
const { expectedValue, evaluateDecisionTree } = require('../src/lib/decisionTree');

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

// --- markov.js (motor todavía sin conectar a ningún endpoint, ver el comentario del archivo) ---
// Generador de rng falso y determinista para probar sin depender de mulberry32: devuelve, en
// orden, los valores exactos que se le pasan — así cada prueba controla con precisión qué
// transición "gana" y cuál no, en vez de depender de una semilla y confiar en que le toque bien.
function fakeRng(sequence) {
    let i = 0;
    return () => sequence[i++ % sequence.length];
}

test('sampleActivatedTransitions: rng por debajo de la probabilidad -> se activa', () => {
    const transitions = [
        { state: 'b', probability: 0.5 },
        { state: 'c', probability: 0.5 },
    ];
    // 0.1 < 0.5 (se activa) y 0.9 no < 0.5 (no se activa) — una de cada.
    const activated = sampleActivatedTransitions(transitions, fakeRng([0.1, 0.9]));
    assert.deepStrictEqual(activated, ['b']);
});

test('sampleActivatedTransitions: no son mutuamente excluyentes, pueden activarse varias a la vez', () => {
    const transitions = [
        { state: 'interrupcion-operativa', probability: 0.6 },
        { state: 'dano-reputacional', probability: 0.6 },
    ];
    const activated = sampleActivatedTransitions(transitions, fakeRng([0.1, 0.1]));
    assert.deepStrictEqual(activated, ['interrupcion-operativa', 'dano-reputacional']);
});

test('sampleActivatedTransitions: sin transiciones (estado hoja) no revienta, devuelve vacío', () => {
    assert.deepStrictEqual(sampleActivatedTransitions([], fakeRng([0])), []);
    assert.deepStrictEqual(sampleActivatedTransitions(undefined, fakeRng([0])), []);
});

test('walkMarkovChain: baja en cascada mientras cada transición se dispare', () => {
    // incendio -> interrupcion -> perdida-clientes (cadena de 3, ver el ejemplo de la
    // conversación) — rng siempre 0.1 hace que CUALQUIER probabilidad > 0.1 se dispare.
    const graph = {
        incendio: [{ state: 'interrupcion', probability: 0.4 }],
        interrupcion: [{ state: 'perdida-clientes', probability: 0.4 }],
        'perdida-clientes': [],
    };
    const activated = walkMarkovChain('incendio', (s) => graph[s], fakeRng([0.1]));
    assert.deepStrictEqual(activated, ['incendio', 'interrupcion', 'perdida-clientes']);
});

test('walkMarkovChain: si una transición no se dispara, la cadena se corta ahí (no sigue de largo)', () => {
    const graph = {
        incendio: [{ state: 'interrupcion', probability: 0.4 }],
        interrupcion: [{ state: 'perdida-clientes', probability: 0.4 }],
        'perdida-clientes': [],
    };
    // 0.1 (sí dispara incendio->interrupcion) seguido de 0.9 (NO dispara interrupcion->perdida)
    const activated = walkMarkovChain('incendio', (s) => graph[s], fakeRng([0.1, 0.9]));
    assert.deepStrictEqual(activated, ['incendio', 'interrupcion']);
});

test('walkMarkovChain: un padre con varios hijos puede activar más de uno en la misma corrida', () => {
    const graph = {
        incendio: [
            { state: 'interrupcion-operativa', probability: 0.5 },
            { state: 'dano-reputacional', probability: 0.5 },
        ],
        'interrupcion-operativa': [],
        'dano-reputacional': [],
    };
    const activated = walkMarkovChain('incendio', (s) => graph[s], fakeRng([0.1]));
    assert.deepStrictEqual(activated, ['incendio', 'interrupcion-operativa', 'dano-reputacional']);
});

test('walkMarkovChain: un ciclo en el grafo (A -> B -> A) no cuelga la función, cada estado se activa una sola vez', () => {
    const graph = {
        a: [{ state: 'b', probability: 1 }],
        b: [{ state: 'a', probability: 1 }],
    };
    // rng siempre 0 -> todas las transiciones se disparan siempre; si no hubiera protección
    // contra ciclos, esto correría para siempre en vez de terminar.
    const activated = walkMarkovChain('a', (s) => graph[s], fakeRng([0]));
    assert.deepStrictEqual(activated, ['a', 'b']);
});

test('walkMarkovChain: es reproducible con la misma semilla (mulberry32), igual que el resto del motor', () => {
    const graph = {
        incendio: [
            { state: 'interrupcion-operativa', probability: 0.5 },
            { state: 'dano-reputacional', probability: 0.3 },
        ],
        'interrupcion-operativa': [{ state: 'perdida-clientes', probability: 0.4 }],
        'dano-reputacional': [],
        'perdida-clientes': [],
    };
    const runA = walkMarkovChain('incendio', (s) => graph[s], mulberry32(7));
    const runB = walkMarkovChain('incendio', (s) => graph[s], mulberry32(7));
    assert.deepStrictEqual(runA, runB);
});

// --- bayesianNetwork.js (motor todavía sin conectar a ningún endpoint, ver el comentario del
// archivo) --- Red de 2 nodos reutilizada en varias pruebas: "moneda" (raíz, 50/50) causa
// "resultado" con distinta probabilidad según salga cara o sello — el ejemplo clásico de libro
// de texto para validar inferencia bayesiana, porque el posterior correcto se puede calcular a
// mano con la regla de Bayes y comparar contra lo que estima el motor.
const coinNetwork = [
    { name: 'moneda', states: ['cara', 'sello'], parents: [], cpt: { '': { cara: 0.5, sello: 0.5 } } },
    {
        name: 'resultado',
        states: ['exito', 'fallo'],
        parents: ['moneda'],
        cpt: {
            cara: { exito: 0.9, fallo: 0.1 },
            sello: { exito: 0.2, fallo: 0.8 },
        },
    },
];

test('cptKey: une los valores de los padres con "|", en su mismo orden', () => {
    assert.strictEqual(cptKey(['organizado', 'basica']), 'organizado|basica');
    assert.strictEqual(cptKey([]), '');
});

test('sampleFromDistribution: se queda con el primer estado cuyo acumulado supera el número aleatorio', () => {
    const dist = { baja: 0.2, media: 0.3, alta: 0.5 };
    // acumulados: baja hasta 0.2, media hasta 0.5, alta hasta 1.0
    assert.strictEqual(sampleFromDistribution(dist, fakeRng([0.1])), 'baja');
    assert.strictEqual(sampleFromDistribution(dist, fakeRng([0.25])), 'media');
    assert.strictEqual(sampleFromDistribution(dist, fakeRng([0.9])), 'alta');
});

test('sampleFromDistribution: si la suma da un poco menos de 1 por redondeo, el último estado es respaldo', () => {
    const dist = { a: 0.3333, b: 0.3333, c: 0.3333 }; // suma 0.9999, no 1
    assert.strictEqual(sampleFromDistribution(dist, fakeRng([0.99999])), 'c');
});

test('forwardSample: el hijo se muestrea según la fila que corresponde al valor YA muestreado del padre', () => {
    // rng bajo -> "moneda" sale cara (primer estado); para "resultado" con padre=cara, rng bajo
    // también cae en "exito" (primer estado de esa fila).
    const assignment = forwardSample(coinNetwork, fakeRng([0.1, 0.1]));
    assert.deepStrictEqual(assignment, { moneda: 'cara', resultado: 'exito' });
});

test('likelihoodWeightedSample: un nodo con evidencia se fija a ese valor, no se muestrea', () => {
    // "moneda" no tiene evidencia -> se muestrea (rng bajo -> cara). "resultado" SÍ tiene
    // evidencia (fallo) -> se fija ahí sin consultar el rng para ese nodo.
    const { assignment, weight } = likelihoodWeightedSample(coinNetwork, { resultado: 'fallo' }, fakeRng([0.1]));
    assert.strictEqual(assignment.moneda, 'cara');
    assert.strictEqual(assignment.resultado, 'fallo');
    // peso = P(resultado=fallo | moneda=cara) = 0.1, según la tabla de coinNetwork
    assert.ok(Math.abs(weight - 0.1) < 1e-9);
});

test('likelihoodWeightedSample: evidencia imposible según la tabla (probabilidad 0) da peso 0, no revienta', () => {
    const imposibleNetwork = [
        { name: 'a', states: ['x'], parents: [], cpt: { '': { x: 1 } } },
        { name: 'b', states: ['si', 'no'], parents: ['a'], cpt: { x: { si: 1, no: 0 } } },
    ];
    const { weight } = likelihoodWeightedSample(imposibleNetwork, { b: 'no' }, fakeRng([0]));
    assert.strictEqual(weight, 0);
});

test('inferPosterior: estima el posterior correcto (validado contra la regla de Bayes calculada a mano)', () => {
    // P(moneda=cara | resultado=exito), a mano:
    //   = P(exito|cara)*P(cara) / [P(exito|cara)*P(cara) + P(exito|sello)*P(sello)]
    //   = (0.9*0.5) / (0.9*0.5 + 0.2*0.5) = 0.45 / 0.55 = 0.8181818...
    const posterior = inferPosterior(coinNetwork, 'moneda', { resultado: 'exito' }, 50000, mulberry32(42));
    assert.ok(posterior.cara > 0.8 && posterior.cara < 0.84, `esperaba ~0.818, dio ${posterior.cara}`);
    assert.ok(Math.abs(posterior.cara + posterior.sello - 1) < 1e-9, 'el posterior debe sumar 1');
});

test('inferPosterior: sin evidencia, el posterior converge a la creencia previa (el 50/50 de la tabla raíz)', () => {
    const posterior = inferPosterior(coinNetwork, 'moneda', {}, 50000, mulberry32(3));
    assert.ok(Math.abs(posterior.cara - 0.5) < 0.02, `esperaba ~0.5 sin evidencia, dio ${posterior.cara}`);
});

test('inferPosterior: evidencia imposible según la red -> null (probabilidad total 0), no revienta', () => {
    const imposibleNetwork = [
        { name: 'a', states: ['x'], parents: [], cpt: { '': { x: 1 } } },
        { name: 'b', states: ['si', 'no'], parents: ['a'], cpt: { x: { si: 1, no: 0 } } },
    ];
    const posterior = inferPosterior(imposibleNetwork, 'a', { b: 'no' }, 100, mulberry32(1));
    assert.strictEqual(posterior, null);
});

// --- decisionTree.js (motor todavía sin conectar a ningún endpoint, ver el comentario del
// archivo) --- A diferencia de Markov/red bayesiana, esto es matemática exacta (no muestreo), así
// que las pruebas comparan contra el número calculado a mano, sin ninguna tolerancia estadística.

test('expectedValue: promedio ponderado por probabilidad', () => {
    const branches = [
        { probability: 0.8, value: 50000 },
        { probability: 0.2, value: -10000 },
    ];
    // 0.8*50000 + 0.2*(-10000) = 40000 - 2000 = 38000
    assert.strictEqual(expectedValue(branches), 38000);
});

test('evaluateDecisionTree: "Mitigar" (nodo de azar por reliability) le gana a "Aceptar" (terminal)', () => {
    // Mismo ejemplo del comentario del archivo: reliability=alta (0.8) se traduce en la
    // probabilidad de que el control SÍ funcione.
    const tree = {
        type: 'decision',
        options: [
            {
                label: 'Aceptar',
                node: { type: 'terminal', value: 0 },
            },
            {
                label: 'Mitigar',
                node: {
                    type: 'chance',
                    label: '¿el control funciona?',
                    branches: [
                        { probability: 0.8, node: { type: 'terminal', value: 50000 } }, // funciona: avoidedLoss - cost
                        { probability: 0.2, node: { type: 'terminal', value: -10000 } }, // falla: -cost (pagado, sin beneficio)
                    ],
                },
            },
        ],
    };
    const result = evaluateDecisionTree(tree);
    assert.strictEqual(result.bestOption, 'Mitigar');
    assert.strictEqual(result.value, 38000);
    // Las DOS opciones quedan evaluadas, no solo la ganadora — para poder comparar todas.
    assert.strictEqual(result.options.find((o) => o.label === 'Aceptar').value, 0);
    assert.strictEqual(result.options.find((o) => o.label === 'Mitigar').value, 38000);
});

test('evaluateDecisionTree: elige la mejor entre 3 opciones, no solo compara la primera contra la segunda', () => {
    const tree = {
        type: 'decision',
        options: [
            { label: 'Aceptar', node: { type: 'terminal', value: 0 } },
            { label: 'Transferir', node: { type: 'terminal', value: 25000 } },
            { label: 'Evitar', node: { type: 'terminal', value: 15000 } },
        ],
    };
    const result = evaluateDecisionTree(tree);
    assert.strictEqual(result.bestOption, 'Transferir');
    assert.strictEqual(result.value, 25000);
});

test('evaluateDecisionTree: recorre árboles anidados (azar dentro de decisión dentro de azar)', () => {
    // Si el control falla (20%), hay una SEGUNDA decisión: aceptar la pérdida residual (-10000)
    // o reforzar pagando más (-4000). Reforzar es mejor, así que debería tomarse esa rama.
    const tree = {
        type: 'chance',
        branches: [
            { probability: 0.8, node: { type: 'terminal', value: 50000 } },
            {
                probability: 0.2,
                node: {
                    type: 'decision',
                    options: [
                        { label: 'Aceptar residual', node: { type: 'terminal', value: -10000 } },
                        { label: 'Reforzar', node: { type: 'terminal', value: -4000 } },
                    ],
                },
            },
        ],
    };
    // 0.8*50000 + 0.2*(-4000, la mejor de las dos sub-opciones) = 40000 - 800 = 39200
    const result = evaluateDecisionTree(tree);
    assert.strictEqual(result.value, 39200);
    assert.strictEqual(result.branches[1].bestOption, 'Reforzar');
});

test('evaluateDecisionTree: probabilidades de un nodo "chance" que no suman 1 revienta con error explícito', () => {
    const tree = {
        type: 'chance',
        label: 'mal capturado',
        branches: [
            { probability: 0.8, node: { type: 'terminal', value: 100 } },
            { probability: 0.5, node: { type: 'terminal', value: 200 } }, // 0.8+0.5 = 1.3, no 1
        ],
    };
    assert.throws(() => evaluateDecisionTree(tree), /mal capturado/);
});

test('evaluateDecisionTree: un nodo "decision" sin opciones, o "chance" sin ramas, revienta con error explícito', () => {
    assert.throws(() => evaluateDecisionTree({ type: 'decision', options: [] }), /al menos una opción/);
    assert.throws(() => evaluateDecisionTree({ type: 'chance', branches: [] }), /al menos una rama/);
});

test('evaluateDecisionTree: un tipo de nodo desconocido (o ausente) revienta con error explícito', () => {
    assert.throws(() => evaluateDecisionTree({ type: 'no-existe', value: 1 }), /tipo de nodo desconocido/);
    assert.throws(() => evaluateDecisionTree({}), /necesita un "type"/);
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
    // netBenefit ya no es currentALE - cost (95000, determinista) — es el valor ESPERADO bajo
    // Fiabilidad "alta" (90% de probabilidad, ver RELIABILITY_TO_PROBABILITY en treatment.js):
    //   0.9*(100000-5000) + 0.1*(-5000) = 85500 - 500 = 85000
    assert.strictEqual(result.recommendation.netBenefit, 85000);
});

test('evaluateTreatmentStrategies: NO recomienda "Mitigar" cuando su costo se dejó en el default (0) sin tocar', () => {
    // Bug real encontrado: reductionPercent se autocalcula solo en cuanto se elige un nivel de
    // defensa objetivo (ver App.Treatment.updateReduccionALEAuto, frontend), ANTES de que el
    // usuario haya escrito ningún costo — así que avoidedLoss > 0 con cost = 0 (su default) era
    // frecuente, no un caso raro, y Mitigar quedaba "activa" con beneficio neto = 100% de la
    // reducción gratis, como si mantener un control de seguridad no costara nada.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            mitigar: { cost: 0, reductionPercent: 60, reliability: 'media', delayDays: 0 }, // costo nunca tocado
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.recommendation.strategy, 'aceptar');
    // Mismo problema a nivel de veredicto individual: sin este chequeo, la fila de "Mitigar" por
    // sí sola mostraba "✅ SÍ conviene, sin costo capturado" — contradiciendo la recomendación.
    assert.strictEqual(result.mitigar.verdict.verdict, 'sin_datos');
});

test('evaluateTreatmentStrategies: NO recomienda "Transferir" cuando la prima se dejó en el default (0) sin tocar', () => {
    // Mismo bug que Mitigar: deducible/límite se pueden capturar antes de escribir la prima
    // anual (0 por default) — una póliza de seguro real siempre tiene prima.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: [80000, 90000, 100000, 110000, 120000],
            mitigar: { cost: 0, reductionPercent: 0, reliability: 'media', delayDays: 0 },
            transferir: {
                premium: 0, // nunca tocado
                deductible: 20000,
                limit: 0,
                unlimited: true,
                reliability: 'media',
                delayDays: 0,
            },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.recommendation.strategy, 'aceptar');
    assert.strictEqual(result.transferir.verdict.verdict, 'sin_datos');
});

test('evaluateTreatmentStrategies: SÍ recomienda "Mitigar" cuando tiene costo real capturado y gana en beneficio neto', () => {
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            mitigar: { cost: 10000, reductionPercent: 60, reliability: 'media', delayDays: 0 },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.recommendation.strategy, 'mitigar');
    // netBenefit ya no es avoidedLoss - cost (50000, determinista) — es el valor ESPERADO bajo
    // Fiabilidad "media" (70%, ver RELIABILITY_TO_PROBABILITY en treatment.js):
    //   0.7*(60000-10000) + 0.3*(-10000) = 35000 - 3000 = 32000
    assert.strictEqual(result.recommendation.netBenefit, 32000);
    assert.strictEqual(result.mitigar.verdict.verdict, 'conviene');
});

test('expectedNetBenefit: usa la probabilidad de RELIABILITY_TO_PROBABILITY para cada nivel de Fiabilidad', () => {
    // cost=10000, avoidedLoss=40000 (si funciona: 30000; si falla: -10000)
    Object.entries(RELIABILITY_TO_PROBABILITY).forEach(([reliability, p]) => {
        const expected = p * 30000 + (1 - p) * -10000;
        assert.ok(
            Math.abs(expectedNetBenefit(10000, 40000, reliability) - expected) < 1e-9,
            `Fiabilidad "${reliability}" (p=${p})`,
        );
    });
});

test('expectedNetBenefit: una Fiabilidad desconocida cae al mismo trato que "media" (no revienta)', () => {
    assert.strictEqual(expectedNetBenefit(10000, 40000, 'no-existe'), expectedNetBenefit(10000, 40000, 'media'));
});

test('evaluateTreatmentStrategies: la Fiabilidad SÍ puede cambiar cuál estrategia se recomienda, no solo advertir con texto', () => {
    // Bug real corregido: antes, "reliability" no entraba a ningún cálculo — dos estrategias con
    // el mismo beneficio neto "de punto" (avoidedLoss - cost) siempre quedaban empatadas sin
    // importar qué tan confiable fuera cada una. Acá Mitigar tiene el MAYOR beneficio neto
    // ingenuo (70000) pero Fiabilidad Baja; Evitar tiene un beneficio neto ingenuo MENOR (60000)
    // pero Fiabilidad Alta — con el árbol de decisión, Evitar gana de verdad, no solo en teoría.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            // avoidedLoss=90000, cost=20000 -> neto ingenuo = 70000; con Fiabilidad Baja (40%):
            //   0.4*70000 + 0.6*(-20000) = 28000 - 12000 = 16000
            mitigar: { cost: 20000, reductionPercent: 90, reliability: 'baja', delayDays: 0 },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            // avoidedLoss=100000, cost=40000 -> neto ingenuo = 60000 (MENOS que Mitigar); con
            // Fiabilidad Alta (90%): 0.9*60000 + 0.1*(-40000) = 54000 - 4000 = 50000
            evitar: { cost: 40000, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.mitigar.netBenefit, 16000);
    assert.strictEqual(result.evitar.netBenefit, 50000);
    // Sin este fix, "mitigar" ganaría (70000 > 60000, comparando el beneficio ingenuo) — con el
    // beneficio esperado real, "evitar" es la mejor opción.
    assert.strictEqual(result.recommendation.strategy, 'evitar');
    assert.strictEqual(result.recommendation.netBenefit, 50000);
});

test('evaluateMitigarConTransferir: sin annualLosses, transferir queda siempre dominado por aceptar (el seguro no reduce nada sin datos de pólizas simuladas)', () => {
    // Sin annualLosses no hay con qué calcular cuánto reduce la póliza (canCalculateInsurance =
    // false) — el residual "retenido" se trata igual que si nunca se transfiriera, así que
    // transferir solo agrega el costo de la prima sin ningún beneficio: SIEMPRE pierde contra
    // aceptar por exactamente el monto de la prima, en ambas ramas del árbol.
    const result = evaluateMitigarConTransferir({
        currentALE: 100000,
        annualLosses: null,
        mitigar: { cost: 10000, reductionPercent: 50, reliability: 'alta' },
        transferir: { premium: 5000, reliability: 'alta', deductible: 0, limit: 0, unlimited: false },
    });
    // Rama "mitigar funciona" (p=0.9): aceptar dado baseALE=50000 = 100000-50000-10000 = 40000;
    // transferir (con o sin éxito) = 40000-5000 = 35000 en ambos casos → gana aceptar (40000).
    // Rama "mitigar falla" (p=0.1): aceptar dado baseALE=100000 = 100000-100000-10000 = -10000;
    // transferir = -10000-5000 = -15000 en ambos casos → gana aceptar (-10000).
    // Valor total = 0.9*40000 + 0.1*(-10000) = 36000 - 1000 = 35000.
    assert.strictEqual(result.value, 35000);
    // result.branches viene de evaluateDecisionTree(tree) (spread en el retorno) — las ramas YA
    // evaluadas, con su `bestOption`; result.tree es el árbol crudo SIN evaluar (solo para
    // inspección/depuración), sus ramas tienen `.node`, no `.bestOption`.
    assert.strictEqual(result.branches[0].bestOption, 'aceptar');
    assert.strictEqual(result.branches[1].bestOption, 'aceptar');
});

test('evaluateMitigarConTransferir: con annualLosses, cada rama del residual puede elegir una opción distinta (aceptar vs transferir)', () => {
    // Caso diseñado para que la rama "mitigar funciona" (el residual ya es ~0, transferir no
    // aporta nada) elija aceptar, y la rama "mitigar falla" (el residual sigue siendo el ALE
    // completo, y el seguro sí reduce bastante gracias al deducible) elija transferir — el árbol
    // no colapsa a una sola opción "global", decide por separado en cada rama.
    const result = evaluateMitigarConTransferir({
        currentALE: 100000,
        annualLosses: [100000],
        mitigar: { cost: 10000, reductionPercent: 100, reliability: 'alta' },
        transferir: { premium: 5000, reliability: 'alta', deductible: 20000, limit: 0, unlimited: true },
    });
    // Rama "mitigar funciona" (p=0.9, baseALE=0): aceptar = 100000-0-10000 = 90000; transferir
    // (retainedALE=0 también, sin residual que asegurar) = 90000-5000 = 85000 → gana aceptar.
    // Rama "mitigar falla" (p=0.1, baseALE=100000): aceptar = -10000; retainedALE=20000 (seguro
    // con deducible 20000, sin límite), transferir = 0.9*(100000-20000-10000-5000) +
    // 0.1*(-10000-5000) = 0.9*65000 + 0.1*(-15000) = 58500-1500 = 57000 → gana transferir.
    assert.strictEqual(result.branches[0].bestOption, 'aceptar');
    assert.strictEqual(result.branches[0].value, 90000);
    assert.strictEqual(result.branches[1].bestOption, 'transferir');
    assert.strictEqual(result.branches[1].value, 57000);
    // Total = 0.9*90000 + 0.1*57000 = 81000 + 5700 = 86700.
    assert.strictEqual(result.value, 86700);
});

test('evaluateTreatmentStrategies: NO evalúa la combinación Mitigar+Transferir si falta el costo de cualquiera de las dos', () => {
    // Mismo criterio de "no hay estrategia gratis" que las 3 estrategias individuales — la
    // combinación tampoco debe aparecer como opción si cualquiera de sus 2 partes está en su
    // default (0) sin tocar.
    const fmt = (n) => `$${n}`;
    const sinTransferir = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: [100000],
            mitigar: { cost: 10000, reductionPercent: 100, reliability: 'alta', delayDays: 0 },
            transferir: { premium: 0, deductible: 20000, limit: 0, unlimited: true, reliability: 'alta', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(sinTransferir.mitigarTransferir, undefined);

    const sinMitigar = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: [100000],
            mitigar: { cost: 0, reductionPercent: 0, reliability: 'alta', delayDays: 0 },
            transferir: {
                premium: 5000,
                deductible: 20000,
                limit: 0,
                unlimited: true,
                reliability: 'alta',
                delayDays: 0,
            },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(sinMitigar.mitigarTransferir, undefined);
});

test('evaluateTreatmentStrategies: la combinación Mitigar+Transferir puede ganar la recomendación por encima de cualquier estrategia individual', () => {
    // Mismos números que el test de evaluateMitigarConTransferir de arriba (combo = 86700) — acá
    // se confirma que, comparada con Mitigar solo (80000), Transferir solo (67000) y Evitar
    // (30000), la combinación gana la recomendación general, no solo su propio cálculo aislado.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: [100000],
            mitigar: { cost: 10000, reductionPercent: 100, reliability: 'alta', delayDays: 0 },
            transferir: {
                premium: 5000,
                deductible: 20000,
                limit: 0,
                unlimited: true,
                reliability: 'alta',
                delayDays: 0,
            },
            evitar: { cost: 60000, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.mitigar.netBenefit, 80000);
    assert.strictEqual(result.transferir.netBenefit, 67000);
    assert.strictEqual(result.evitar.netBenefit, 30000);
    assert.strictEqual(result.mitigarTransferir.netBenefit, 86700);
    assert.strictEqual(result.mitigarTransferir.cost, 15000); // mitigar.cost + transferir.premium
    assert.strictEqual(result.recommendation.strategy, 'mitigarTransferir');
    assert.strictEqual(result.recommendation.netBenefit, 86700);
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
test('getLognormalRandom: ln(muestras) converge a Normal(mu, sigma²), con sigma² resuelto para igualar la varianza de la triangular', () => {
    // La varianza de la lognormal en sí (no la de sus logaritmos) es un estimador más ruidoso
    // que su propia media — la forma correcta y estable de validar mu/sigma² es en espacio
    // logarítmico: por construcción, ln(muestra) = mu + sigma·Z con Z ~ Normal(0,1), así que
    // ln(muestras) debe converger a Normal(mu, sigma²) — eso sí converge rápido y con poco
    // ruido, incluso para el sigma² grande que puede salir de un caso muy sesgado.
    const rng = mulberry32(2026);
    const cases = [
        { min: 10000, mode: 50000, max: 150000 },
        { min: 1000, mode: 5000, max: 200000 }, // muy sesgada — el caso típico de Magnitud de Pérdida
        { min: 0, mode: 20000, max: 40000 }, // min=0 — ya NO cae a triangular (solo mode<=0 lo hace)
    ];
    const n = 200000;

    for (const { min, mode, max } of cases) {
        const sigmaSquared = solveLognormalSigmaSquared(mode, triangularVariance(min, mode, max));
        const sigma = Math.sqrt(sigmaSquared);
        const mu = Math.log(mode) + sigmaSquared;

        const samples = new Array(n);
        for (let i = 0; i < n; i++) samples[i] = getLognormalRandom(min, mode, max, rng);

        const logs = samples.map((x) => Math.log(x));
        const logMean = logs.reduce((a, b) => a + b, 0) / n;
        const logVariance = logs.reduce((sum, x) => sum + (x - logMean) ** 2, 0) / n;
        const logMeanAbsError = Math.abs(logMean - mu);
        const logVarAbsError = Math.abs(logVariance - sigmaSquared);

        assert.ok(
            logMeanAbsError < Math.max(0.02, sigma * 0.02),
            `min=${min} moda=${mode} max=${max}: media de ln(muestras) ${logMean.toFixed(4)} vs mu teórico ${mu.toFixed(4)} (dif ${logMeanAbsError.toFixed(4)})`,
        );
        assert.ok(
            logVarAbsError < Math.max(0.001, sigmaSquared * 0.1),
            `min=${min} moda=${mode} max=${max}: varianza de ln(muestras) ${logVariance.toFixed(4)} vs sigma² teórico ${sigmaSquared.toFixed(4)} (dif ${logVarAbsError.toFixed(4)})`,
        );
    }
});

test('getLognormalRandom: la varianza muestral (en dinero, no en logaritmos) converge a la MISMA varianza que tendría la triangular con ese min/moda/max', () => {
    // Esta es la propiedad que motivó el ajuste por momentos: el "ancho de incertidumbre" que
    // implican min/moda/max debe quedar igual que antes (con triangular) — solo cambia la
    // forma de la curva, no cuánta incertidumbre hay.
    const rng = mulberry32(99);
    const { min, mode, max } = { min: 10000, mode: 50000, max: 150000 };
    const n = 300000;
    const samples = new Array(n);
    for (let i = 0; i < n; i++) samples[i] = getLognormalRandom(min, mode, max, rng);

    const mean = samples.reduce((a, b) => a + b, 0) / n;
    const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
    const targetVariance = triangularVariance(min, mode, max);
    const relError = Math.abs(variance - targetVariance) / targetVariance;

    assert.ok(
        relError < 0.05,
        `varianza muestral ${variance.toFixed(0)} vs varianza de la triangular equivalente ${targetVariance.toFixed(0)} (error ${(relError * 100).toFixed(2)}%)`,
    );
});

test('getLognormalRandom: SÍ puede superar max, pero con probabilidad baja (no el ~50% que daba la calibración por percentil 5/95 descartada)', () => {
    const rng = mulberry32(3);
    const n = 50000;
    let exceedCount = 0;
    for (let i = 0; i < n; i++) {
        if (getLognormalRandom(10000, 50000, 150000, rng) > 150000) exceedCount++;
    }
    const pct = exceedCount / n;
    assert.ok(pct > 0, 'con 50,000 muestras, se esperaba que al menos una superara max (no es un techo absoluto)');
    assert.ok(
        pct < 0.1,
        `se esperaba superar max en menos del 10% de las muestras (dio ${(pct * 100).toFixed(2)}%) — si no, la cola sigue exagerada`,
    );
});

test('getLognormalRandom: con min=0 y moda>0, YA NO cae a triangular (el ajuste por momentos no necesita min>0)', () => {
    const rngA = mulberry32(55);
    const rngB = mulberry32(55);
    const fromLognormal = getLognormalRandom(0, 5000, 20000, rngA);
    const fromTriangular = getTriangularRandom(0, 5000, 20000, rngB);
    assert.notStrictEqual(fromLognormal, fromTriangular);
});

test('getLognormalRandom: con moda en 0 (categoría de pérdida sin costo típico), cae a triangular en vez de reventar', () => {
    const rngA = mulberry32(55);
    const rngB = mulberry32(55);
    const fromLognormal = getLognormalRandom(0, 0, 20000, rngA);
    const fromTriangular = getTriangularRandom(0, 0, 20000, rngB);
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
