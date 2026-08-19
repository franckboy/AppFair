'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
    mulberry32,
    getTriangularRandom,
    getPertRandom,
    getLognormalRandom,
    getPoissonRandom,
    magnitudeParams,
    sampleMagnitude,
    triangularVariance,
    solveLognormalSigmaSquared,
} = require('../src/lib/random');
const {
    runMonteCarloSimulation,
    summarizeLosses,
    summarizeEventCounts,
    pearsonCorrelation,
    buildLossExceedanceCurve,
    LEC_EXCEEDANCE_PROBABILITIES,
    MAX_COMPOUND_TEF,
} = require('../src/lib/simulation');
const {
    simulatePortfolio,
    simulateResidualPortfolio,
    residualScaleFactor,
    residualSpecOf,
} = require('../src/lib/portfolioSimulation');
const { spearmanCorrelation } = require('../src/lib/simulation');
const {
    tullockSuccessProbability,
    attackerContestStrength,
    ATTACKER_CONTEST_CALIBRATION,
    buildContestTriangles,
    ACCESS_LEVELS,
    VULNERABILITY_FLOOR,
    sampleVulnerabilityFromProfiles,
    summarizeVulnerabilitySamples,
    calculateReduccionALEFromProfiles,
    calculateResidualFromSimulation,
    calculateResidualFromReduction,
    calculateInherentRiskFromSimulation,
    pairedVulnerabilitySample,
} = require('../src/lib/autocalc');
const { solveNashEquilibrium } = require('../src/lib/nashEquilibrium');
const {
    calculateInsuranceRetainedALE,
    calculateROSI,
    expectedNetBenefit,
    evaluateMitigarConTransferir,
    RELIABILITY_TO_PROBABILITY,
    evaluateTreatmentStrategies,
} = require('../src/lib/treatment');
const { evaluateFairThreat } = require('../src/lib/evaluation');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../src/lib/riskCriteria');
const {
    calculateParetoAnalysis,
    calculateResidualPortfolio,
    calculateResidualParetoAnalysis,
    calculateInherentPortfolio,
    calculateResidualMatrixPoint,
    exceedanceProbabilityAt,
} = require('../src/lib/register');
const { sampleActivatedTransitions, walkMarkovChain } = require('../src/lib/markov');
const { buildFamilySubtree, runFamilyCascadeSimulation, MAX_FAMILY_SIZE } = require('../src/lib/cascadeSimulation');
const {
    cptKey,
    sampleFromDistribution,
    forwardSample,
    likelihoodWeightedSample,
    inferPosterior,
} = require('../src/lib/bayesianNetwork');
const { expectedValue, evaluateDecisionTree } = require('../src/lib/decisionTree');
const { riskCatalog, attackerProfiles, defenseProfiles } = require('../src/data/profiles');
const { hazardStandards, isoProcessClauses, rimsClauses } = require('../src/data/standardsReference');

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

// --- cascadeSimulation.js (motor de "Simular Familia" — conecta markov.js + simulation.js) ---
function makeCascadeFamily() {
    const incendio = {
        riskName: 'Incendio',
        riskType: 'amenaza',
        tef: { min: 5, mode: 8, max: 12 },
        vuln: { min: 40, mode: 50, max: 60 },
        lossMagnitudes: { productividad: { min: 20000, mode: 30000, max: 50000 } },
    };
    const interrupcion = {
        riskName: 'Interrupcion',
        riskType: 'amenaza',
        triggeredBy: [{ riskName: 'Incendio', probability: 100 }], // fuerza la cascada en TODAS las iteraciones
        tef: { min: 1, mode: 2, max: 3 },
        vuln: { min: 30, mode: 40, max: 50 },
        lossMagnitudes: { productividad: { min: 10000, mode: 15000, max: 25000 } },
    };
    const danoReputacional = {
        riskName: 'DanoReputacional',
        riskType: 'amenaza',
        triggeredBy: [{ riskName: 'Incendio', probability: 50 }],
        // Sin tef/vuln/lossMagnitudes — "Sin analizar" (creado con el botón "+").
    };
    const ahorroEnSeguro = {
        riskName: 'Ahorro',
        riskType: 'oportunidad',
        triggeredBy: [{ riskName: 'Incendio', probability: 50 }],
        tef: { min: 1, mode: 2, max: 3 },
        vuln: { min: 30, mode: 40, max: 50 },
        lossMagnitudes: { productividad: { min: 5000, mode: 8000, max: 12000 } },
    };
    return [incendio, interrupcion, danoReputacional, ahorroEnSeguro];
}

test('buildFamilySubtree: arma el subárbol completo que cuelga de la raíz vía triggeredBy', () => {
    const { order, childrenOf } = buildFamilySubtree('Incendio', makeCascadeFamily());
    assert.deepStrictEqual([...order].sort(), ['Ahorro', 'DanoReputacional', 'Incendio', 'Interrupcion'].sort());
    assert.deepStrictEqual(
        (childrenOf.get('Incendio') || []).map((c) => c.riskName).sort(),
        ['Ahorro', 'DanoReputacional', 'Interrupcion'].sort(),
    );
});

test('buildFamilySubtree: un ciclo (A desencadena B, B desencadena A) no cuelga la función', () => {
    const register = [
        { riskName: 'A', triggeredBy: [{ riskName: 'B', probability: 100 }] },
        { riskName: 'B', triggeredBy: [{ riskName: 'A', probability: 100 }] },
    ];
    const { order } = buildFamilySubtree('A', register);
    assert.deepStrictEqual([...order].sort(), ['A', 'B']);
});

test('buildFamilySubtree: un riesgo con DOS padres aparece como hijo de AMBOS (multi-causa)', () => {
    // A y B son dos causas independientes del mismo hijo C — a diferencia del esquema viejo
    // (un solo triggeredByRiskName), esto ahora es representable: C debe listarse como hijo de
    // A Y de B a la vez, cada arista con su propia probabilidad.
    const register = [
        { riskName: 'A', riskType: 'amenaza' },
        { riskName: 'B', riskType: 'amenaza' },
        {
            riskName: 'C',
            riskType: 'amenaza',
            triggeredBy: [
                { riskName: 'A', probability: 30 },
                { riskName: 'B', probability: 70 },
            ],
        },
    ];
    const { childrenOf: childrenOfA } = buildFamilySubtree('A', register);
    const { childrenOf: childrenOfB } = buildFamilySubtree('B', register);
    assert.deepStrictEqual(
        (childrenOfA.get('A') || []).map((c) => ({ riskName: c.riskName, probability: c.probability })),
        [{ riskName: 'C', probability: 30 }],
    );
    assert.deepStrictEqual(
        (childrenOfB.get('B') || []).map((c) => ({ riskName: c.riskName, probability: c.probability })),
        [{ riskName: 'C', probability: 70 }],
    );
});

test('runFamilyCascadeSimulation: separa correctamente analizados (incluidos) de excluidos (sin analizar / oportunidad)', () => {
    const result = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 500,
        seed: 123,
    });
    assert.deepStrictEqual([...result.includedRiskNames].sort(), ['Incendio', 'Interrupcion']);
    const excludedNames = result.excludedRiskNames.map((e) => e.riskName).sort();
    assert.deepStrictEqual(excludedNames, ['Ahorro', 'DanoReputacional']);
    assert.match(result.excludedRiskNames.find((e) => e.riskName === 'DanoReputacional').reason, /sin analizar/i);
    assert.match(result.excludedRiskNames.find((e) => e.riskName === 'Ahorro').reason, /oportunidad/i);
});

test('runFamilyCascadeSimulation: la raíz se activa según SU PROPIA frecuencia, no el 100% de los años', () => {
    // Bug real corregido: la raíz entraba al recorrido siempre, así que propagaba a sus hijos los
    // 10.000 años y no solo aquellos en que de verdad ocurría. Medido en una familia de dos: el
    // hijo recibía un 77% más de activaciones por cascada de las que le correspondían.
    const result = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 4000,
        seed: 123,
    });
    assert.ok(
        result.activationRates['Incendio'] > 0 && result.activationRates['Incendio'] < 100,
        `la raíz debería activarse según su frecuencia, dio ${result.activationRates['Incendio']}`,
    );
    // Con la compuerta al 100%, el hijo se activa SIEMPRE que la raíz ocurre — pero además puede
    // auto-iniciarse por su cuenta, así que nunca cae por debajo de la raíz.
    assert.ok(
        result.activationRates['Interrupcion'] >= result.activationRates['Incendio'],
        'un hijo con compuerta al 100% no puede activarse menos que su raíz',
    );
});

test('runFamilyCascadeSimulation: la raíz aporta su pérdida TODOS los años, aunque no propague', () => {
    // Su annualLosses[i] es LEF x Magnitud, una esperanza anual que ya lleva la frecuencia dentro:
    // condicionarla a que "ocurra" la descontaría dos veces. Lo que se condiciona es solo la
    // propagación a los hijos.
    const result = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 3000,
        seed: 123,
    });
    const conPerdida = result.familyAnnualLosses.filter((x) => x > 0).length;
    assert.ok(
        conPerdida / result.familyAnnualLosses.length > 0.95,
        `la raíz debe aportar pérdida casi todos los años, dio ${((100 * conPerdida) / result.familyAnnualLosses.length).toFixed(1)}%`,
    );
});

test('runFamilyCascadeSimulation: la pérdida de familia (raíz + hijo forzado) es mayor, en promedio, que la de la raíz sola', () => {
    const family = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 3000,
        seed: 123,
    });
    const solo = runMonteCarloSimulation({
        iterations: 3000,
        seed: 123,
        tef: { min: 5, mode: 8, max: 12 },
        vuln: { min: 40, mode: 50, max: 60 },
        lossMagnitudes: { productividad: { min: 20000, mode: 30000, max: 50000 } },
    });
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    assert.ok(
        avg(family.familyAnnualLosses) > avg(solo.annualLosses),
        `familia (${avg(family.familyAnnualLosses)}) debería superar a la raíz sola (${avg(solo.annualLosses)}) — el hijo se activa siempre`,
    );
});

test('runFamilyCascadeSimulation: un hijo activado aporta su magnitud, no magnitud×LEF otra vez (regresión)', () => {
    // Regresión del bug real: un riesgo hijo activado sumaba analyzed.annualLosses[i]
    // (=lef_i×lm_i), el mismo lef_i que ya se había usado para decidir SI se activaba (pOwn =
    // 1-e^(-lef_i)) — la frecuencia se descontaba dos veces. Se aísla el efecto con magnitudes
    // FIJAS (min=mode=max, cero varianza — ver getLognormalRandom/getTriangularRandom en
    // random.js, ambas devuelven exactamente `min` cuando min===max) y sin cascada forzada
    // (triggeredByProbability: 0, el hijo se activa SOLO por su propio LEF): así
    // familyAnnualLosses[i] es exactamente $0 (raíz, magnitud fija en 0) o $1,000,000 (hijo
    // activado, magnitud fija en 1,000,000) cada iteración — el promedio DEBE ser exactamente
    // activationRate × 1,000,000, sin margen estadístico. Antes del fix, el hijo aportaba
    // lef_i×1,000,000 en vez de 1,000,000 completo al activarse — mucho menos que lo esperado.
    const register = [
        {
            riskName: 'Raiz',
            riskType: 'amenaza',
            tef: { min: 5, mode: 8, max: 12 },
            vuln: { min: 40, mode: 50, max: 60 },
            lossMagnitudes: { productividad: { min: 0, mode: 0, max: 0 } },
        },
        {
            riskName: 'Hijo',
            riskType: 'amenaza',
            triggeredBy: [{ riskName: 'Raiz', probability: 0 }],
            tef: { min: 0.05, mode: 0.1, max: 0.2 },
            vuln: { min: 80, mode: 90, max: 100 },
            lossMagnitudes: { productividad: { min: 1000000, mode: 1000000, max: 1000000 } },
        },
    ];
    const result = runFamilyCascadeSimulation({ rootRiskName: 'Raiz', register, iterations: 20000, seed: 4242 });
    const avgFamily = result.familyAnnualLosses.reduce((a, b) => a + b, 0) / result.familyAnnualLosses.length;
    const expected = (result.activationRates['Hijo'] / 100) * 1000000;
    assert.ok(
        Math.abs(avgFamily - expected) < 1,
        `avgFamily (${avgFamily}) debería ser activationRate × magnitud fija (${expected}) — no magnitud × LEF otra vez`,
    );
});

test('runFamilyCascadeSimulation: un hijo con DOS padres se activa según 1-(1-p1)(1-p2), no solo el primero', () => {
    // Raíz siempre activa dos hijos intermedios A y B (probability:100, forzado), cada uno sin
    // LEF propio (stub, sin tef/vuln — pOwn=0, solo pueden activarse por cascada) — así A y B
    // están SIEMPRE activos, y lo único que varía es si C se activa vía A (30%), vía B (70%), o
    // ninguna. Sin magnitud/LEF propios en C tampoco (pOwn=0 ahí también), su activationRate
    // debe converger a la combinación de cascada pura: 1-(1-0.3)(1-0.7) = 0.79.
    const register = [
        { riskName: 'Raiz', riskType: 'amenaza' },
        { riskName: 'A', riskType: 'amenaza', triggeredBy: [{ riskName: 'Raiz', probability: 100 }] },
        { riskName: 'B', riskType: 'amenaza', triggeredBy: [{ riskName: 'Raiz', probability: 100 }] },
        {
            riskName: 'C',
            riskType: 'amenaza',
            triggeredBy: [
                { riskName: 'A', probability: 30 },
                { riskName: 'B', probability: 70 },
            ],
        },
    ];
    const result = runFamilyCascadeSimulation({ rootRiskName: 'Raiz', register, iterations: 20000, seed: 909 });
    const expected = 1 - (1 - 0.3) * (1 - 0.7); // 0.79
    assert.ok(
        Math.abs(result.activationRates['C'] / 100 - expected) < 0.02,
        `activationRate de C (${result.activationRates['C']}%) debería converger a ${expected * 100}%`,
    );
});

test('runFamilyCascadeSimulation: con DOS padres de probability:0, la propia frecuencia (pOwn) del hijo NO se cuenta dos veces (regresión)', () => {
    // Regresión del bug real que este diseño evita: si la frecuencia propia se tirara dentro del
    // recorrido de la cascada (una vez por cada padre activo, en vez de una sola vez por
    // iteración antes de recorrer nada — ver los "auto-iniciadores" en cascadeSimulation.js), un
    // hijo con N padres recibiría N tiradas de su propia frecuencia esa misma iteración
    // (1-(1-pOwn)^N en vez de pOwn), sobreestimando su activación cuanto más padres tenga. Se
    // aísla el efecto con probability:0 en TODAS las aristas de cascada (el hijo solo puede
    // activarse por su propio LEF) y se compara la tasa de activación con 1 padre vs. 2 padres
    // — deben converger a la MISMA tasa (la propia, sin inflar), dentro de margen estadístico.
    const hijoConfig = {
        riskName: 'Hijo',
        riskType: 'amenaza',
        tef: { min: 0.05, mode: 0.1, max: 0.2 },
        vuln: { min: 80, mode: 90, max: 100 },
        lossMagnitudes: { productividad: { min: 1000000, mode: 1000000, max: 1000000 } },
    };
    const unParadre = [
        { riskName: 'Raiz', riskType: 'amenaza' },
        { ...hijoConfig, triggeredBy: [{ riskName: 'Raiz', probability: 0 }] },
    ];
    const dosPadres = [
        { riskName: 'Raiz', riskType: 'amenaza' },
        { riskName: 'A', riskType: 'amenaza', triggeredBy: [{ riskName: 'Raiz', probability: 100 }] },
        { riskName: 'B', riskType: 'amenaza', triggeredBy: [{ riskName: 'Raiz', probability: 100 }] },
        {
            ...hijoConfig,
            triggeredBy: [
                { riskName: 'A', probability: 0 },
                { riskName: 'B', probability: 0 },
            ],
        },
    ];
    const resultUno = runFamilyCascadeSimulation({
        rootRiskName: 'Raiz',
        register: unParadre,
        iterations: 20000,
        seed: 606,
    });
    const resultDos = runFamilyCascadeSimulation({
        rootRiskName: 'Raiz',
        register: dosPadres,
        iterations: 20000,
        seed: 606,
    });
    assert.ok(
        Math.abs(resultUno.activationRates['Hijo'] - resultDos.activationRates['Hijo']) < 3,
        `1 padre (${resultUno.activationRates['Hijo']}%) y 2 padres de probability:0 (${resultDos.activationRates['Hijo']}%) deberían converger a la misma tasa — pOwn no debe contarse dos veces`,
    );
});

test('runFamilyCascadeSimulation: la frecuencia propia de un riesgo vale a CUALQUIER profundidad, aunque su padre no ocurra (regresión)', () => {
    // Regresión de un bug real y grave: la frecuencia propia se evaluaba DENTRO del recorrido de
    // la cascada, en la misma compuerta que la probabilidad de arista — o sea, solo se tiraba si
    // el padre ya se había activado. Como la raíz siempre está activa, sus hijos DIRECTOS salían
    // bien y toda la suite (que solo probaba ese caso) pasaba en verde; pero de la SEGUNDA
    // generación en adelante, un riesgo perdía su frecuencia propia por completo cuando su padre
    // no ocurría ese año. Medido antes del arreglo: un nieto con LEF=1 (≈63% por 1-e^(-1))
    // activaba 0.005% de las veces, y un nieto con ALE propio de $1,000,000/año aportaba ~$50 a
    // la familia. El error iba siempre hacia SUBESTIMAR el riesgo, y empeoraba con la
    // profundidad del árbol.
    //
    // Se aísla con probability:0 en TODAS las aristas (nadie se activa por cascada, solo por su
    // propia frecuencia) y un intermedio con frecuencia casi nula (nunca ocurre) — así lo único
    // que puede activar al nieto es su propia frecuencia, la vía que el bug ignoraba.
    const conFrecuenciaPropia = (name, lef, causes) => ({
        riskName: name,
        riskType: 'amenaza',
        tef: { min: lef, mode: lef, max: lef },
        vuln: { min: 100, mode: 100, max: 100 },
        lossMagnitudes: { productividad: { min: 1000, mode: 1000, max: 1000 } },
        triggeredBy: causes || [],
    });
    const register = [
        conFrecuenciaPropia('Raiz', 0.0001),
        conFrecuenciaPropia('Intermedio', 0.0001, [{ riskName: 'Raiz', probability: 0 }]),
        conFrecuenciaPropia('Nieto', 1.0, [{ riskName: 'Intermedio', probability: 0 }]),
    ];
    const result = runFamilyCascadeSimulation({
        rootRiskName: 'Raiz',
        register,
        iterations: 20000,
        seed: 1234,
    });

    // El intermedio casi nunca ocurre — confirma que el nieto NO se está activando por cascada.
    assert.ok(
        result.activationRates['Intermedio'] < 1,
        `el Intermedio debería activarse casi nunca (fue ${result.activationRates['Intermedio']}%)`,
    );
    // 1 - e^(-1) = 63.2%: la probabilidad de al menos un evento al año con LEF=1 (Poisson).
    const esperado = (1 - Math.exp(-1)) * 100;
    assert.ok(
        Math.abs(result.activationRates['Nieto'] - esperado) < 3,
        `el Nieto (profundidad 2) debería activarse ~${esperado.toFixed(1)}% por su propia frecuencia aunque su padre no ocurra, pero fue ${result.activationRates['Nieto']}%`,
    );
});

test('runFamilyCascadeSimulation: es reproducible con la misma semilla', () => {
    const runA = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 500,
        seed: 777,
    });
    const runB = runFamilyCascadeSimulation({
        rootRiskName: 'Incendio',
        register: makeCascadeFamily(),
        iterations: 500,
        seed: 777,
    });
    assert.deepStrictEqual(runA.familyAnnualLosses, runB.familyAnnualLosses);
});

test('runFamilyCascadeSimulation: un riesgo sin hijos se simula igual (familia = el riesgo solo)', () => {
    const result = runFamilyCascadeSimulation({
        rootRiskName: 'Interrupcion',
        register: makeCascadeFamily(),
        iterations: 200,
        seed: 42,
    });
    assert.deepStrictEqual(result.includedRiskNames, ['Interrupcion']);
    assert.strictEqual(result.familySize, 1);
});

test('runFamilyCascadeSimulation: una familia de más de MAX_FAMILY_SIZE riesgos revienta con error explícito (FAMILY_TOO_LARGE)', () => {
    const register = [{ riskName: 'raiz-0' }];
    for (let i = 1; i <= MAX_FAMILY_SIZE + 5; i++) {
        register.push({ riskName: `raiz-${i}`, triggeredBy: [{ riskName: `raiz-${i - 1}`, probability: 100 }] });
    }
    assert.throws(
        () => runFamilyCascadeSimulation({ rootRiskName: 'raiz-0', register, iterations: 10, seed: 1 }),
        (err) => err.code === 'FAMILY_TOO_LARGE',
    );
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

test('pearsonCorrelation devuelve 0 (no NaN) cuando uno de los arreglos tiene varianza cero', () => {
    // Caso real: vuln.min === vuln.max hace que getPertRandom devuelva siempre el mismo valor
    // (ver random.js), un arreglo constante — antes de simple-statistics, esto ya se manejaba
    // con `den === 0 ? 0 : ...`; esta prueba ancla que el guard nuevo hace exactamente lo mismo.
    const constant = [5, 5, 5, 5, 5];
    const varying = [1, 2, 3, 4, 5];
    assert.strictEqual(pearsonCorrelation(constant, varying), 0);
    assert.strictEqual(pearsonCorrelation(varying, constant), 0);
    assert.strictEqual(pearsonCorrelation(constant, constant), 0);
});

test('pearsonCorrelation devuelve 0 (no revienta) con menos de 2 puntos, ej. iterations=1', () => {
    // simple-statistics.sampleCovariance revienta con "requires at least two data points" para
    // arreglos de largo < 2 — iterations=1 es un valor válido según validateIterations, así que
    // calculateSensitivity NO puede heredar ese throw.
    assert.strictEqual(pearsonCorrelation([5], [7]), 0);
    assert.strictEqual(pearsonCorrelation([], []), 0);
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

test('runMonteCarloSimulation: magnitudeSamples es lm_i sin escalar por LEF (annualLosses = lefSamples × magnitudeSamples)', () => {
    // La identidad es propia del modelo de VALOR ESPERADO, que es literalmente esa multiplicación.
    // Con el compuesto (el default) la pérdida del año es la suma de N magnitudes, así que la
    // igualdad deja de tener sentido — se pide el modelo explícito para seguir fijando la relación
    // entre las tres salidas, que es lo que este test protege.
    // Ancla el split que cascadeSimulation.js necesita (ver runFamilyCascadeSimulation): sumar
    // magnitudeSamples[i] en vez de annualLosses[i] para un riesgo hijo ya activado solo es
    // correcto si de verdad se cumple esta identidad — que magnitudeSamples es lm_i SIN el lef_i
    // ya aplicado (annualLosses ya lo trae adentro).
    const result = runMonteCarloSimulation({
        frequencyModel: 'expected',
        iterations: 2000,
        seed: 4242,
        tef: { min: 5, mode: 10, max: 20 },
        vuln: { min: 20, mode: 30, max: 40 },
        lossMagnitudes: { productividad: { min: 30000, mode: 50000, max: 70000 } },
    });
    result.annualLosses.forEach((loss, i) => {
        assert.ok(
            Math.abs(loss - result.lefSamples[i] * result.magnitudeSamples[i]) < 1e-6,
            `iteración ${i}: annualLosses (${loss}) debería ser lefSamples×magnitudeSamples (${result.lefSamples[i] * result.magnitudeSamples[i]})`,
        );
    });
});

test('runMonteCarloSimulation: sin sampleVuln, el comportamiento es idéntico bit a bit al de antes de que ese parámetro existiera', () => {
    // Punto de enchufe para una futura red bayesiana (ver el comentario de la función) — sin
    // pasarlo, drawVuln debe caer exactamente en la misma PERT de siempre sobre `vuln`, mismo
    // consumo de rng por iteración. Se compara contra una corrida con la MISMA semilla que no
    // pasa sampleVuln en absoluto (undefined, como hacían todos los callers antes de este
    // cambio) — si el resultado no es idéntico, el punto de enchufe alteró el comportamiento
    // por defecto, que es justo lo que no debía pasar.
    const params = {
        iterations: 2000,
        seed: 4242,
        tef: { min: 5, mode: 10, max: 20 },
        vuln: { min: 20, mode: 30, max: 40 },
        lossMagnitudes: { productividad: { min: 30000, mode: 50000, max: 70000 } },
    };
    const sinSampleVuln = runMonteCarloSimulation(params);
    const conSampleVulnExplicitoUndefined = runMonteCarloSimulation({ ...params, sampleVuln: undefined });
    assert.deepStrictEqual(sinSampleVuln.annualLosses, conSampleVulnExplicitoUndefined.annualLosses);
});

test('runMonteCarloSimulation: sampleVuln personalizado reemplaza la PERT por defecto', () => {
    // Un sampleVuln que siempre devuelve 0 (vulnerabilidad nula) debe anular la pérdida
    // completa en TODAS las iteraciones (LEF = TEF * 0 = 0), sin importar qué traiga `vuln` —
    // confirma que el punto de enchufe realmente reemplaza el muestreo, no que solo se ignora.
    const params = {
        iterations: 500,
        seed: 7,
        tef: { min: 5, mode: 10, max: 20 },
        vuln: { min: 20, mode: 30, max: 40 }, // se ignora: sampleVuln manda
        lossMagnitudes: { productividad: { min: 30000, mode: 50000, max: 70000 } },
        sampleVuln: () => 0,
    };
    const result = runMonteCarloSimulation(params);
    assert.ok(result.annualLosses.every((loss) => loss === 0));
});

test('runMonteCarloSimulation: sampleVuln personalizado consume el mismo rng (la corrida sigue siendo reproducible con semilla)', () => {
    const params = {
        iterations: 500,
        seed: 55,
        tef: { min: 5, mode: 10, max: 20 },
        vuln: { min: 20, mode: 30, max: 40 },
        lossMagnitudes: { productividad: { min: 30000, mode: 50000, max: 70000 } },
        // Consume el rng (como debe hacerlo un sampleVuln real) pero devuelve un valor fijo —
        // el punto es confirmar que dos corridas con la misma semilla siguen dando exactamente
        // lo mismo, no que el valor en sí sea realista.
        sampleVuln: (rng) => {
            rng();
            return 0.3;
        },
    };
    const runA = runMonteCarloSimulation(params);
    const runB = runMonteCarloSimulation(params);
    assert.deepStrictEqual(runA.annualLosses, runB.annualLosses);
});

test('summarizeEventCounts: cuenta golpes, no dinero', () => {
    // 10 años: seis en cero, tres con un evento, uno con dos.
    const r = summarizeEventCounts([0, 0, 0, 1, 2, 0, 1, 0, 0, 1]);
    assert.strictEqual(r.years, 10);
    assert.strictEqual(r.totalEvents, 5);
    assert.strictEqual(r.meanEventsPerYear, 0.5);
    assert.strictEqual(r.maxEventsInAYear, 2);
    assert.deepStrictEqual(r.distribution, [
        { events: 0, years: 6 },
        { events: 1, years: 3 },
        { events: 2, years: 1 },
    ]);
});

test('summarizeEventCounts: la distribución cubre TODOS los años, sin huecos', () => {
    // Invariante: si los años de la distribución no suman los años simulados, alguno se perdió por
    // el camino y cualquier porcentaje que se calcule encima queda mal.
    const counts = [0, 3, 0, 1, 0, 0, 7, 2];
    const r = summarizeEventCounts(counts);
    assert.strictEqual(
        r.distribution.reduce((a, d) => a + d.years, 0),
        r.years,
    );
    assert.strictEqual(
        r.distribution.reduce((a, d) => a + d.events * d.years, 0),
        r.totalEvents,
    );
});

test('summarizeEventCounts: sin conteos devuelve null, no un cero engañoso', () => {
    // El modelo 'expected' no produce conteos: ahí cada año trae "LEF eventos" con decimales y la
    // pregunta no tiene respuesta. Devolver 0 diría "no pasó nada nunca", que es otra cosa.
    assert.strictEqual(summarizeEventCounts(null), null);
    assert.strictEqual(summarizeEventCounts([]), null);
});

test('summarizeEventCounts: el conteo total concuerda con el LEF que lo generó', () => {
    // Prueba de fondo: no verifica la aritmética del resumen sino que el motor de verdad pega la
    // cantidad de veces que su propio LEF promete. Es el invariante que hace que este número se
    // pueda comparar algún día contra una bitácora real.
    const iterations = 40000;
    const { eventCounts } = runMonteCarloSimulation({
        iterations,
        seed: 4242,
        tef: { min: 0.8, mode: 1.0, max: 1.2 },
        vuln: { min: 28, mode: 30, max: 32 },
        lossMagnitudes: { productividad: { min: 1000, mode: 2000, max: 4000 } },
        frequencyModel: 'compound',
    });
    const r = summarizeEventCounts(eventCounts);
    const lefEsperado = 1.0 * 0.3; // TEF moda x Vulnerabilidad moda
    assert.ok(
        Math.abs(r.meanEventsPerYear - lefEsperado) < 0.02,
        `eventos/año medidos ${r.meanEventsPerYear} contra LEF esperado ${lefEsperado}`,
    );
    // Y con LEF < 1 la mayoría de los años tiene que venir en cero: e^-0,3 = 74 %.
    const anosEnCero = r.distribution[0].years / r.years;
    assert.ok(Math.abs(anosEnCero - Math.exp(-lefEsperado)) < 0.02, `años en cero ${anosEnCero}`);
});

test('summarizeLosses: mediana par calcula bien el promedio de los dos centrales', () => {
    const losses = [10, 20, 30, 40]; // par -> mediana = (20+30)/2 = 25
    const summary = summarizeLosses(losses);
    assert.strictEqual(summary.median, 25);
});

// Vulnerabilidad = P(Capacidad de Amenaza > Fuerza de Resistencia), simulada (ver
// sampleVulnerabilityFromProfiles, backend/src/lib/autocalc.js) — reemplaza la vieja fórmula
// determinista `attackerScore * (1 - defenseScore/100)`. Ya no hay un solo `mode` exacto por
// llamada (es estocástico), así que estos tests son direccionales/estadísticos sobre muchas
// muestras, no igualdades exactas.
function averageVulnerability(
    attackerProfile,
    defenseProfile,
    confidence,
    iterations = 5000,
    rng = Math.random,
    accessLevel = 'nulo',
) {
    const sampler = sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence, accessLevel);
    let sum = 0;
    for (let i = 0; i < iterations; i++) sum += sampler(rng);
    return (sum / iterations) * 100;
}

// ---------------------------------------------------------------------------------------------
// CALIBRACIÓN: las seis anclas de juicio experto, convertidas en regresión ejecutable.
// ---------------------------------------------------------------------------------------------
// Estas seis celdas de la grilla Atacante x Defensa son el criterio de un experto en seguridad
// patrimonial, y son de donde salen TULLOCK_M y ATTACKER_CONTEST_CALIBRATION (ver autocalc.js).
// Este test es el candado: nadie puede tocar `m`, el eje de contienda ni los atributos de un
// Perfil de Atacante sin que la suite avise que el modelo dejó de coincidir con ese criterio.
//
// Cada ancla se emite con el Nivel de Acceso que le corresponde. Cinco van con acceso NULO; la del
// empleado desleal va con acceso MEDIO, porque "un insider sin ningún acceso" es una contradicción
// de términos y leerla como si lo fuera era exactamente lo que volvía a ese perfil indistinguible
// del crimen organizado (ver el bloque de calibración en autocalc.js).
// La tolerancia va SEPARADA por tipo de ancla, y la diferencia es la que importa:
//
//   - Las de CALIBRACIÓN se ajustaron contra estas mismas celdas, así que tienen que dar casi
//     exacto. 0,5 pp es un candado real: el peor residuo medido es de 0,15 pp (probado con cuatro
//     semillas distintas), así que cualquier deriva de calibración lo revienta enseguida.
//   - Las de VALIDACIÓN no se ajustaron a nada. Su residuo es la medida de si la escala de Defensa
//     es internamente consistente, y por eso su tolerancia es más floja: 2 pp.
const TOLERANCIA_CALIBRACION = 0.5;
const TOLERANCIA_VALIDACION = 2;

const CALIBRATION_ANCHORS = [
    { attacker: 'oportunista', defense: 'basica', expected: 5 },
    { attacker: 'vandalismo', defense: 'basica', expected: 35 },
    { attacker: 'empleado-desleal', defense: 'avanzada', access: 'medio', expected: 30 },
    { attacker: 'organizado', defense: 'estandar', expected: 60 },
    { attacker: 'organizado', defense: 'elite', expected: 15 },
    // Anclas de VALIDACIÓN: se emitieron DESPUÉS de fijar m y el eje de contienda, para
    // comprobar que la escala de Defensa (el promedio crudo de sus 6 atributos, nunca calibrada
    // aparte) fuera internamente consistente. No se ajustó nada para acertarlas.
    //
    // Costo honesto de la calibración 7: quitar el tope de 100 EMPEORÓ este par. El tope mordía
    // justo en `avanzada`, así que al quitarlo esa celda subió y su residuo pasó de +0,8 a
    // +1,7 pp. La validación fuera de muestra sigue siendo buena (5,8 % de error relativo sobre un
    // juicio de "30 %"), pero es menos apretada que antes, y por eso la tolerancia de este par se
    // subió de 1,5 a 2 pp. Es un empeoramiento real y a ojo abierto: se aceptó porque el tope
    // introducía un sesgo sistemático contra la defensa fuerte en TODA la grilla, y eso pesa más
    // que 0,9 pp en una celda de comprobación.
    { attacker: 'organizado', defense: 'basica', expected: 98, validacion: true },
    { attacker: 'organizado', defense: 'avanzada', expected: 30, validacion: true },
    { attacker: 'estado-nacion', defense: 'elite', expected: 45 },
];

test('CALIBRACIÓN: la Vulnerabilidad simulada reproduce las 6 anclas de juicio experto', () => {
    for (const { attacker, defense, access = 'nulo', expected, validacion } of CALIBRATION_ANCHORS) {
        const avg = averageVulnerability(
            attackerProfiles[attacker],
            defenseProfiles[defense],
            'medio',
            60000,
            mulberry32(0x5eed),
            access,
        );
        const tolerancia = validacion ? TOLERANCIA_VALIDACION : TOLERANCIA_CALIBRACION;
        assert.ok(
            Math.abs(avg - expected) <= tolerancia,
            `${attacker} vs ${defense} (acceso ${access}): ancla ${expected}%, el modelo dio ` +
                `${avg.toFixed(2)}% (tolerancia ${tolerancia} pp)`,
        );
    }
});

// Candado del tope quitado en la calibración 7: la Fuerza de Resistencia PUEDE pasar de 100.
// Volver a poner un `Math.min(100, ...)` en buildContestTriangles rompería este test, que es
// precisamente para lo que está.
test('CALIBRACIÓN: el triángulo de Resistencia no tiene tope en 100', () => {
    const { rs } = buildContestTriangles(attackerProfiles.organizado, defenseProfiles.elite, 'medio', 'nulo');
    assert.ok(
        rs.max > 100,
        `defensa élite con confianza media debería abrir su Resistencia por encima de 100, dio ${rs.max.toFixed(1)}`,
    );
    // Y el tope no se coló en otro lado: el máximo tiene que ser exactamente moda x factor.
    assert.ok(Math.abs(rs.max - rs.mode * 1.4) < 1e-9, 'el máximo del triángulo debe ser la moda x 1,40');
});

// Candado de la calibración 6: el Empleado Desleal y el Grupo Criminal Organizado tienen que dar
// números DISTINTOS. Durante cuatro versiones dieron el mismo (FA 60,0 los dos, mismo nodo del eje
// de contienda), así que la app ofrecía una distinción que no existía en el cálculo. Se prueba
// contra defensa estándar, la banda donde la sigmoide de Tullock tiene su mejor resolución.
test('CALIBRACIÓN: el Empleado Desleal ya no es indistinguible del Crimen Organizado', () => {
    const insider = averageVulnerability(
        attackerProfiles['empleado-desleal'],
        defenseProfiles.estandar,
        'medio',
        60000,
        mulberry32(0x5eed),
    );
    const banda = averageVulnerability(
        attackerProfiles.organizado,
        defenseProfiles.estandar,
        'medio',
        60000,
        mulberry32(0x5eed),
    );
    assert.ok(
        banda - insider > 10,
        `sin acceso, el insider (${insider.toFixed(1)}%) debería quedar MUY por debajo de la banda ` +
            `organizada (${banda.toFixed(1)}%) — su ventaja es el acceso, no la fuerza`,
    );
    // Y con el acceso que un insider sí tiene, queda A LA PAR de la banda organizada: la ventaja
    // vive en el Nivel de Acceso, que es donde el modelo la pone, y no diluida dentro del perfil.
    //
    // Se prueba "a la par" (± 5 pp) y no "por encima": cuál de los dos queda arriba por menos de un
    // punto depende de la calibración vigente y no es una afirmación del modelo. En la calibración
    // 6 el insider con acceso quedaba 0,6 pp arriba; en la 7 queda 0,9 pp abajo. Lo que sí afirma
    // el modelo —y lo que este candado protege— es que el acceso cierra por completo la brecha de
    // 36 pp que hay sin él.
    const insiderConAcceso = averageVulnerability(
        attackerProfiles['empleado-desleal'],
        defenseProfiles.estandar,
        'medio',
        60000,
        mulberry32(0x5eed),
        'medio',
    );
    assert.ok(
        Math.abs(insiderConAcceso - banda) < 5,
        `con acceso operativo el insider (${insiderConAcceso.toFixed(1)}%) debería quedar a la par ` +
            `de la banda organizada sin acceso (${banda.toFixed(1)}%)`,
    );
});

// Anclas ESTRUCTURALES del Nivel de Acceso: una sola pareja (organizado vs. estándar) variando
// únicamente alfa. Al quedar C y R constantes, ambos se cancelan y cada ancla despeja su factor de
// forma unívoca — por eso los alfa de ACCESS_LEVELS no son juicio directo sino valores derivados.
const ACCESS_ANCHORS = [
    { access: 'nulo', expected: 60 },
    { access: 'bajo', expected: 72 },
    { access: 'medio', expected: 88 },
    { access: 'alto', expected: 96 },
];

test('CALIBRACIÓN: los factores de Nivel de Acceso reproducen sus anclas estructurales', () => {
    for (const { access, expected } of ACCESS_ANCHORS) {
        const sampler = sampleVulnerabilityFromProfiles(
            attackerProfiles.organizado,
            defenseProfiles.estandar,
            'medio',
            access,
        );
        let sum = 0;
        const rng = mulberry32(0x5eed);
        for (let i = 0; i < 60000; i++) sum += sampler(rng);
        const avg = (sum / 60000) * 100;
        assert.ok(
            Math.abs(avg - expected) <= 1.5,
            `acceso ${access}: ancla ${expected}%, el modelo dio ${avg.toFixed(2)}%`,
        );
    }
});

test('CALIBRACIÓN: más acceso siempre baja la resistencia efectiva, nunca la sube', () => {
    // Monotonía estricta de los factores. Un intento anterior de anclar el acceso cruzando
    // distintos atacantes y defensas producía alfa NO monótonos (bajo 0,614 mordía más que alto
    // 0,686), porque anclaba en celdas pegadas al piso de 0,5 %. Este test cierra esa puerta.
    const orden = ['nulo', 'bajo', 'medio', 'alto'];
    for (let i = 1; i < orden.length; i++) {
        assert.ok(
            ACCESS_LEVELS[orden[i]].alpha < ACCESS_LEVELS[orden[i - 1]].alpha,
            `alfa de ${orden[i]} (${ACCESS_LEVELS[orden[i]].alpha}) debería ser menor que el de ${orden[i - 1]}`,
        );
    }
    assert.strictEqual(ACCESS_LEVELS.nulo.alpha, 1, 'acceso nulo debe ser un no-op exacto');
});

test('CALIBRACIÓN: la grilla completa Atacante x Defensa es monótona en ambos ejes', () => {
    // Ordenados de menos a más fuerte. Sin esto, la calibración podría acertar las 6 anclas y aun
    // así producir absurdos en las 14 celdas que ningún ancla toca (que es lo que pasaba con los
    // ajustes libres antes de restringir la monotonía del eje de contienda).
    const attackers = ['oportunista', 'vandalismo', 'empleado-desleal', 'organizado', 'estado-nacion'];
    const defenses = ['basica', 'estandar', 'avanzada', 'elite'];
    const grid = attackers.map((a) =>
        defenses.map((d) =>
            averageVulnerability(attackerProfiles[a], defenseProfiles[d], 'medio', 20000, mulberry32(0x5eed)),
        ),
    );

    grid.forEach((row, i) => {
        for (let j = 1; j < row.length; j++) {
            assert.ok(
                row[j] <= row[j - 1] + 0.05,
                `${attackers[i]}: más defensa debería bajar la vulnerabilidad, ${defenses[j - 1]}=${row[j - 1].toFixed(1)}% -> ${defenses[j]}=${row[j].toFixed(1)}%`,
            );
        }
    });
    for (let i = 1; i < grid.length; i++) {
        for (let j = 0; j < defenses.length; j++) {
            assert.ok(
                grid[i][j] >= grid[i - 1][j] - 0.05,
                `${defenses[j]}: ${attackers[i]} (${grid[i][j].toFixed(1)}%) debería ser >= ${attackers[i - 1]} (${grid[i - 1][j].toFixed(1)}%)`,
            );
        }
    }
});

test('CALIBRACIÓN: ninguna combinación da 0% — ninguna defensa es invulnerable', () => {
    const avg = averageVulnerability(
        attackerProfiles.oportunista,
        defenseProfiles.elite,
        'medio',
        20000,
        mulberry32(0x5eed),
    );
    // 1e-9 de tolerancia: el promedio acumula 20.000 sumas de 0,005 y cae en 0,49999... por
    // redondeo de punto flotante, no porque alguna muestra haya bajado del piso.
    assert.ok(avg >= VULNERABILITY_FLOOR * 100 - 1e-9, `esperaba al menos el piso, dio ${avg.toFixed(3)}%`);
    assert.ok(avg < 2, `el piso no debe inflar el resultado, dio ${avg.toFixed(3)}%`);
});

test('attackerContestStrength: monótona creciente y anclada en los nodos calibrados', () => {
    for (const { profileScore, contestStrength } of ATTACKER_CONTEST_CALIBRATION) {
        assert.ok(
            Math.abs(attackerContestStrength(profileScore) - contestStrength) < 1e-9,
            `el nodo ${profileScore} debería dar exactamente ${contestStrength}`,
        );
    }
    let prev = -Infinity;
    for (let score = 0; score <= 100; score += 0.5) {
        const value = attackerContestStrength(score);
        assert.ok(value >= prev, `no monótona en ${score}: ${value} < ${prev}`);
        prev = value;
    }
});

test('sampleVulnerabilityFromProfiles: atacante fuerte + defensa débil = vulnerabilidad promedio alta', () => {
    const avg = averageVulnerability(attackerProfiles['estado-nacion'], defenseProfiles.basica, 'medio');
    assert.ok(avg > 60, `esperaba vulnerabilidad promedio alta, dio ${avg.toFixed(1)}`);
});

test('sampleVulnerabilityFromProfiles: atacante débil + defensa élite = vulnerabilidad promedio baja', () => {
    const avg = averageVulnerability(attackerProfiles.oportunista, defenseProfiles.elite, 'medio');
    assert.ok(avg < 25, `esperaba vulnerabilidad promedio baja, dio ${avg.toFixed(1)}`);
});

test('sampleVulnerabilityFromProfiles: subir el Nivel de Defensa (mismo atacante) baja la vulnerabilidad promedio de forma monótona', () => {
    // Prueba indirecta de que la defensa nunca "descuenta" al atacante: si lo hiciera de forma
    // extraña (no monótona), este orden no se mantendría de forma consistente en las 4 bandas.
    // Números aleatorios comunes (misma semilla en las 4 corridas) para aislar el efecto
    // estructural del ruido de muestreo.
    const attacker = attackerProfiles['empleado-desleal'];
    const seeds = () => mulberry32(777);
    const avgBasica = averageVulnerability(attacker, defenseProfiles.basica, 'medio', 5000, seeds());
    const avgEstandar = averageVulnerability(attacker, defenseProfiles.estandar, 'medio', 5000, seeds());
    const avgAvanzada = averageVulnerability(attacker, defenseProfiles.avanzada, 'medio', 5000, seeds());
    const avgElite = averageVulnerability(attacker, defenseProfiles.elite, 'medio', 5000, seeds());
    assert.ok(avgBasica >= avgEstandar, `${avgBasica} debería ser >= ${avgEstandar}`);
    assert.ok(avgEstandar >= avgAvanzada, `${avgEstandar} debería ser >= ${avgAvanzada}`);
    assert.ok(avgAvanzada >= avgElite, `${avgAvanzada} debería ser >= ${avgElite}`);
});

test('sampleVulnerabilityFromProfiles: reproducible — misma semilla y mismos perfiles dan EXACTO el mismo resultado', () => {
    const sampler1 = sampleVulnerabilityFromProfiles(attackerProfiles.organizado, defenseProfiles.estandar, 'medio');
    const sampler2 = sampleVulnerabilityFromProfiles(attackerProfiles.organizado, defenseProfiles.estandar, 'medio');
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);
    const seq1 = Array.from({ length: 20 }, () => sampler1(rng1));
    const seq2 = Array.from({ length: 20 }, () => sampler2(rng2));
    assert.deepStrictEqual(seq1, seq2);
});

test('sampleVulnerabilityFromProfiles: un atacante persistente escala su Capacidad de Amenaza ante un desafío — la escalada tiene efecto real medible', () => {
    // Mismo atacante en todo menos Persistencia — contra la MISMA defensa fuerte (RS gana seguido,
    // dando muchas oportunidades de escalar) y la MISMA semilla (números aleatorios comunes), el
    // de Persistencia alta debe dar vulnerabilidad promedio mayor: la escalada no determinista
    // (ver el paso 3 del algoritmo) sí está cambiando el resultado, no solo existe en el código.
    const base = { name: 'test', motivation: 60, resources: 60, capacity: 60, sophistication: 60 };
    const lowPersistence = { ...base, persistence: 0 };
    const highPersistence = { ...base, persistence: 100 };
    const defense = defenseProfiles.avanzada;

    const avgLow = averageVulnerability(lowPersistence, defense, 'medio', 5000, mulberry32(99));
    const avgHigh = averageVulnerability(highPersistence, defense, 'medio', 5000, mulberry32(99));
    assert.ok(
        avgHigh > avgLow,
        `esperaba que Persistencia alta (${avgHigh.toFixed(1)}) diera más vulnerabilidad que baja (${avgLow.toFixed(1)})`,
    );
});

test('summarizeVulnerabilitySamples: min <= mode <= max, en escala 0-100', () => {
    const sampler = sampleVulnerabilityFromProfiles(attackerProfiles.organizado, defenseProfiles.basica, 'bajo');
    const summary = summarizeVulnerabilitySamples(sampler, 2000, mulberry32(5));
    assert.ok(summary.min <= summary.mode && summary.mode <= summary.max, JSON.stringify(summary));
    assert.ok(summary.min >= 0 && summary.max <= 100, JSON.stringify(summary));
});

test('calculateReduccionALEFromProfiles: mejorar la defensa (mismo atacante) da reducción positiva', () => {
    const { reductionPercent } = calculateReduccionALEFromProfiles(
        attackerProfiles.organizado,
        defenseProfiles.basica,
        defenseProfiles.elite,
        'medio',
    );
    assert.ok(reductionPercent > 0, `esperaba reducción positiva, dio ${reductionPercent}`);
});

test('calculateReduccionALEFromProfiles: degradar la defensa NO da reducción (protección contra mal uso)', () => {
    const { reductionPercent } = calculateReduccionALEFromProfiles(
        attackerProfiles.organizado,
        defenseProfiles.elite,
        defenseProfiles.basica,
        'medio',
    );
    assert.strictEqual(reductionPercent, 0);
});

test('calculateReduccionALEFromProfiles: mismo objetivo que el actual da 0% exacto (números aleatorios comunes cancelan el ruido)', () => {
    const { reductionPercent } = calculateReduccionALEFromProfiles(
        attackerProfiles.organizado,
        defenseProfiles.estandar,
        defenseProfiles.estandar,
        'medio',
    );
    assert.strictEqual(reductionPercent, 0);
});

// pairedVulnerabilitySample: regresión del bug real de "números aleatorios comunes" (ver el
// comentario completo en autocalc.js) — antes, comparar Defensa actual vs. objetivo compartía una
// sola secuencia de rng consumida en orden, pero getPertRandom usa rejection sampling (consume un
// número VARIABLE de tiradas según alpha/beta) — como alpha/beta de RS dependen de defenseScore
// (distinto entre actual y objetivo), la primera diferencia en tiradas ya desincronizaba el resto
// de cada corrida, reintroduciendo el ruido que la técnica pretendía cancelar.
test('pairedVulnerabilitySample: el componente TCap sale IDÉNTICO entre dos Defensas distintas (mismo atacante/semilla/iteración) — ancla el mecanismo de streams independientes', () => {
    // Perfiles de Defensa sintéticos que promedian 0 (calculateProfileAverage) pero con FORMA
    // distinta (2 vs. 3 atributos) — degeneran RS a exactamente 0 en ambos casos (spread.min/max
    // multiplican 0), así que la Vulnerabilidad resultante (Tullock de TCap vs. RS=0) refleja
    // PURAMENTE el componente TCap. Si TCap de verdad usa un stream independiente y sembrado por
    // (semilla, iteración, rol) — no por posición en una secuencia compartida — el resultado debe
    // ser idéntico sin importar que RS haya sido calculado con parámetros/forma distintos.
    const attacker = attackerProfiles.organizado;
    const defenseA = { x: 0, y: 0 };
    const defenseB = { p: 0, q: 0, r: 0 };
    for (const iteration of [0, 1, 50, 1999]) {
        const sampleA = pairedVulnerabilitySample(attacker, defenseA, 'medio', 20260810, iteration);
        const sampleB = pairedVulnerabilitySample(attacker, defenseB, 'medio', 20260810, iteration);
        assert.strictEqual(
            sampleA,
            sampleB,
            `iteración ${iteration}: TCap debería ser idéntico sin importar la forma de RS`,
        );
    }
});

test('pairedVulnerabilitySample: es puro y determinista — mismos argumentos dan EXACTO el mismo resultado en llamadas repetidas', () => {
    const a = pairedVulnerabilitySample(attackerProfiles.organizado, defenseProfiles.basica, 'medio', 20260810, 42);
    const b = pairedVulnerabilitySample(attackerProfiles.organizado, defenseProfiles.basica, 'medio', 20260810, 42);
    assert.strictEqual(a, b);
});

test('calculateReduccionALEFromProfiles: reductionPercent sube de forma monótona al mejorar la Defensa banda por banda (básica < estándar < avanzada < élite)', () => {
    // Mismo criterio que ya prueba sampleVulnerabilityFromProfiles (ver el test de monotonicidad
    // de más arriba) — confirma que el mecanismo de números aleatorios comunes corregido produce
    // resultados consistentes, sin saltos erráticos por ruido residual, en un caso real con las 4
    // bandas de Defensa (no solo el caso degenerado "mismo objetivo que el actual").
    const attacker = attackerProfiles['empleado-desleal'];
    const target = (defense) =>
        calculateReduccionALEFromProfiles(attacker, defenseProfiles.basica, defense, 'medio').reductionPercent;
    const rEstandar = target(defenseProfiles.estandar);
    const rAvanzada = target(defenseProfiles.avanzada);
    const rElite = target(defenseProfiles.elite);
    assert.ok(rEstandar <= rAvanzada, `${rEstandar} debería ser <= ${rAvanzada}`);
    assert.ok(rAvanzada <= rElite, `${rAvanzada} debería ser <= ${rElite}`);
    assert.ok(rElite > 0, 'esperaba alguna reducción real al pasar de básica a élite');
});

// calculateResidualFromSimulation: residual REAL de Mitigar (ALE y CVaR), re-simulando con el
// Nivel de Defensa Objetivo — reemplaza escalar currentALE/currentCVaR por el mismo
// reductionPercent, aproximación que ya no es exacta con el modelo TCap vs. RS + Tullock (ver el
// hallazgo de la auditoría que motivó esta función).
const RESIDUAL_TEF = { min: 5, mode: 10, max: 18 };
const RESIDUAL_LOSS_MAGNITUDES = { respuesta: { min: 5000, mode: 20000, max: 50000 } };

test('calculateResidualFromSimulation: reproducible — misma entrada da EXACTO el mismo resultado', () => {
    const r1 = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.elite,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        200000,
    );
    const r2 = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.elite,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        200000,
    );
    assert.deepStrictEqual(r1, r2);
});

test('calculateResidualFromSimulation: defensa objetivo más fuerte da residualALE menor que el actual', () => {
    const { residualALE, reductionPercent } = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.elite,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        200000,
    );
    assert.ok(residualALE < 200000, `esperaba residualALE < 200000, dio ${residualALE}`);
    assert.ok(reductionPercent > 0, `esperaba reductionPercent > 0, dio ${reductionPercent}`);
});

test('calculateResidualFromSimulation: degradar la defensa da residualALE MAYOR que el actual, pero reductionPercent se acota a 0 (protección contra mal uso)', () => {
    const { residualALE, residualCVaR, reductionPercent } = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.basica,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        50000, // currentALE artificialmente bajo, para forzar que el residual real salga mayor
    );
    assert.ok(residualALE > 50000, `esperaba residualALE > 50000 (defensa débil), dio ${residualALE}`);
    assert.ok(residualCVaR > 0, 'residualCVaR real no debe ocultarse ni salir 0 solo porque empeoró');
    assert.strictEqual(reductionPercent, 0);
});

test('calculateResidualFromSimulation: invariante residualCVaR >= residualALE (CVaR95 es el promedio del peor 5%, nunca puede ser menor que el promedio completo)', () => {
    const { residualALE, residualCVaR } = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.avanzada,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        200000,
    );
    assert.ok(residualCVaR >= residualALE, `esperaba residualCVaR (${residualCVaR}) >= residualALE (${residualALE})`);
});

// calculateInherentRiskFromSimulation: Riesgo Inherente REAL (sin ningún control, Vulnerabilidad
// 100%) — re-simulado, no la aproximación algebraica que usaba computeFairRiskEquivalents en el
// frontend (entry.ale * (100/vulnMean)).
test('calculateInherentRiskFromSimulation: reproducible — misma entrada da EXACTO el mismo resultado', () => {
    const r1 = calculateInherentRiskFromSimulation(RESIDUAL_TEF, RESIDUAL_LOSS_MAGNITUDES);
    const r2 = calculateInherentRiskFromSimulation(RESIDUAL_TEF, RESIDUAL_LOSS_MAGNITUDES);
    assert.deepStrictEqual(r1, r2);
});

test('calculateInherentRiskFromSimulation: sin ningún control (Vulnerabilidad 100%) da un ALE mayor o igual que con cualquier perfil de defensa real', () => {
    const { inherentALE } = calculateInherentRiskFromSimulation(RESIDUAL_TEF, RESIDUAL_LOSS_MAGNITUDES);
    const { residualALE: withElite } = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.elite,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        inherentALE,
    );
    const { residualALE: withBasica } = calculateResidualFromSimulation(
        attackerProfiles.organizado,
        defenseProfiles.basica,
        'medio',
        RESIDUAL_TEF,
        RESIDUAL_LOSS_MAGNITUDES,
        inherentALE,
    );
    assert.ok(
        inherentALE >= withElite,
        `esperaba inherentALE (${inherentALE}) >= residual con defensa elite (${withElite})`,
    );
    assert.ok(
        inherentALE >= withBasica,
        `esperaba inherentALE (${inherentALE}) >= residual con defensa básica (${withBasica})`,
    );
});

test('calculateInherentRiskFromSimulation: invariante inherentCVaR >= inherentALE', () => {
    const { inherentALE, inherentCVaR } = calculateInherentRiskFromSimulation(RESIDUAL_TEF, RESIDUAL_LOSS_MAGNITUDES);
    assert.ok(inherentCVaR >= inherentALE, `esperaba inherentCVaR (${inherentCVaR}) >= inherentALE (${inherentALE})`);
});

test('calculateInherentPortfolio: mezcla de riesgos con/sin inherentALE persistido — conteo y suma correctos', () => {
    const risks = [
        {
            riskName: 'Con inherente',
            riskType: 'amenaza',
            ale: 50000,
            cvar95: 90000,
            inherentALE: 400000,
            inherentCVaR: 700000,
        },
        { riskName: 'Sin inherente (guardado antes)', riskType: 'amenaza', ale: 30000, cvar95: 60000 },
    ];
    const portfolio = calculateInherentPortfolio(risks);
    assert.strictEqual(portfolio.totalInherentALE, 400000);
    assert.strictEqual(portfolio.totalInherentCVaR, 700000);
    assert.strictEqual(portfolio.inherentRiskCount, 1);
    assert.strictEqual(portfolio.inherentMissingCount, 1);
    assert.strictEqual(portfolio.totalActualALE, 50000 + 30000);
    assert.strictEqual(portfolio.totalActualCVaR, 90000 + 60000);
    assert.strictEqual(portfolio.totalRiskCount, 2);
    // El Actual COMPARABLE cubre solo el riesgo que además tiene inherentALE — es contra este
    // (no contra totalActualALE) que se resta el Inherente para la Efectividad de Controles.
    assert.strictEqual(portfolio.comparableActualALE, 50000);
});

test('calculateInherentPortfolio: la Efectividad de Controles usa la MISMA canasta, no un Actual que incluye riesgos sin Inherente (regresión)', () => {
    // Regresión de un bug real: la efectividad se calculaba como
    // (totalInherentALE - totalActualALE) / totalInherentALE, restando un Inherente que solo
    // cubría los riesgos con el dato persistido contra un Actual que cubría TODAS las amenazas.
    // Con cualquier riesgo sin inherentALE (los guardados antes de que existiera el cálculo, o
    // los que no se han vuelto a simular), el resultado salía negativo — le decía al usuario que
    // sus controles EMPEORABAN el riesgo — y el waterfall mostraba un Riesgo Inherente MENOR que
    // el Actual, algo imposible por definición (el inherente es "sin ningún control").
    const risks = [
        { riskName: 'A', riskType: 'amenaza', ale: 100000, cvar95: 200000, inherentALE: 300000, inherentCVaR: 500000 },
        { riskName: 'B', riskType: 'amenaza', ale: 50000, cvar95: 90000, inherentALE: 150000, inherentCVaR: 250000 },
        // Sin inherentALE, y con un ALE actual grande — es el que invertía el signo.
        { riskName: 'C', riskType: 'amenaza', ale: 900000, cvar95: 1500000 },
    ];
    const portfolio = calculateInherentPortfolio(risks);

    assert.strictEqual(portfolio.totalInherentALE, 450000);
    assert.strictEqual(portfolio.comparableActualALE, 150000); // solo A y B
    assert.strictEqual(portfolio.totalActualALE, 1050000); // las 3, para la barra de resumen

    const efectividad =
        ((portfolio.totalInherentALE - portfolio.comparableActualALE) / portfolio.totalInherentALE) * 100;
    assert.ok(
        Math.abs(efectividad - 66.67) < 0.01,
        `la efectividad debería ser ~66.7% (los controles reducen el riesgo), pero fue ${efectividad.toFixed(1)}%`,
    );
    // El Inherente NUNCA puede quedar por debajo del Actual con el que se compara.
    assert.ok(
        portfolio.totalInherentALE >= portfolio.comparableActualALE,
        'el Riesgo Inherente (sin ningún control) no puede ser menor que el Actual de esa misma canasta',
    );
});

test('calculateInherentPortfolio: con cobertura completa, el Actual comparable y el total coinciden (el caso limpio no cambia)', () => {
    const risks = [
        { riskName: 'A', riskType: 'amenaza', ale: 100000, cvar95: 200000, inherentALE: 300000, inherentCVaR: 500000 },
        { riskName: 'B', riskType: 'amenaza', ale: 50000, cvar95: 90000, inherentALE: 150000, inherentCVaR: 250000 },
    ];
    const portfolio = calculateInherentPortfolio(risks);
    assert.strictEqual(portfolio.inherentMissingCount, 0);
    assert.strictEqual(portfolio.comparableActualALE, portfolio.totalActualALE);
});

test('calculateInherentPortfolio: ningún riesgo tiene inherentALE — totales inherentes null, actuales siguen sumando', () => {
    const risks = [{ riskName: 'Legado', riskType: 'amenaza', ale: 20000, cvar95: 35000 }];
    const portfolio = calculateInherentPortfolio(risks);
    assert.strictEqual(portfolio.totalInherentALE, null);
    assert.strictEqual(portfolio.totalInherentCVaR, null);
    assert.strictEqual(portfolio.inherentRiskCount, 0);
    assert.strictEqual(portfolio.inherentMissingCount, 1);
    assert.strictEqual(portfolio.totalActualALE, 20000);
});

test('calculateInherentPortfolio: excluye riesgos tipo "oportunidad"', () => {
    const risks = [
        {
            riskName: 'Amenaza',
            riskType: 'amenaza',
            ale: 10000,
            cvar95: 15000,
            inherentALE: 100000,
            inherentCVaR: 150000,
        },
        {
            riskName: 'Oportunidad',
            riskType: 'oportunidad',
            ale: 900000,
            cvar95: 1500000,
            inherentALE: 900000,
            inherentCVaR: 1500000,
        },
    ];
    const portfolio = calculateInherentPortfolio(risks);
    assert.strictEqual(portfolio.totalRiskCount, 1);
    assert.strictEqual(portfolio.totalInherentALE, 100000);
});

test('calculateInherentPortfolio: portafolio vacío da totales en 0/null', () => {
    const portfolio = calculateInherentPortfolio([]);
    assert.strictEqual(portfolio.totalRiskCount, 0);
    assert.strictEqual(portfolio.totalActualALE, 0);
    assert.strictEqual(portfolio.totalInherentALE, null);
});

// Función de Éxito de Contienda de Tullock (ver tullockSuccessProbability, autocalc.js) —
// reemplaza la logística que combinaba TCap/RS en cada iteración de Monte Carlo.
test('tullockSuccessProbability: un empate da 50% SIN IMPORTAR la escala absoluta — la prueba matemática que motiva Tullock', () => {
    // Réplica directa del ejemplo del documento que motivó este cambio: la fórmula lineal vieja
    // daba resultados distintos para empates a distinta escala (25%, 9%, 9%) — Tullock, al ser
    // una RAZÓN en vez de una resta, da 50% siempre.
    assert.strictEqual(tullockSuccessProbability(10, 10), 0.5);
    assert.strictEqual(tullockSuccessProbability(50, 50), 0.5);
    assert.strictEqual(tullockSuccessProbability(90, 90), 0.5);
});

test('tullockSuccessProbability: 0 contra 0 da 50% (evita 0/0 = NaN), no revienta', () => {
    assert.strictEqual(tullockSuccessProbability(0, 0), 0.5);
});

test('tullockSuccessProbability: monótona — más Fuerza de Atacante (defensa fija) siempre da más probabilidad de éxito', () => {
    const low = tullockSuccessProbability(30, 50);
    const mid = tullockSuccessProbability(50, 50);
    const high = tullockSuccessProbability(80, 50);
    assert.ok(low < mid && mid < high, `esperaba ${low} < ${mid} < ${high}`);
});

test('tullockSuccessProbability: m mayor hace más decisiva una misma ventaja fija (se aleja más de 50%)', () => {
    const marginAtM1 = Math.abs(tullockSuccessProbability(60, 40, 1) - 0.5);
    const marginAtM2 = Math.abs(tullockSuccessProbability(60, 40, 2) - 0.5);
    assert.ok(
        marginAtM2 > marginAtM1,
        `esperaba que m=2 (${marginAtM2}) se alejara más de 50% que m=1 (${marginAtM1})`,
    );
});

// Equilibrio de Nash (ver solveNashEquilibrium, backend/src/lib/nashEquilibrium.js) — los mismos
// 4 casos de control que se validaron manualmente antes de integrar esto a la app (ver
// IMPLEMENTACION_TULLOCK2.txt, sección 2.5).
test('solveNashEquilibrium: costos simétricos da un equilibrio simétrico, ~50% de vulnerabilidad', () => {
    const result = solveNashEquilibrium({ m: 1, valueAtStake: 100000, costAttacker: 500, costDefense: 500 });
    assert.ok(result.converged, 'se esperaba que convergiera');
    assert.ok(
        Math.abs(result.equilibriumVulnerability - 0.5) < 0.01,
        `esperaba ~50%, dio ${(result.equilibriumVulnerability * 100).toFixed(1)}%`,
    );
    assert.ok(
        Math.abs(result.attackerEffort - result.defenseEffort) < 0.1,
        `esperaba esfuerzos simétricos, dio atacante=${result.attackerEffort}, defensa=${result.defenseEffort}`,
    );
});

test('solveNashEquilibrium: costo más barato para el atacante sube la vulnerabilidad de equilibrio por encima de 50%', () => {
    const result = solveNashEquilibrium({ m: 1, valueAtStake: 100000, costAttacker: 200, costDefense: 500 });
    assert.ok(
        result.equilibriumVulnerability > 0.5,
        `esperaba > 50%, dio ${(result.equilibriumVulnerability * 100).toFixed(1)}%`,
    );
});

test('solveNashEquilibrium: costo más barato para la defensa baja la vulnerabilidad de equilibrio por debajo de 50%', () => {
    const result = solveNashEquilibrium({ m: 1, valueAtStake: 100000, costAttacker: 500, costDefense: 200 });
    assert.ok(
        result.equilibriumVulnerability < 0.5,
        `esperaba < 50%, dio ${(result.equilibriumVulnerability * 100).toFixed(1)}%`,
    );
});

test('solveNashEquilibrium: m mayor hace que ambos lados inviertan más esfuerzo total (contiendas más decisivas disipan más valor)', () => {
    const params = { valueAtStake: 100000, costAttacker: 500, costDefense: 500 };
    const atM1 = solveNashEquilibrium({ ...params, m: 1 });
    const atM2 = solveNashEquilibrium({ ...params, m: 2 });
    const totalM1 = atM1.attackerEffort + atM1.defenseEffort;
    const totalM2 = atM2.attackerEffort + atM2.defenseEffort;
    assert.ok(totalM2 > totalM1, `esperaba más esfuerzo total con m=2 (${totalM2}) que m=1 (${totalM1})`);
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

test('calculateInsuranceRetainedALE: omitir el coaseguro deja el resultado idéntico al de siempre', () => {
    // Guarda de regresión: `coveragePercent` se agregó después, y todo lo ya guardado llama sin
    // él. Si el default no fuera 100, cada póliza del Registro cambiaría de valor en silencio.
    const losses = [5000, 100000, 250000, 1000000];
    assert.strictEqual(
        calculateInsuranceRetainedALE(losses, 10000, 200000, false),
        calculateInsuranceRetainedALE(losses, 10000, 200000, false, 100),
    );
});

test('calculateInsuranceRetainedALE: el coaseguro paga solo su fracción del excedente', () => {
    const losses = [100000];
    // Deducible 10k, cobertura ilimitada arriba de él, pero la póliza responde por el 25 %:
    // excedente 90k → paga 22,5k → se retienen 77,5k.
    assert.strictEqual(calculateInsuranceRetainedALE(losses, 10000, 0, true, 25), 77500);
});

test('calculateInsuranceRetainedALE: un coaseguro de 0 NO se confunde con cobertura total', () => {
    // El caso que `|| 100` habría roto en silencio: 0 es falsy. Una póliza que no responde por
    // nada de esta pérdida deja la pérdida completa retenida, no cero.
    const losses = [100000];
    assert.strictEqual(calculateInsuranceRetainedALE(losses, 10000, 0, true, 0), 100000);
});

test('calculateInsuranceRetainedALE: coaseguro y sub-límite coinciden en un punto y difieren en el resto', () => {
    // Es la razón entera por la que el coaseguro es un parámetro nuevo y no se podía expresar con
    // el límite que ya existía. Un sub-límite de 3M sobre una pérdida de 12M paga el 25 %...
    assert.strictEqual(calculateInsuranceRetainedALE([12e6], 0, 3e6, false), 9e6);
    assert.strictEqual(calculateInsuranceRetainedALE([12e6], 0, 0, true, 25), 9e6);
    // ...pero sobre una pérdida de 4M el sub-límite paga el 75 % y el coaseguro sigue pagando 25 %.
    assert.strictEqual(calculateInsuranceRetainedALE([4e6], 0, 3e6, false), 1e6);
    assert.strictEqual(calculateInsuranceRetainedALE([4e6], 0, 0, true, 25), 3e6);
});

test('calculateInsuranceRetainedALE: el límite topa lo que la aseguradora desembolsa, después del coaseguro', () => {
    // Orden de una póliza real: el coaseguro define de cuánto responde, el límite topa el pago.
    // Excedente 90k × 50 % = 45k de responsabilidad, pero el límite solo deja pagar 20k.
    assert.strictEqual(calculateInsuranceRetainedALE([100000], 10000, 20000, false, 50), 80000);
});

test('expectedNetBenefit: Fiabilidad "nula" deja el beneficio neto en exactamente -costo', () => {
    // "Nula" no es el punto más bajo de la escala, es un estado distinto: la póliza no responde a
    // este peligro por diseño (ver tools/referencia-sector/, LR09: CBI sin daño físico directo).
    // La app tiene que poder decir "no compres esto", y con piso 0,4 afirmaba un 40 % de éxito
    // que nadie sostiene.
    assert.strictEqual(RELIABILITY_TO_PROBABILITY.nula, 0);
    assert.strictEqual(expectedNetBenefit(10000, 40000, 'nula'), -10000);
    // Y queda estrictamente dominada por no hacer nada, que es el resultado correcto.
    assert.ok(expectedNetBenefit(10000, 40000, 'nula') < 0);
    assert.ok(expectedNetBenefit(10000, 40000, 'nula') < expectedNetBenefit(10000, 40000, 'baja'));
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

test('evaluateTreatmentStrategies: sin currentCVaR, residualCVaR queda en null (no revienta ni inventa un número)', () => {
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
    assert.strictEqual(result.mitigar.residualCVaR, null);
    assert.strictEqual(result.evitar.residualCVaR, 0); // Evitar es 0 SIEMPRE, con o sin CVaR conocido.
    assert.strictEqual(result.aceptar.residualCVaR, null);
});

// Camino de RESPALDO (sin mitigar.residualALE/residualCVaR reales, ver el test de más abajo que
// SÍ los manda): escala proporcionalmente currentALE/currentCVaR por reductionPercent — la mejor
// aproximación disponible cuando no hay un Nivel de Defensa Objetivo real que simular (modo
// manual). Ya no es la ÚNICA fórmula (ver "usa residualALE/residualCVaR reales..." abajo).
test('evaluateTreatmentStrategies: sin residualALE/residualCVaR reales (modo manual), escala proporcionalmente por reductionPercent', () => {
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            currentCVaR: 250000,
            annualLosses: null,
            mitigar: { cost: 10000, reductionPercent: 60, reliability: 'media', delayDays: 0 },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.mitigar.residualALE, 40000); // 100000 * (1 - 0.6)
    assert.strictEqual(result.mitigar.residualCVaR, 100000); // 250000 * (1 - 0.6)
    assert.strictEqual(result.evitar.residualCVaR, 0);
    assert.strictEqual(result.aceptar.residualALE, 100000);
    assert.strictEqual(result.aceptar.residualCVaR, 250000);
    assert.strictEqual(result.transferir.residualCVaR, undefined); // fuera de alcance a propósito
});

// El arreglo real: con mitigar.residualALE/residualCVaR (ver calculateResidualFromSimulation),
// se usan TAL CUAL — NO se derivan de reductionPercent × currentALE/currentCVaR. La prueba clave:
// un residualCVaR que NO guarda la misma proporción que residualALE respecto a sus actuales
// (algo que la fórmula de escalado proporcional NUNCA podría producir) debe pasar intacto.
test('evaluateTreatmentStrategies: CON residualALE/residualCVaR reales, los usa tal cual — SIN forzar la misma proporción que reductionPercent', () => {
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            currentCVaR: 250000,
            annualLosses: null,
            mitigar: {
                cost: 10000,
                reductionPercent: 60, // "60%" solo para mostrar — NO debe usarse para el cálculo
                residualALE: 45000, // 55% de reducción real
                residualCVaR: 130000, // 48% de reducción real — proporción DISTINTA a residualALE a propósito
                reliability: 'media',
                delayDays: 0,
            },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.mitigar.residualALE, 45000);
    assert.strictEqual(result.mitigar.residualCVaR, 130000);
    assert.strictEqual(result.mitigar.avoidedLoss, 55000); // 100000 - 45000, no 40000 (el de reductionPercent)
});

test('evaluateTreatmentStrategies: residualALE=0 (defensa "perfecta") se respeta — 0 es válido, no cae al escalado por accidente', () => {
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            currentCVaR: 250000,
            annualLosses: null,
            mitigar: {
                cost: 10000,
                reductionPercent: 60,
                residualALE: 0,
                residualCVaR: 0,
                reliability: 'media',
                delayDays: 0,
            },
            transferir: { premium: 0, deductible: 0, limit: 0, unlimited: false, reliability: 'media', delayDays: 0 },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.mitigar.residualALE, 0);
    assert.strictEqual(result.mitigar.residualCVaR, 0);
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

test('evaluateTreatmentStrategies: Transferir con deducible/cobertura ilimitada capturados pero SIN annualLosses queda "no calculable" (bug real corregido, no un $0 falso)', () => {
    // Bug real reportado por el usuario: la página de Tratamiento (standalone, sin los 10,000
    // escenarios de la simulación — el Registro solo persiste un histograma) mostraba "Pérdida
    // Evitada: $0.00" para una póliza con deducible bajo y cobertura ILIMITADA, como si esa
    // cobertura de verdad no ahorrara nada — un resultado matemáticamente imposible, no la
    // ausencia de un dato. Ahora ese caso se distingue explícitamente: cost/reliability/delayDays
    // siguen presentes (para mostrar la prima igual), pero residualALE/avoidedLoss/netBenefit
    // quedan en null y el veredicto explica por qué, en vez de fingir un cálculo real.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null, // riesgo cargado desde el Registro, no recién simulado
            mitigar: { cost: 0, reductionPercent: 0, reliability: 'media', delayDays: 0 },
            transferir: {
                premium: 5000,
                deductible: 1000,
                limit: 0,
                unlimited: true,
                reliability: 'media',
                delayDays: 0,
            },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.transferir.cost, 5000);
    assert.strictEqual(result.transferir.residualALE, null);
    assert.strictEqual(result.transferir.avoidedLoss, null);
    assert.strictEqual(result.transferir.netBenefit, null);
    assert.strictEqual(result.transferir.verdict.verdict, 'sin_datos');
    assert.match(result.transferir.verdict.message, /no se puede calcular/i);
    // Con solo Transferir teniendo costo capturado (y ahora excluido de la comparación por ser
    // "no calculable"), no queda ninguna estrategia activa comparable — cae a Aceptar, NO a
    // "transferir" con un beneficio neto null pasando como si fuera 0 (ver el fix del filtro de
    // activeStrategies, donde `null > numero_negativo` coercionaba a `true` en JS).
    assert.strictEqual(result.recommendation.strategy, 'aceptar');
});

test('evaluateTreatmentStrategies: Transferir SIN ningún término de seguro capturado sigue dando avoidedLoss=$0 real (no "no calculable")', () => {
    // Distingue el caso de arriba: sin deducible/límite/sin-límite, no hay nada que evaluar —
    // avoidedLoss=$0 es la respuesta REAL (no se modeló ningún seguro), no un hueco de datos.
    const fmt = (n) => `$${n}`;
    const result = evaluateTreatmentStrategies(
        {
            currentALE: 100000,
            annualLosses: null,
            mitigar: { cost: 0, reductionPercent: 0, reliability: 'media', delayDays: 0 },
            transferir: {
                premium: 5000,
                deductible: 0,
                limit: 0,
                unlimited: false,
                reliability: 'media',
                delayDays: 0,
            },
            evitar: { cost: 0, reliability: 'alta', delayDays: 0 },
        },
        fmt,
    );
    assert.strictEqual(result.transferir.residualALE, 100000);
    assert.strictEqual(result.transferir.avoidedLoss, 0);
    assert.strictEqual(result.transferir.netBenefit, -5000);
    assert.strictEqual(result.transferir.verdict.verdict, 'no_conviene');
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

test('evaluateMitigarConTransferir: usa mitigar.residualALE real (no reductionPercent clampeado a 0) cuando el residual es PEOR que el actual (regresión)', () => {
    // Regresión del bug real: antes se derivaba aleAfterMitigar de reductionPercent (entero
    // REDONDEADO y ACOTADO a [0,100]), nunca de mitigar.residualALE — cuando el Nivel de Defensa
    // Objetivo resulta PEOR que el actual, reductionPercent se acota a 0 y la rama combinada
    // asumía "sin cambio" (aleAfterMitigar = currentALE) en vez de reflejar el residual real
    // (150000, peor que los 100000 actuales). Se aísla el efecto con annualLosses=null (misma
    // técnica que el primer test de este bloque) para que transferir quede siempre dominado por
    // aceptar y el único efecto medido sea el de aleAfterMitigar/scaleFactor.
    const result = evaluateMitigarConTransferir({
        currentALE: 100000,
        annualLosses: null,
        mitigar: { cost: 10000, reductionPercent: 0, residualALE: 150000, reliability: 'alta' },
        transferir: { premium: 5000, reliability: 'alta', deductible: 0, limit: 0, unlimited: false },
    });
    // Rama "mitigar funciona" (p=0.9, baseALE=150000 real): aceptar = 100000-150000-10000 = -60000
    // (transferir siempre -65000, dominado) → gana aceptar (-60000).
    // Rama "mitigar falla" (p=0.1, baseALE=100000): aceptar = 100000-100000-10000 = -10000
    // (transferir siempre -15000, dominado) → gana aceptar (-10000).
    // Total = 0.9*(-60000) + 0.1*(-10000) = -54000 - 1000 = -55000. Con el bug (aleAfterMitigar
    // congelado en 100000 por el clamp de reductionPercent), el resultado hubiera sido -10000 —
    // una diferencia de 45000, ocultando por completo el deterioro real de la defensa.
    assert.strictEqual(result.branches[0].bestOption, 'aceptar');
    assert.strictEqual(result.branches[0].value, -60000);
    assert.strictEqual(result.branches[1].bestOption, 'aceptar');
    assert.strictEqual(result.branches[1].value, -10000);
    assert.strictEqual(result.value, -55000);
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
    // netBenefit (86700) + cost (15000) = 101700, por encima de currentALE (100000) — el
    // "avoidedLoss implícito" de esta combinación puede superar el 100% del ALE actual (la
    // expectativa mezcla ramas donde mitigar Y transferir funcionan a la vez), así que el
    // residualALE derivado se acota en 0 en vez de dar un número negativo sin sentido.
    assert.strictEqual(result.mitigarTransferir.residualALE, 0);
    assert.strictEqual(result.recommendation.strategy, 'mitigarTransferir');
    assert.strictEqual(result.recommendation.netBenefit, 86700);
});

test('evaluateFairThreat: clasifica correctamente como Crítico por encima del umbral', () => {
    const criteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    const fmt = (n) => `$${n}`;
    const result = evaluateFairThreat(300000, 100000, criteria, fmt);
    assert.strictEqual(result.severity, 'critico');
});

// El tramo entre Aceptable y Crítico se parte a la mitad exacta en Medio/Alto — sin un tercer
// umbral configurado aparte (decisión explícita del usuario, ver la conversación). Mismo
// ejemplo que se usó para definirlo: aceptable=50000, crítico=250000 -> aleMedio=150000.
//   Bajo: <= 50000 | Medio: 50001-150000 | Alto: 150001-249999 | Crítico: >= 250001
// (el límite superior de Crítico usa '>' estricto, igual que ya usaba el resto de la app —
// ale === aleCritico exacto todavía NO cuenta como Crítico, mismo criterio que antes).
test('evaluateFairThreat: parte el tramo Aceptable-Crítico a la mitad exacta (Medio/Alto)', () => {
    const criteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    const fmt = (n) => `$${n}`;
    const cvarBajo = 0; // sin riesgo de cola en ninguno de estos casos

    assert.strictEqual(evaluateFairThreat(50000, cvarBajo, criteria, fmt).severity, 'bajo');
    assert.strictEqual(evaluateFairThreat(50001, cvarBajo, criteria, fmt).severity, 'medio');
    assert.strictEqual(evaluateFairThreat(150000, cvarBajo, criteria, fmt).severity, 'medio');
    assert.strictEqual(evaluateFairThreat(150001, cvarBajo, criteria, fmt).severity, 'alto');
    assert.strictEqual(evaluateFairThreat(250000, cvarBajo, criteria, fmt).severity, 'alto');
    assert.strictEqual(evaluateFairThreat(250001, cvarBajo, criteria, fmt).severity, 'critico');
});

test('evaluateFairThreat: el riesgo de cola (CVaR95) sigue escalando a Crítico aunque el promedio caiga en Medio/Alto', () => {
    // Bug que NO debía reaparecer al agregar el nivel Medio: el chequeo de CVaR95 va ANTES
    // que la nueva rama de Medio/Alto en el código — un promedio tranquilo con una cola gorda
    // debe seguir ganándole a cualquier clasificación por el promedio solo.
    const criteria = { aleAceptablePercent: 20, aleCritico: 250000 };
    const fmt = (n) => `$${n}`;
    const result = evaluateFairThreat(100000, 300000, criteria, fmt); // ale cae en "Medio", cvar95 no
    assert.strictEqual(result.severity, 'critico');
    assert.ok(result.level.includes('cola'));
});

// --- normalizeRiskCriteria/validateRiskCriteriaOverride (migración del ALE Aceptable en
// dólares a Pérdida Anual Aceptable %, ver backend/src/lib/riskCriteria.js) ---

test('normalizeRiskCriteria: deja intacto un criterio que ya trae aleAceptablePercent', () => {
    const criteria = { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptablePercent: 30, aleCritico: 100000 };
    assert.deepStrictEqual(normalizeRiskCriteria(criteria), criteria);
});

test('normalizeRiskCriteria: migra un criterio guardado en el formato viejo (aleAceptable en dólares)', () => {
    // Bug real: sin esto, un criterio guardado ANTES de que existiera aleAceptablePercent
    // llega con ese campo undefined -> evaluateFairThreat calcula aleAceptable = NaN, y
    // CUALQUIER comparación contra NaN es false en JS: todo se clasifica como "Aceptable".
    const legacy = { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptable: 50000, aleCritico: 250000 };
    const normalized = normalizeRiskCriteria(legacy);
    assert.strictEqual(normalized.aleAceptablePercent, 20); // 50000/250000*100
    assert.strictEqual(normalized.aleCritico, 250000);
});

test('normalizeRiskCriteria: sin aleAceptable ni aleAceptablePercent, cae a un 20% por defecto', () => {
    const bare = { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleCritico: 250000 };
    assert.strictEqual(normalizeRiskCriteria(bare).aleAceptablePercent, 20);
});

test('normalizeRiskCriteria: acota el % derivado a 1-99 (nunca 0 ni >=100, aunque el monto viejo lo fuera)', () => {
    const zero = normalizeRiskCriteria({ aleAceptable: 0, aleCritico: 100000 });
    assert.strictEqual(zero.aleAceptablePercent, 1);
    const overCritico = normalizeRiskCriteria({ aleAceptable: 500000, aleCritico: 100000 });
    assert.strictEqual(overCritico.aleAceptablePercent, 99);
});

test('validateRiskCriteriaOverride: null/undefined (sin override) es válido', () => {
    assert.strictEqual(validateRiskCriteriaOverride(null), null);
    assert.strictEqual(validateRiskCriteriaOverride(undefined), null);
});

test('validateRiskCriteriaOverride: acepta un override parcial dentro de rango', () => {
    assert.strictEqual(validateRiskCriteriaOverride({ aleAceptablePercent: 20, aleCritico: 250000 }), null);
});

test('validateRiskCriteriaOverride: rechaza aleAceptablePercent fuera de 0-100', () => {
    assert.ok(validateRiskCriteriaOverride({ aleAceptablePercent: 150, aleCritico: 1000 }));
    assert.ok(validateRiskCriteriaOverride({ aleAceptablePercent: 0, aleCritico: 1000 }));
    assert.ok(validateRiskCriteriaOverride({ aleAceptablePercent: 100, aleCritico: 1000 }));
});

test('validateRiskCriteriaOverride: rechaza aleCritico <= 0', () => {
    assert.ok(validateRiskCriteriaOverride({ aleCritico: 0 }));
    assert.ok(validateRiskCriteriaOverride({ aleCritico: -500 }));
});

// El override individual puede ser más restrictivo que el global (menos tolerancia para un
// riesgo en particular), pero nunca más permisivo — "mi máximo global es $1M, pero para este
// riesgo mi máximo es $2M" se contradice a sí mismo, porque el global YA es el techo absoluto.
test('validateRiskCriteriaOverride: acepta un aleCritico individual igual o menor al global', () => {
    const global = { aleCritico: 1000000 };
    assert.strictEqual(validateRiskCriteriaOverride({ aleCritico: 1000000 }, global), null);
    assert.strictEqual(validateRiskCriteriaOverride({ aleCritico: 500000 }, global), null);
});

test('validateRiskCriteriaOverride: rechaza un aleCritico individual mayor al global', () => {
    const global = { aleCritico: 1000000 };
    assert.ok(validateRiskCriteriaOverride({ aleCritico: 2000000 }, global));
});

test('validateRiskCriteriaOverride: sin globalCriteria, no valida el tope (solo el rango propio)', () => {
    assert.strictEqual(validateRiskCriteriaOverride({ aleCritico: 2000000 }), null);
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

test('calculateResidualPortfolio: mezcla de riesgos tratados/sin tratar usa el residual/inherente correcto', () => {
    const risks = [
        {
            riskName: 'Tratado',
            riskType: 'amenaza',
            ale: 100000,
            cvar95: 200000,
            treatmentDecision: { strategy: 'mitigar', residualALE: 30000, residualCVaR: 60000 },
        },
        { riskName: 'Sin tratar', riskType: 'amenaza', ale: 50000, cvar95: 90000, treatmentDecision: null },
    ];
    const portfolio = calculateResidualPortfolio(risks);
    assert.strictEqual(portfolio.totalResidualALE, 30000 + 50000);
    assert.strictEqual(portfolio.totalResidualCVaR, 60000 + 90000);
    assert.strictEqual(portfolio.cvarRiskCount, 2);
    assert.strictEqual(portfolio.cvarSkippedCount, 0);
    assert.strictEqual(portfolio.treatedCount, 1);
    assert.strictEqual(portfolio.untreatedCount, 1);
    assert.strictEqual(portfolio.totalRiskCount, 2);
});

test('calculateResidualPortfolio: una decisión Transferir (sin residualCVaR) se excluye de la suma de CVaR pero SÍ cuenta en la de ALE', () => {
    const risks = [
        {
            riskName: 'Transferido',
            riskType: 'amenaza',
            ale: 80000,
            cvar95: 150000,
            treatmentDecision: { strategy: 'transferir', residualALE: 20000 },
        },
    ];
    const portfolio = calculateResidualPortfolio(risks);
    assert.strictEqual(portfolio.totalResidualALE, 20000);
    assert.strictEqual(portfolio.totalResidualCVaR, null);
    assert.strictEqual(portfolio.cvarRiskCount, 0);
    assert.strictEqual(portfolio.cvarSkippedCount, 1);
    // El piso sí lo cubre, sustituyendo el CVaR desconocido por el residualALE de ese riesgo.
    assert.strictEqual(portfolio.totalResidualCVaRFloor, 20000);
});

test('calculateResidualPortfolio: el piso de CVaR cubre TODAS las amenazas, no solo las que traen CVaR residual', () => {
    const risks = [
        {
            riskName: 'Transferido (sin CVaR residual)',
            riskType: 'amenaza',
            ale: 400000,
            cvar95: 900000,
            treatmentDecision: { strategy: 'transferir', residualALE: 400000 },
        },
        { riskName: 'Sin tratar (con CVaR)', riskType: 'amenaza', ale: 150000, cvar95: 400000 },
    ];
    const portfolio = calculateResidualPortfolio(risks);
    assert.strictEqual(portfolio.totalResidualALE, 550000);
    assert.strictEqual(portfolio.totalResidualCVaR, 400000); // solo el que sí lo tiene
    assert.strictEqual(portfolio.totalResidualCVaRFloor, 400000 + 400000); // residualALE + CVaR real
    assert.strictEqual(portfolio.cvarSkippedCount, 1);
    // El piso nunca puede quedar por debajo del ALE de la misma canasta (CVaR95 >= promedio).
    assert.ok(portfolio.totalResidualCVaRFloor >= portfolio.totalResidualALE);
});

test('calculateResidualPortfolio: el piso de CVaR permite escalar a "Crítico por cola" un portafolio que cruzando canastas se quedaba en Alto (regresión)', () => {
    // Regresión de un bug real: el portafolio se clasificaba con evaluateFairThreat(ALE de TODAS
    // las amenazas, CVaR de SOLO las que lo tienen). Como el CVaR únicamente alimenta el escalón
    // de "Crítico por cola de riesgo", ese desfase solo podía fallar hacia SUBESTIMAR: dejaba de
    // marcar como Crítico un portafolio que sí lo era, en cuanto alguna decisión de Transferir
    // (o Mitigar+Transferir) no aportaba su CVaR residual.
    const fmt = (v) => `$${Math.round(v)}`;
    const criteria = { aleCritico: 1000000, aleAceptablePercent: 20 };
    const transferido = (n) => ({
        riskName: `Transferido ${n}`,
        riskType: 'amenaza',
        ale: 400000,
        cvar95: 900000,
        treatmentDecision: { strategy: 'transferir', residualALE: 400000 },
    });
    const risks = [
        transferido(1),
        transferido(2),
        { riskName: 'Sin tratar', riskType: 'amenaza', ale: 150000, cvar95: 400000 },
    ];

    const portfolio = calculateResidualPortfolio(risks);
    // El ALE total (950k) queda por debajo del criterio Crítico (1M): sin el escalón de cola,
    // este portafolio no se marca como Crítico.
    assert.ok(portfolio.totalResidualALE < criteria.aleCritico);

    const cruzado = evaluateFairThreat(portfolio.totalResidualALE, portfolio.totalResidualCVaR, criteria, fmt);
    const conPiso = evaluateFairThreat(portfolio.totalResidualALE, portfolio.totalResidualCVaRFloor, criteria, fmt);

    assert.strictEqual(cruzado.severity, 'alto', 'cruzando canastas el CVaR parcial (400k) no alcanza a escalar');
    assert.strictEqual(
        conPiso.severity,
        'critico',
        'con el piso completo (1.2M > 1M) sí debe escalar a Crítico por cola',
    );
});

test('calculateResidualPortfolio: excluye riesgos tipo "oportunidad", igual que calculateParetoAnalysis', () => {
    const risks = [
        { riskName: 'Amenaza', riskType: 'amenaza', ale: 40000, cvar95: 70000, treatmentDecision: null },
        { riskName: 'Oportunidad', riskType: 'oportunidad', ale: 500000, cvar95: 900000, treatmentDecision: null },
    ];
    const portfolio = calculateResidualPortfolio(risks);
    assert.strictEqual(portfolio.totalResidualALE, 40000);
    assert.strictEqual(portfolio.totalRiskCount, 1);
});

test('calculateResidualPortfolio: portafolio sin ninguna Amenaza da totalRiskCount 0 y CVaR null', () => {
    const risks = [{ riskName: 'Solo oportunidad', riskType: 'oportunidad', ale: 100000, cvar95: 150000 }];
    const portfolio = calculateResidualPortfolio(risks);
    assert.strictEqual(portfolio.totalRiskCount, 0);
    assert.strictEqual(portfolio.totalResidualALE, 0);
    assert.strictEqual(portfolio.totalResidualCVaR, null);
    assert.strictEqual(portfolio.treatedCount, 0);
    assert.strictEqual(portfolio.untreatedCount, 0);
});

test('calculateResidualParetoAnalysis: ordena por ALE RESIDUAL, no por el inherente — un riesgo tratado puede caer en el ranking', () => {
    const risks = [
        // Inherente más alto, pero mitigado a un residual chico — debe quedar SEGUNDO en el
        // ranking residual, aunque calculateParetoAnalysis (inherente) lo pondría primero.
        {
            riskName: 'Grande pero tratado',
            riskType: 'amenaza',
            ale: 900000,
            treatmentDecision: { strategy: 'mitigar', residualALE: 10000 },
        },
        { riskName: 'Mediano sin tratar', riskType: 'amenaza', ale: 100000, treatmentDecision: null },
    ];
    const residualPareto = calculateResidualParetoAnalysis(risks);
    assert.strictEqual(residualPareto.risks[0].riskName, 'Mediano sin tratar');
    assert.strictEqual(residualPareto.risks[0].residualALE, 100000);
    assert.strictEqual(residualPareto.risks[0].treated, false);
    assert.strictEqual(residualPareto.risks[1].riskName, 'Grande pero tratado');
    assert.strictEqual(residualPareto.risks[1].residualALE, 10000);
    assert.strictEqual(residualPareto.risks[1].treated, true);
    assert.strictEqual(residualPareto.totalExposure, 110000);
});

test('calculateResidualParetoAnalysis: excluye riesgos tipo "oportunidad", igual que calculateParetoAnalysis', () => {
    const risks = [
        { riskName: 'Amenaza', riskType: 'amenaza', ale: 40000, treatmentDecision: null },
        { riskName: 'Oportunidad', riskType: 'oportunidad', ale: 500000, treatmentDecision: null },
    ];
    const residualPareto = calculateResidualParetoAnalysis(risks);
    assert.strictEqual(residualPareto.totalRiskCount, 1);
    assert.ok(!residualPareto.risks.some((r) => r.riskName === 'Oportunidad'));
});

test('calculateResidualParetoAnalysis: portafolio sin ninguna Amenaza da totalRiskCount 0 y totalExposure 0', () => {
    const risks = [{ riskName: 'Solo oportunidad', riskType: 'oportunidad', ale: 100000 }];
    const residualPareto = calculateResidualParetoAnalysis(risks);
    assert.strictEqual(residualPareto.totalRiskCount, 0);
    assert.strictEqual(residualPareto.totalExposure, 0);
    assert.deepStrictEqual(residualPareto.risks, []);
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

// --- standardsReference.js (catálogo curado de normas/marcos, base para las tarjetas de riesgo) ---

test('hazardStandards: cubre TODOS los tokens de `standard` usados en riskCatalog, sin ninguno huérfano', () => {
    // El campo `standard` de cada amenaza puede traer varios separados por ", " (ej. "ASIS,
    // ISO 27001 Anexo A (Seguridad Física)") — cada token debe tener su propia entrada en
    // hazardStandards, o el catálogo de normas queda incompleto en silencio la próxima vez que
    // alguien agregue una amenaza citando una norma nueva.
    const usedTokens = new Set();
    Object.values(riskCatalog).forEach((domain) => {
        Object.values(domain.categories).forEach((category) => {
            category.threats.forEach((threat) => {
                threat.standard.split(',').forEach((token) => usedTokens.add(token.trim()));
            });
        });
    });

    const missing = [...usedTokens].filter((token) => !hazardStandards[token]);
    assert.deepStrictEqual(missing, [], `Tokens de \`standard\` sin entrada en hazardStandards: ${missing.join(', ')}`);
});

test('hazardStandards: cada entrada trae name y description no vacíos', () => {
    Object.entries(hazardStandards).forEach(([key, entry]) => {
        assert.ok(typeof entry.name === 'string' && entry.name.length > 0, `${key}.name`);
        assert.ok(typeof entry.description === 'string' && entry.description.length > 0, `${key}.description`);
    });
});

test('isoProcessClauses/rimsClauses: cada entrada trae title y summary no vacíos', () => {
    [isoProcessClauses, rimsClauses].forEach((clauses) => {
        Object.entries(clauses).forEach(([code, entry]) => {
            assert.ok(typeof entry.title === 'string' && entry.title.length > 0, `${code}.title`);
            assert.ok(typeof entry.summary === 'string' && entry.summary.length > 0, `${code}.summary`);
        });
    });
});

// --- Curva de Excedencia de Pérdidas (LEC) ---

test('buildLossExceedanceCurve: la probabilidad baja mientras el umbral en dinero sube (monótona en ambos ejes)', () => {
    const losses = Array.from({ length: 5000 }, (_, i) => i + 1); // 1..5000, distribución conocida
    const curva = buildLossExceedanceCurve(losses);
    assert.ok(curva.length > 20, 'debe devolver una curva con suficientes puntos para dibujarse');
    for (let i = 1; i < curva.length; i++) {
        assert.ok(
            curva[i].probability < curva[i - 1].probability,
            `la probabilidad debe ir bajando: ${curva[i - 1].probability} -> ${curva[i].probability}`,
        );
        assert.ok(
            curva[i].loss >= curva[i - 1].loss,
            `el umbral en dinero no puede bajar al bajar la probabilidad: ${curva[i - 1].loss} -> ${curva[i].loss}`,
        );
    }
});

test('buildLossExceedanceCurve: cada punto coincide con la probabilidad EMPÍRICA de excederlo (prueba cruzada)', () => {
    // El invariante que de verdad importa: si la curva dice "5% de probabilidad de perder más de
    // $X", entonces contar cuántas de las 10,000 pérdidas simuladas superan $X debe dar ~5%. Sin
    // esto, la curva podría verse bien dibujada y estar corrida un cuantil.
    const { annualLosses } = runMonteCarloSimulation({
        iterations: 10000,
        seed: 31415,
        tef: { min: 0.5, mode: 2, max: 5 },
        vuln: { min: 20, mode: 50, max: 80 },
        lossMagnitudes: { productividad: { min: 10000, mode: 50000, max: 200000 } },
    });
    const curva = buildLossExceedanceCurve(annualLosses);
    const n = annualLosses.length;
    curva.forEach(({ loss, probability }) => {
        const empirica = (annualLosses.filter((l) => l > loss).length / n) * 100;
        assert.ok(
            Math.abs(empirica - probability) < 1,
            `en $${Math.round(loss)} la curva dice ${probability}% pero la cuenta real da ${empirica.toFixed(2)}%`,
        );
    });
});

test('buildLossExceedanceCurve: es consistente con el probExceedance que la app ya calculaba por separado', () => {
    // summarizeLosses(losses, umbral).probExceedance y la curva son dos caminos distintos hacia
    // el mismo número. Si divergen, uno de los dos está mal — y como el umbral de excedencia sale
    // de los Criterios de Riesgo del usuario, ese número ya se le muestra en pantalla.
    const { annualLosses } = runMonteCarloSimulation({
        iterations: 10000,
        seed: 2718,
        tef: { min: 1, mode: 3, max: 6 },
        vuln: { min: 30, mode: 60, max: 90 },
        lossMagnitudes: { reemplazo: { min: 20000, mode: 80000, max: 300000 } },
    });
    const curva = buildLossExceedanceCurve(annualLosses);
    // Se toma un punto intermedio de la curva como umbral y se pide el número por el otro camino.
    const punto = curva[Math.floor(curva.length / 2)];
    const { probExceedance } = summarizeLosses(annualLosses, punto.loss);
    assert.ok(
        Math.abs(probExceedance - punto.probability) < 1,
        `la curva dice ${punto.probability}% en $${Math.round(punto.loss)}, summarizeLosses dice ${probExceedance.toFixed(2)}%`,
    );
});

test('buildLossExceedanceCurve: sin pérdidas devuelve una curva vacía, no truena', () => {
    assert.deepStrictEqual(buildLossExceedanceCurve([]), []);
    assert.deepStrictEqual(buildLossExceedanceCurve(null), []);
});

// ---------------------------------------------------------------------------------------------
// Monte Carlo ACOPLADO del portafolio (ver lib/portfolioSimulation.js)
// ---------------------------------------------------------------------------------------------
// Antes, el CVaR95 y el p90 del portafolio se obtenían SUMANDO los de cada riesgo. El ALE sí se
// puede sumar (la esperanza es lineal) pero un percentil no. Estos tests fijan esa distinción.
function makePortfolioRisk(riskName, overrides = {}) {
    return {
        riskName,
        riskType: 'amenaza',
        vulnManualOverride: true,
        tef: { min: 1, mode: 2, max: 4 },
        vuln: { min: 20, mode: 40, max: 60 },
        lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
        ...overrides,
    };
}

// --- De quién es el año malo: asignación de Euler del CVaR95 --------------------------------
// La propiedad que hace utilizable a esta asignación es que SUMA EXACTAMENTE el CVaR conjunto, sin
// residuo que repartir a ojo. Se prueba como igualdad (tolerancia de punto flotante), no como
// aproximación: si algún día la contribución acoplada dejara de sumar el total —por ejemplo si la
// cascada añadiera un término al portafolio sin anotarlo en el aporte de nadie— este test lo dice.
test('allocateTailContributions: las contribuciones suman EXACTAMENTE el CVaR95 del portafolio', () => {
    const riesgos = [
        makePortfolioRisk('Grande', { lossMagnitudes: { respuesta: { min: 20000, mode: 90000, max: 300000 } } }),
        makePortfolioRisk('Mediano'),
        makePortfolioRisk('Chico', { lossMagnitudes: { respuesta: { min: 500, mode: 2000, max: 6000 } } }),
    ];
    const r = simulatePortfolio(riesgos);
    const suma = r.tailContributors.reduce((acc, t) => acc + t.contribution, 0);
    assert.ok(
        Math.abs(suma - r.summary.cvar95) < 1e-6,
        `las contribuciones suman ${suma.toFixed(6)} pero el CVaR95 es ${r.summary.cvar95.toFixed(6)}`,
    );
    assert.strictEqual(r.tailContributors.length, 3);
    // Y vienen ordenadas de mayor a menor, que es como se leen.
    assert.ok(r.tailContributors[0].contribution >= r.tailContributors[1].contribution);
    assert.ok(r.tailContributors[1].contribution >= r.tailContributors[2].contribution);
});

test('allocateTailContributions: la cuota del año malo NO es la del año promedio (si lo fuera, no diría nada nuevo)', () => {
    // Un riesgo raro y severo contra dos frecuentes y menores. El raro pesa poco en el promedio y
    // mucho en la cola: ésa es exactamente la distinción que esta asignación existe para mostrar,
    // y la que el CVaR individual de cada riesgo no puede dar (no sabe con quién coincide).
    const raroSevero = makePortfolioRisk('Raro y severo', {
        tef: { min: 0.02, mode: 0.05, max: 0.1 },
        lossMagnitudes: { respuesta: { min: 200000, mode: 800000, max: 3000000 } },
    });
    const frecuente = (n) =>
        makePortfolioRisk(n, {
            tef: { min: 8, mode: 12, max: 20 },
            lossMagnitudes: { respuesta: { min: 500, mode: 1500, max: 4000 } },
        });
    const r = simulatePortfolio([raroSevero, frecuente('Frecuente A'), frecuente('Frecuente B')]);
    const raro = r.tailContributors.find((t) => t.riskName === 'Raro y severo');
    assert.ok(
        raro.sharePercent > raro.expectedSharePercent + 10,
        `el raro y severo debería pesar bastante más en la cola (${raro.sharePercent.toFixed(1)} %) que en ` +
            `el promedio (${raro.expectedSharePercent.toFixed(1)} %)`,
    );
});

test('allocateTailContributions: la cascada REUBICA la contribución de un riesgo, no la crea', () => {
    // "La cascada explica ocurrencias, no las añade" es el invariante central del acoplamiento
    // (ver §8.3 del documento del modelo), y hasta ahora solo se podía comprobar sobre el ALE del
    // portafolio entero. La asignación lo hace verificable RIESGO POR RIESGO: la parte espontánea
    // del hijo se adelgaza justo en la proporción que sus padres explican, así que su aporte
    // ESPERADO no se mueve — lo que cambia es en qué años cae, y eso vive en la cola.
    //
    // Regímenes raros a propósito: es donde la cascada tiene efecto (medido: +17,9 % de cola a
    // LEF 0,05 contra −0,6 % a LEF 3).
    const raro = (riskName, overrides) =>
        makePortfolioRisk(riskName, {
            tef: { min: 0.1, mode: 0.25, max: 0.5 },
            vuln: { min: 60, mode: 80, max: 95 },
            lossMagnitudes: { respuesta: { min: 50000, mode: 200000, max: 800000 } },
            ...overrides,
        });
    const conArista = (probability) =>
        simulatePortfolio([raro('Padre'), raro('Hijo', { triggeredBy: [{ riskName: 'Padre', probability }] })]);

    const sin = simulatePortfolio([raro('Padre'), raro('Hijo')]);
    const base = sin.tailContributors.find((t) => t.riskName === 'Hijo').expectedLoss;
    for (const probability of [25, 50, 90]) {
        const r = conArista(probability);
        assert.deepStrictEqual(r.overCoupledRiskNames, [], `la fixture no debe contradecirse a ${probability} %`);
        const conAristaEsperado = r.tailContributors.find((t) => t.riskName === 'Hijo').expectedLoss;
        assert.ok(
            Math.abs(conAristaEsperado - base) / base < 0.05,
            `con arista al ${probability} % el aporte esperado del hijo debería seguir siendo ~${base.toFixed(0)}, ` +
                `dio ${conAristaEsperado.toFixed(0)}`,
        );
        // Y la suma exacta se conserva también por el camino de cascada, que es el que arma la
        // contribución término por término.
        const suma = r.tailContributors.reduce((acc, t) => acc + t.contribution, 0);
        assert.ok(
            Math.abs(suma - r.summary.cvar95) < 1e-6,
            'con cascada las contribuciones deben seguir sumando el CVaR95',
        );
    }
});

// Invariante que el código AFIRMABA y no se cumple — encontrado al construir la asignación del año
// malo, y documentado aquí para que nadie lo vuelva a dar por sentado.
//
// `correlationPenalty` (cuánto engorda la cola la correlación declarada) se describía como
// "siempre >= 0". No lo es: con aristas de probabilidad alta se vuelve NEGATIVA. La causa es que
// `marca` es un indicador 0/1 — un padre arrastra a su hijo COMO MUCHO UNA VEZ POR AÑO, aunque el
// padre haya ocurrido tres veces. Cuando casi toda la ocurrencia del hijo pasa a ser inducida
// (espontánea ~ 0), esa regla le borra sus años de VARIOS eventos, que son justo los que le
// engordaban la cola. Concentrar al hijo con el padre sube la cola; taparle los años múltiples la
// baja; a probabilidad alta gana lo segundo.
//
// Este test FIJA el comportamiento real, no el deseado. Si algún día el arrastre pasa a ser
// multi-evento (proporcional al conteo del padre), este test debe fallar y actualizarse — es
// justamente la señal que se quiere.
test('cascada: correlationPenalty puede ser NEGATIVA con aristas de probabilidad alta (arrastre de a lo sumo uno por año)', () => {
    const raro = (riskName, overrides) =>
        makePortfolioRisk(riskName, {
            tef: { min: 0.1, mode: 0.25, max: 0.5 },
            vuln: { min: 60, mode: 80, max: 95 },
            lossMagnitudes: { respuesta: { min: 50000, mode: 200000, max: 800000 } },
            ...overrides,
        });
    const alta = simulatePortfolio([
        raro('Padre'),
        raro('Hijo', { triggeredBy: [{ riskName: 'Padre', probability: 90 }] }),
    ]);
    assert.ok(
        alta.correlationPenalty < 0,
        `esperaba penalización negativa con arista al 90 %, dio ${alta.correlationPenalty.toFixed(0)}`,
    );
    // Y el ALE se preserva igual: la anomalía vive en la cola, no en la media.
    const sin = simulatePortfolio([raro('Padre'), raro('Hijo')]);
    assert.ok(
        Math.abs(alta.summary.average - sin.summary.average) / sin.summary.average < 0.02,
        'la media del portafolio no debe moverse por declarar una dependencia',
    );
});

test('allocateTailContributions: un portafolio sin riesgos simulables devuelve la lista vacía, no un error', () => {
    const r = simulatePortfolio([{ riskName: 'Sin datos', riskType: 'amenaza' }]);
    assert.deepStrictEqual(r.tailContributors, []);
});

test('simulatePortfolio: el ALE del portafolio SÍ es la suma de los ALE individuales (esperanza lineal)', () => {
    const uno = simulatePortfolio([makePortfolioRisk('P1')]);
    const cinco = simulatePortfolio([1, 2, 3, 4, 5].map((i) => makePortfolioRisk(`P${i}`)));
    const esperado = uno.summary.average * 5;
    assert.ok(
        Math.abs(cinco.summary.average - esperado) / esperado < 0.05,
        `esperaba ~${esperado.toFixed(0)}, dio ${cinco.summary.average.toFixed(0)}`,
    );
});

// --- Tope de daño por evento (contención) --------------------------------------------------

// Cola larga a propósito: el máximo es 40x la moda, así que unos pocos escenarios dominan la cola.
// Es el caso donde contener y prevenir se distinguen de verdad.
const RIESGO_COLA_GORDA = {
    iterations: 20000,
    seed: 4242,
    tef: { min: 1, mode: 2, max: 4 },
    vuln: { min: 20, mode: 40, max: 60 },
    lossMagnitudes: { respuesta: { min: 5000, mode: 25000, max: 1000000 } },
};

test('prevenir y contener deforman la cola en direcciones OPUESTAS', () => {
    const razon = (params) => {
        const r = summarizeLosses(runMonteCarloSimulation(params).annualLosses);
        return r.cvar95 / r.average;
    };
    const base = razon(RIESGO_COLA_GORDA);
    // PREVENIR: la misma Vulnerabilidad reducida a la mitad — menos eventos, igual de caros.
    const prevenido = razon({ ...RIESGO_COLA_GORDA, vuln: { min: 10, mode: 20, max: 30 } });
    // CONTENER: un tope que recorta los peores escenarios y deja los demás intactos.
    const contenido = razon({ ...RIESGO_COLA_GORDA, magnitudeCap: 60000 });

    // La firma de la PREVENCIÓN con el modelo compuesto: la razón cola/media SUBE. Bajar la
    // Vulnerabilidad reduce la CANTIDAD de eventos, no lo que cuesta cada uno — hace los malos
    // años más RAROS, no menos malos, así que la cola baja menos que el promedio.
    //
    // Con el modelo anterior esta razón quedaba congelada (escalar la Vulnerabilidad multiplicaba
    // toda la distribución por una constante), y de ahí salía la conclusión de que la prevención
    // "no puede cambiar la forma de la cola". Era un artefacto del modelo, no del mundo.
    assert.ok(
        prevenido > base * 1.02,
        `prevenir debe SUBIR la razón cola/media: ${base.toFixed(3)} -> ${prevenido.toFixed(3)}`,
    );
    // La firma de la CONTENCIÓN, en cambio, sigue siendo aplanar: trunca los peores escenarios.
    assert.ok(contenido < base * 0.9, `contener debe aplanar la cola: ${base.toFixed(3)} -> ${contenido.toFixed(3)}`);
});

test('con el modelo ANTERIOR, prevenir dejaba la razón cola/media congelada (el artefacto que se corrigió)', () => {
    // Se conserva a propósito: documenta con números por qué el modelo compuesto era necesario.
    // `pérdida = LEF × Magnitud` multiplica toda la distribución por una constante al escalar la
    // Vulnerabilidad, así que TODAS las estadísticas se mueven igual y la razón queda fija — el
    // control de prevención se veía incapaz de tocar la forma de la cola.
    const razon = (params) => {
        const r = summarizeLosses(runMonteCarloSimulation({ ...params, frequencyModel: 'expected' }).annualLosses);
        return r.cvar95 / r.average;
    };
    const base = razon(RIESGO_COLA_GORDA);
    const prevenido = razon({ ...RIESGO_COLA_GORDA, vuln: { min: 10, mode: 20, max: 30 } });
    assert.ok(
        Math.abs(prevenido - base) < base * 0.02,
        `esperaba la razón congelada: ${base.toFixed(3)} -> ${prevenido.toFixed(3)}`,
    );
});

test('el tope baja el CVaR MÁS que el ALE — justo lo que hace un control de contención', () => {
    const base = summarizeLosses(runMonteCarloSimulation(RIESGO_COLA_GORDA).annualLosses);
    const contenido = summarizeLosses(
        runMonteCarloSimulation({ ...RIESGO_COLA_GORDA, magnitudeCap: 60000 }).annualLosses,
    );
    const caidaALE = 1 - contenido.average / base.average;
    const caidaCVaR = 1 - contenido.cvar95 / base.cvar95;
    assert.ok(
        caidaCVaR > caidaALE,
        `el CVaR debe caer más que el ALE: ALE -${(caidaALE * 100).toFixed(1)}%, CVaR -${(caidaCVaR * 100).toFixed(1)}%`,
    );
});

test('sin tope (o con tope inválido) el resultado es idéntico bit a bit al de siempre', () => {
    const sinTope = runMonteCarloSimulation(RIESGO_COLA_GORDA).annualLosses;
    // "Sin contención" se dice OMITIENDO el tope. Un 0 no significa "ningún evento cuesta nada".
    [undefined, null, 0, -100, NaN].forEach((cap) => {
        const conCap = runMonteCarloSimulation({ ...RIESGO_COLA_GORDA, magnitudeCap: cap }).annualLosses;
        assert.deepStrictEqual(conCap, sinTope, `magnitudeCap=${cap} no debería cambiar nada`);
    });
});

test('un tope por encima del peor escenario no cambia nada; uno muy bajo aplana casi toda la cola', () => {
    const base = runMonteCarloSimulation(RIESGO_COLA_GORDA);
    const peorMagnitud = Math.max(...base.magnitudeSamples);
    const inocuo = runMonteCarloSimulation({ ...RIESGO_COLA_GORDA, magnitudeCap: peorMagnitud * 2 });
    assert.deepStrictEqual(inocuo.annualLosses, base.annualLosses);

    const duro = summarizeLosses(runMonteCarloSimulation({ ...RIESGO_COLA_GORDA, magnitudeCap: 10000 }).annualLosses);
    assert.ok(duro.cvar95 < summarizeLosses(base.annualLosses).cvar95 / 3);
});

// --- Punto residual en la Matriz (destino de la flecha de migración) -----------------------

const CRITERIOS = { aleCritico: 100000, aleUmbralExcedencia: 50000 };
// Curva descendente: pérdidas chicas son muy probables, pérdidas grandes muy improbables.
const CURVA = [
    { loss: 10000, probability: 90 },
    { loss: 50000, probability: 40 },
    { loss: 100000, probability: 10 },
    { loss: 200000, probability: 1 },
];

test('exceedanceProbabilityAt: interpola entre los puntos guardados de la curva', () => {
    assert.strictEqual(exceedanceProbabilityAt(CURVA, 50000), 40);
    // Justo a la mitad entre 50k (40%) y 100k (10%).
    assert.strictEqual(exceedanceProbabilityAt(CURVA, 75000), 25);
    // Más allá del último punto: la probabilidad real es MENOR, pero la curva no dice cuánto —
    // se devuelve esa última como cota superior, que nunca subestima.
    assert.strictEqual(exceedanceProbabilityAt(CURVA, 999999), 1);
    assert.strictEqual(exceedanceProbabilityAt([], 50000), null);
});

test('calculateResidualMatrixPoint: Mitigar mueve el punto a la izquierda Y hacia abajo', () => {
    const risk = {
        ale: 40000,
        probabilityPercent: 40,
        lossExceedanceCurve: CURVA,
        treatmentDecision: { strategy: 'mitigar', residualALE: 20000 }, // k = 0.5
    };
    const punto = calculateResidualMatrixPoint(risk, CRITERIOS);
    assert.strictEqual(punto.k, 0.5);
    // X: 20000/100000 = 20%
    assert.strictEqual(punto.impactPercent, 20);
    // Y: P(residual > 50k) = P(actual > 100k) = 10%, leído sobre la curva guardada.
    assert.strictEqual(punto.probabilityPercent, 10);
    // Migra hacia la zona buena en los DOS ejes, que es justo lo que la flecha debe mostrar.
    assert.ok(punto.probabilityPercent < risk.probabilityPercent);
});

test('calculateResidualMatrixPoint: Evitar lleva el punto al origen', () => {
    const punto = calculateResidualMatrixPoint(
        {
            ale: 40000,
            probabilityPercent: 40,
            lossExceedanceCurve: CURVA,
            treatmentDecision: { strategy: 'evitar', residualALE: 0 },
        },
        CRITERIOS,
    );
    assert.strictEqual(punto.impactPercent, 0);
    assert.strictEqual(punto.probabilityPercent, 0);
});

test('calculateResidualMatrixPoint: Aceptar cae EXACTAMENTE sobre el punto actual', () => {
    // Sin esto, un error de interpolación dejaría el punto verde a un pixel del rojo y parecería
    // que aceptar movió algo. Aceptar es una decisión documentada que no cambia la exposición.
    const risk = {
        ale: 40000,
        probabilityPercent: 37.5,
        lossExceedanceCurve: CURVA,
        treatmentDecision: { strategy: 'aceptar', residualALE: 40000 },
    };
    const punto = calculateResidualMatrixPoint(risk, CRITERIOS);
    assert.strictEqual(punto.k, 1);
    assert.strictEqual(punto.probabilityPercent, 37.5);
    assert.strictEqual(punto.impactPercent, 40);
});

test('calculateResidualMatrixPoint: sin punto verde cuando no hay uno honesto que dibujar', () => {
    const base = { ale: 40000, probabilityPercent: 40, lossExceedanceCurve: CURVA };
    // Sin decisión adoptada: no hay residual.
    assert.strictEqual(calculateResidualMatrixPoint({ ...base }, CRITERIOS), null);
    // Transferir: hay X (residualALE) pero NO Y — la póliza trunca la cola, no la escala. Mover
    // solo X afirmaría que la probabilidad de excedencia no cambió, justo lo falso.
    assert.strictEqual(
        calculateResidualMatrixPoint(
            { ...base, treatmentDecision: { strategy: 'transferir', residualALE: 10000 } },
            CRITERIOS,
        ),
        null,
    );
    // Riesgo guardado antes de que se persistiera la curva: no hay de dónde leer la Y.
    assert.strictEqual(
        calculateResidualMatrixPoint(
            { ale: 40000, probabilityPercent: 40, treatmentDecision: { strategy: 'mitigar', residualALE: 20000 } },
            CRITERIOS,
        ),
        null,
    );
});

test('calculateResidualMatrixPoint: usa el override de criterios del riesgo, no los globales', () => {
    const risk = {
        ale: 40000,
        probabilityPercent: 40,
        lossExceedanceCurve: CURVA,
        treatmentDecision: { strategy: 'mitigar', residualALE: 20000 },
    };
    // Con un ALE Crítico propio más chico, el MISMO residual pesa el doble en el eje de impacto.
    const punto = calculateResidualMatrixPoint(risk, { ...CRITERIOS, aleCritico: 50000 });
    assert.strictEqual(punto.impactPercent, 40);
});

// --- Portafolio RESIDUAL (después del Tratamiento adoptado) --------------------------------

test('residualScaleFactor: k sale de residualALE/ale, sin casos especiales por estrategia', () => {
    const base = { ale: 1000 };
    // Sin decisión adoptada: el riesgo entra tal cual.
    assert.strictEqual(residualScaleFactor({ ...base }), 1);
    // Mitigar al 60% de reducción deja el 40%.
    assert.strictEqual(
        residualScaleFactor({ ...base, treatmentDecision: { strategy: 'mitigar', residualALE: 400 } }),
        0.4,
    );
    // Evitar elimina el riesgo: k = 0.
    assert.strictEqual(residualScaleFactor({ ...base, treatmentDecision: { strategy: 'evitar', residualALE: 0 } }), 0);
    // Aceptar es una decisión documentada que NO cambia la exposición: k = 1.
    assert.strictEqual(
        residualScaleFactor({ ...base, treatmentDecision: { strategy: 'aceptar', residualALE: 1000 } }),
        1,
    );
    // Transferir NO se escala: el deducible/límite trunca la cola, no la escala. Se simula sin
    // tratamiento (conservador), en vez de inventar un factor que no representa la póliza.
    assert.strictEqual(
        residualScaleFactor({ ...base, treatmentDecision: { strategy: 'transferir', residualALE: 200 } }),
        1,
    );
});

// Decisiones HEREDADAS: adoptadas antes de que existiera la receta (`residualInputs`). El
// portafolio las reconstruye escalando, y eso sobreestima su cola hasta el triple. Antes el
// respaldo ocurría en silencio; ahora se reportan para poder decirlo en la interfaz.
//
// Lo que este test protege no es que la lista exista, sino que sea PRECISA: marcar de más sería
// alarmar sin motivo, y las otras tres estrategias no tienen el problema.
test('simulateResidualPortfolio: legacyResidualRiskNames marca SOLO las mitigaciones sin receta', () => {
    const decision = (strategy, residualALE, residualInputs) => ({
        strategy,
        residualALE,
        decidedAt: '2026-01-01T00:00:00Z',
        ...(residualInputs ? { residualInputs } : {}),
    });
    const riesgos = [
        // El caso: mitigar sin receta. El escalado reconstruye una contención como prevención.
        makePortfolioRisk('Mitigado sin receta', { ale: 10000, treatmentDecision: decision('mitigar', 4000) }),
        // Con receta NO se marca: se re-simula con el Nivel de Defensa objetivo, no se escala.
        makePortfolioRisk('Mitigado con receta', {
            ale: 10000,
            treatmentDecision: decision('mitigar', 4000, { targetDefenseKey: 'avanzada' }),
        }),
        // Aceptar da k = 1 exacto y Evitar da k = 0 exacto: el escalado NO es una aproximación ahí,
        // así que marcarlos sería ruido.
        makePortfolioRisk('Aceptado', { ale: 10000, treatmentDecision: decision('aceptar', 10000) }),
        makePortfolioRisk('Evitado', { ale: 10000, treatmentDecision: decision('evitar', 0) }),
        // Transferir ya se reporta aparte, por otra razón (su cola se trunca, no se escala).
        makePortfolioRisk('Transferido', { ale: 10000, treatmentDecision: decision('transferir', 6000) }),
        // Sin decisión no hay nada que reconstruir.
        makePortfolioRisk('Sin tratar'),
    ];
    const r = simulateResidualPortfolio(riesgos);
    assert.deepStrictEqual(r.legacyResidualRiskNames, ['Mitigado sin receta']);
    assert.deepStrictEqual(r.nonScalableRiskNames, ['Transferido']);
});

test('simulateResidualPortfolio: legacyResidualRiskNames es una lista vacía cuando no hay nada heredado', () => {
    const r = simulateResidualPortfolio([makePortfolioRisk('Limpio')]);
    assert.deepStrictEqual(r.legacyResidualRiskNames, []);
});

test('simulateResidualPortfolio: escalar la Vulnerabilidad por k escala el ALE del portafolio por k', () => {
    const risks = [1, 2, 3].map((i) =>
        makePortfolioRisk(`R${i}`, {
            ale: 1000,
            treatmentDecision: { strategy: 'mitigar', residualALE: 250 }, // k = 0.25
        }),
    );
    const actual = simulatePortfolio(risks);
    const residual = simulateResidualPortfolio(risks);

    // El ALE sí escala por k: la pérdida esperada es proporcional a la Vulnerabilidad en cualquiera
    // de los dos modelos de frecuencia. La tolerancia es de muestreo, no de sesgo — verificado
    // promediando 25 semillas, la razón converge a 0,2497 contra el 0,2500 teórico. Con el modelo
    // compuesto la varianza del estimador sube (menos eventos, más grandes), así que una sola
    // corrida se desvía más que con el modelo anterior, donde esto era exacto término a término.
    assert.ok(
        Math.abs(residual.summary.average - actual.summary.average * 0.25) < actual.summary.average * 0.03,
        `ALE residual ${residual.summary.average} debería ser ~0.25x del actual ${actual.summary.average}`,
    );
    // La COLA, en cambio, NO escala por k — y ésa es la corrección de la calibración 5. Bajar la
    // Vulnerabilidad reduce la cantidad de eventos, no lo que cuesta cada uno: hace los malos años
    // más raros, no menos malos. Antes esta misma línea afirmaba lo contrario, con 0,1% de holgura.
    assert.ok(
        residual.summary.cvar95 > actual.summary.cvar95 * 0.25,
        `la cola residual ${residual.summary.cvar95.toFixed(0)} no debería bajar tanto como la media (${(actual.summary.cvar95 * 0.25).toFixed(0)})`,
    );
    assert.ok(residual.summary.cvar95 < actual.summary.cvar95, 'pero el tratamiento sí debe ayudar');
    assert.strictEqual(residual.treatedCount, 3);
});

test('simulateResidualPortfolio: misma semilla que la corrida actual — el ahorro es exacto, no ruido', () => {
    // Sin ningún tratamiento adoptado, las dos corridas deben dar EXACTAMENTE lo mismo. Si usaran
    // semillas distintas, diferirían por ruido de muestreo y el "ahorro" nunca sería cero limpio.
    const risks = [1, 2, 3].map((i) => makePortfolioRisk(`S${i}`));
    const actual = simulatePortfolio(risks);
    const residual = simulateResidualPortfolio(risks);
    assert.strictEqual(residual.summary.average, actual.summary.average);
    assert.strictEqual(residual.summary.cvar95, actual.summary.cvar95);
    assert.strictEqual(residual.summary.p90, actual.summary.p90);
    assert.strictEqual(residual.treatedCount, 0);
});

test('simulateResidualPortfolio: un riesgo Transferido entra SIN escalar y se reporta aparte', () => {
    const risks = [
        makePortfolioRisk('Mitigado', { ale: 1000, treatmentDecision: { strategy: 'mitigar', residualALE: 100 } }),
        makePortfolioRisk('Asegurado', { ale: 1000, treatmentDecision: { strategy: 'transferir', residualALE: 100 } }),
    ];
    const residual = simulateResidualPortfolio(risks);
    assert.deepStrictEqual(residual.nonScalableRiskNames, ['Asegurado']);
    assert.strictEqual(residual.treatedCount, 2);

    // El asegurado aporta lo mismo que si no se hubiera tratado: la cola conjunta residual no
    // puede bajar tanto como si los dos se hubieran podido escalar.
    const soloMitigado = simulateResidualPortfolio([risks[0]]);
    assert.ok(residual.summary.average > soloMitigado.summary.average);
});

test('simulateResidualPortfolio: Evitar saca al riesgo de la cola conjunta', () => {
    const risks = [
        makePortfolioRisk('Queda'),
        makePortfolioRisk('Evitado', { ale: 1000, treatmentDecision: { strategy: 'evitar', residualALE: 0 } }),
    ];
    const residual = simulateResidualPortfolio(risks);
    const soloElQueQueda = simulatePortfolio([makePortfolioRisk('Queda')]);
    assert.ok(
        Math.abs(residual.summary.average - soloElQueQueda.summary.average) < soloElQueQueda.summary.average * 0.001,
        'un riesgo evitado no debe aportar nada al portafolio residual',
    );
});

test('simulateResidualPortfolio: el escalado también aplica a los riesgos con Perfil de Atacante/Defensa', () => {
    // Sin esto, el tratamiento no tendría NINGÚN efecto sobre los riesgos con perfiles — que son
    // la mayoría — porque su Vulnerabilidad no sale del triángulo sino del sampler calibrado.
    const conPerfiles = (name, decision) =>
        makePortfolioRisk(name, {
            vulnManualOverride: false,
            attackerKey: 'organizado',
            defenseKey: 'basica',
            dataConfidence: 'medio',
            ale: 1000,
            ...(decision ? { treatmentDecision: decision } : {}),
        });
    const sinTratar = simulatePortfolio([conPerfiles('X')]);
    const tratado = simulateResidualPortfolio([conPerfiles('X', { strategy: 'mitigar', residualALE: 500 })]);
    // Tolerancia de muestreo (ver la nota del test anterior): con el modelo compuesto el estimador
    // de la media tiene más varianza, y acá hay UN solo riesgo, así que la holgura es mayor.
    assert.ok(
        Math.abs(tratado.summary.average - sinTratar.summary.average * 0.5) < sinTratar.summary.average * 0.05,
        `con perfiles, k=0.5 debería dar ~la mitad: ${tratado.summary.average} vs ${sinTratar.summary.average}`,
    );
});

test('simulatePortfolio: el CVaR95 conjunto es SUBADITIVO — nunca supera la suma de los individuales', () => {
    // CVaR es una medida coherente: CVaR(X+Y) <= CVaR(X) + CVaR(Y). Sumar los individuales
    // sobrestima la cola salvo que todos los riesgos se materialicen el mismo año.
    for (const n of [2, 5, 20]) {
        const risks = Array.from({ length: n }, (_, i) => makePortfolioRisk(`P${i}`));
        const r = simulatePortfolio(risks);
        assert.ok(
            r.summary.cvar95 <= r.sumOfIndividualCVaR,
            `n=${n}: conjunto ${r.summary.cvar95.toFixed(0)} > suma ${r.sumOfIndividualCVaR.toFixed(0)}`,
        );
        assert.ok(r.diversificationBenefit >= 0, `n=${n}: el beneficio de diversificación no puede ser negativo`);
    }
});

test('simulatePortfolio: el beneficio de diversificación CRECE al agregar riesgos independientes', () => {
    // Este es el efecto que el método anterior hacía invisible: 20 riesgos independientes no tienen
    // una cola 20 veces más gorda que uno solo.
    const frac = (n) => {
        const r = simulatePortfolio(Array.from({ length: n }, (_, i) => makePortfolioRisk(`P${i}`)));
        return r.diversificationBenefit / r.sumOfIndividualCVaR;
    };
    const dos = frac(2);
    const veinte = frac(20);
    assert.ok(
        veinte > dos,
        `20 riesgos (${(veinte * 100).toFixed(1)}%) debería diversificar más que 2 (${(dos * 100).toFixed(1)}%)`,
    );
});

test('simulatePortfolio: un solo riesgo no diversifica nada — conjunto e individual coinciden', () => {
    const r = simulatePortfolio([makePortfolioRisk('Solo')]);
    assert.strictEqual(r.summary.cvar95, r.sumOfIndividualCVaR);
    assert.strictEqual(r.diversificationBenefit, 0);
});

test('simulatePortfolio: es reproducible — misma entrada, mismo resultado exacto', () => {
    // Una cifra de portafolio que baila sin que cambien los datos es imposible de auditar.
    const risks = [makePortfolioRisk('A'), makePortfolioRisk('B')];
    assert.strictEqual(simulatePortfolio(risks).summary.cvar95, simulatePortfolio(risks).summary.cvar95);
});

test('simulatePortfolio: excluye oportunidades y riesgos sin insumos, y los reporta', () => {
    const r = simulatePortfolio([
        makePortfolioRisk('Completo'),
        makePortfolioRisk('Oportunidad', { riskType: 'oportunidad' }),
        { riskName: 'Sin insumos', riskType: 'amenaza', ale: 5000 },
    ]);
    assert.strictEqual(r.includedCount, 1);
    assert.strictEqual(r.skippedCount, 1);
    assert.deepStrictEqual(r.skippedRiskNames, ['Sin insumos']);
});

test('simulatePortfolio: sin ningún riesgo utilizable devuelve summary null en vez de ceros falsos', () => {
    const r = simulatePortfolio([{ riskName: 'Vacío', riskType: 'amenaza' }]);
    assert.strictEqual(r.summary, null);
    assert.strictEqual(r.includedCount, 0);
    assert.deepStrictEqual(r.lossExceedanceCurve, []);
});

test('simulatePortfolio: la curva de excedencia del portafolio es monótona decreciente en pérdida', () => {
    const r = simulatePortfolio([makePortfolioRisk('A'), makePortfolioRisk('B'), makePortfolioRisk('C')]);
    assert.ok(r.lossExceedanceCurve.length > 0);
    for (let i = 1; i < r.lossExceedanceCurve.length; i++) {
        assert.ok(
            r.lossExceedanceCurve[i].loss >= r.lossExceedanceCurve[i - 1].loss,
            'menos probabilidad de excedencia debe corresponder a más pérdida',
        );
    }
});

// --- Correlación por cascada dentro del portafolio -------------------------------------------
// El Árbol de Riesgos en Cascada es la ÚNICA fuente de correlación del portafolio: sale del
// criterio del usuario (qué riesgo dispara a cuál y con qué probabilidad), no de un supuesto
// estadístico nuestro.
// Familia en cascada de riesgos RAROS. El régimen importa: medido sobre el motor, el efecto de
// declarar una cascada sobre la cola del portafolio va de +18% con LEF~0,05 a prácticamente cero
// con LEF~3. Tiene sentido — con eventos frecuentes, un año ya trae muchas ocurrencias de cada
// riesgo y hacer que algunas coincidan con el padre cambia poco; con eventos raros, que el año malo
// sea compartido o no ES toda la pregunta. Por eso los tests de correlación usan este fixture y no
// el genérico (LEF~0,87, justo en el punto de cruce donde el efecto se anula).
function makeRareCascadeFamily() {
    const raro = (riskName, overrides = {}) =>
        makePortfolioRisk(riskName, { tef: { min: 0.02, mode: 0.05, max: 0.1 }, ...overrides });
    return [
        raro('RA'),
        raro('RB', { triggeredBy: [{ riskName: 'RA', probability: 70 }] }),
        raro('RC', { triggeredBy: [{ riskName: 'RA', probability: 60 }] }),
        raro('RD', { triggeredBy: [{ riskName: 'RB', probability: 50 }] }),
        raro('RE'),
    ];
}

function makeCascadeFamilyPortfolio() {
    return [
        makePortfolioRisk('CA'),
        makePortfolioRisk('CB', { triggeredBy: [{ riskName: 'CA', probability: 70 }] }),
        makePortfolioRisk('CC', { triggeredBy: [{ riskName: 'CA', probability: 60 }] }),
        makePortfolioRisk('CD', { triggeredBy: [{ riskName: 'CB', probability: 50 }] }),
        makePortfolioRisk('CE'),
    ];
}

test('simulatePortfolio: SIN dependencias declaradas da exactamente los mismos números que antes', () => {
    // Invariante que protege toda evaluación ya existente: conectar la cascada no puede reescribir
    // en silencio un portafolio que nunca declaró dependencias.
    const risks = [1, 2, 3, 4, 5].map((i) => makePortfolioRisk(`N${i}`));
    const conCampoVacio = risks.map((r) => ({ ...r, triggeredBy: [] }));
    const a = simulatePortfolio(risks);
    const b = simulatePortfolio(conCampoVacio);
    assert.strictEqual(a.summary.cvar95, b.summary.cvar95);
    assert.strictEqual(a.summary.average, b.summary.average);
    assert.strictEqual(a.cascadeEdgeCount, 0);
    assert.strictEqual(a.cascadeInducedALE, 0);
    assert.deepStrictEqual(a.overCoupledRiskNames, []);
});

test('simulatePortfolio: la correlación declarada ENGORDA la cola conjunta', () => {
    // Es el efecto que la independencia no podía capturar: cuando un padre arrastra a sus hijos,
    // los tres caen el MISMO año, y esa co-ocurrencia es justo lo que hace la cola más pesada.
    // Los MISMOS riesgos con y sin aristas — comparar contra otro portafolio distinto mediría
    // también la diferencia entre los dos conjuntos de riesgos, no solo el efecto de la cascada.
    const con = simulatePortfolio(makeRareCascadeFamily());
    const sin = simulatePortfolio(makeRareCascadeFamily().map((r) => ({ ...r, triggeredBy: [] })));
    assert.ok(
        con.summary.cvar95 > sin.summary.cvar95,
        `con cascada ${con.summary.cvar95.toFixed(0)} debería superar a sin cascada ${sin.summary.cvar95.toFixed(0)}`,
    );
    assert.strictEqual(con.cascadeEdgeCount, 3);
    // La cascada REUBICA pérdida esperada (de espontánea a inducida por un padre); no la crea.
    assert.ok(con.cascadeInducedALE > 0, 'la cascada debe reubicar pérdida esperada hacia los padres');
});

test('simulatePortfolio: declarar la cascada NO cambia el ALE del portafolio — solo su cola', () => {
    // El corazón de la corrección del doble conteo. El TEF capturado es la frecuencia PROPIA del
    // riesgo, estimada de datos de incidentes que YA incluyen las veces que ocurrió porque ocurrió
    // el padre. Sumar la cascada encima contaba esas veces dos veces e inflaba el ALE.
    //
    // Ahora la cascada EXPLICA parte de las ocurrencias que el hijo ya tenía en vez de añadirlas:
    // el total esperado de cada riesgo queda igual al declarado (su ALE individual no se mueve, el
    // Registro no cambia), pero esas ocurrencias caen el MISMO año que las del padre.
    const conCascada = simulatePortfolio(makeRareCascadeFamily());
    const sinAristas = simulatePortfolio(makeRareCascadeFamily().map((r) => ({ ...r, triggeredBy: [] })));

    // La holgura es de muestreo: esta familia es de riesgos RAROS (ver makeRareCascadeFamily), y ahí
    // el promedio de 10.000 años lo dominan unos pocos años con evento, así que baila más.
    const desvio = Math.abs(conCascada.summary.average / sinAristas.summary.average - 1);
    assert.ok(
        desvio < 0.05,
        `declarar la cascada no debe mover el ALE: ${sinAristas.summary.average.toFixed(0)} -> ${conCascada.summary.average.toFixed(0)} (${(desvio * 100).toFixed(1)}%)`,
    );
    // Pero la cola SÍ sube: los riesgos encadenados caen juntos.
    assert.ok(conCascada.summary.cvar95 > sinAristas.summary.cvar95);
});

test('simulatePortfolio: avisa cuando los padres declarados inducen más eventos de los que el hijo tiene', () => {
    // Contradicción real en los datos: dijiste que este hijo ocurre muy poco, pero también que
    // tiene un padre frecuente que lo causa casi siempre. Antes se sumaba en silencio e inflaba el
    // portafolio; ahora su parte espontánea se acota a cero y se reporta para poder revisarlo.
    const risks = [
        makePortfolioRisk('Padre frecuente', { tef: { min: 8, mode: 10, max: 12 } }),
        makePortfolioRisk('Hijo rarisimo', {
            tef: { min: 0.01, mode: 0.02, max: 0.03 },
            triggeredBy: [{ riskName: 'Padre frecuente', probability: 90 }],
        }),
    ];
    assert.deepStrictEqual(simulatePortfolio(risks).overCoupledRiskNames, ['Hijo rarisimo']);
});

test('simulatePortfolio: diversificación y correlación se miden POR SEPARADO, no revueltas', () => {
    // Van en direcciones opuestas —diversificar baja la cola, correlacionar la sube— así que una
    // sola resta contra la suma no mide ninguna de las dos. Bug real: con cascada declarada, el
    // "beneficio de diversificación" salía artificialmente bajo porque le habían restado la
    // correlación sin decirlo.
    const con = simulatePortfolio(makeRareCascadeFamily());
    const sin = simulatePortfolio(makeRareCascadeFamily().map((r) => ({ ...r, triggeredBy: [] })));

    // La diversificación NO depende de que haya cascada: es el mismo portafolio independiente.
    assert.ok(
        Math.abs(con.diversificationBenefit - sin.diversificationBenefit) / sin.diversificationBenefit < 0.01,
        `la diversificación no debería cambiar por declarar dependencias: ${con.diversificationBenefit.toFixed(0)} vs ${sin.diversificationBenefit.toFixed(0)}`,
    );
    // La correlación es un efecto aparte, y solo existe si hay aristas.
    assert.strictEqual(sin.correlationPenalty, 0);
    assert.ok(con.correlationPenalty > 0, 'con aristas declaradas la correlación debe engordar la cola');
});

test('simulatePortfolio: la descomposición cuadra exactamente', () => {
    // suma - diversificación + correlación = conjunto final. Si no cuadra, alguno de los tres
    // números está midiendo algo distinto de lo que dice su nombre.
    const r = simulatePortfolio(makeCascadeFamilyPortfolio());
    const reconstruido = r.sumOfIndividualCVaR - r.diversificationBenefit + r.correlationPenalty;
    assert.ok(
        Math.abs(reconstruido - r.summary.cvar95) < 0.01,
        `${reconstruido.toFixed(2)} != ${r.summary.cvar95.toFixed(2)}`,
    );
});

test('simulatePortfolio: una arista hacia un riesgo ausente del portafolio se ignora sin romper', () => {
    // Vínculo por nombre y tolerante a roto, mismo criterio que el resto del Árbol de Cascada.
    const r = simulatePortfolio([
        makePortfolioRisk('X', { triggeredBy: [{ riskName: 'No existe', probability: 80 }] }),
    ]);
    assert.strictEqual(r.cascadeEdgeCount, 0);
    assert.ok(r.summary.average > 0);
});

test('simulatePortfolio: sigue siendo reproducible con cascada declarada', () => {
    const risks = makeCascadeFamilyPortfolio();
    assert.strictEqual(simulatePortfolio(risks).summary.cvar95, simulatePortfolio(risks).summary.cvar95);
});

// --- Sensibilidad por rangos y error estándar --------------------------------------------------
test('spearmanCorrelation: capta una relación monótona NO lineal que Pearson subestima', () => {
    // El caso real del modelo: Tullock con m=6,83 es muy convexo y la magnitud es lognormal con
    // cola pesada, así que Pearson (que solo mide relación lineal) aplastaba el peso aparente de
    // la Frecuencia y la Vulnerabilidad a la mitad.
    const x = [];
    const y = [];
    for (let i = 1; i <= 500; i++) {
        x.push(i);
        y.push(Math.pow(i, 7)); // monótona perfecta, brutalmente no lineal
    }
    assert.ok(Math.abs(spearmanCorrelation(x, y) - 1) < 1e-9, 'Spearman debe dar 1 en una monótona perfecta');
    assert.ok(pearsonCorrelation(x, y) < 0.9, 'Pearson se queda corto en la misma relación');
});

test('spearmanCorrelation: promedia los rangos en los empates', () => {
    // Sin promediar, valores idénticos recibirían rangos arbitrarios según el orden de llegada y
    // la correlación dependería del muestreo en vez de los datos.
    const conEmpates = [5, 5, 5, 1, 9];
    const otro = [1, 2, 3, 4, 5];
    assert.strictEqual(spearmanCorrelation(conEmpates, otro), spearmanCorrelation([...conEmpates], [...otro]));
    assert.ok(Number.isFinite(spearmanCorrelation(conEmpates, otro)));
});

test('summarizeLosses: el error estándar decrece como 1/raíz(N)', () => {
    // Es el número que dice si 10.000 iteraciones alcanzan. Se REPORTA, no se usa para parar: la
    // semilla es fija a propósito para que el resultado sea reproducible y auditable.
    const correr = (n) =>
        summarizeLosses(
            runMonteCarloSimulation({
                iterations: n,
                seed: 42,
                tef: { min: 1, mode: 2, max: 4 },
                vuln: { min: 10, mode: 30, max: 70 },
                lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
            }).annualLosses,
        );
    const mil = correr(1000).standardErrorPercent;
    const diezMil = correr(10000).standardErrorPercent;
    assert.ok(diezMil < mil, `${diezMil} debería ser menor que ${mil}`);
    // 10x más iteraciones => ~raíz(10) ≈ 3,16x menos error. Margen amplio por el ruido del muestreo.
    const ratio = mil / diezMil;
    assert.ok(ratio > 2 && ratio < 5, `esperaba una razón cercana a 3,16, dio ${ratio.toFixed(2)}`);
});

test('summarizeLosses: un portafolio sin pérdida no divide por cero al calcular el error relativo', () => {
    const s = summarizeLosses([0, 0, 0, 0]);
    assert.strictEqual(s.standardErrorPercent, 0);
    assert.ok(Number.isFinite(s.standardError));
});

// --- Modelo compuesto de frecuencia (N ~ Poisson(LEF), suma de N magnitudes) ------------------

// Raro y severo: una vez cada ~20 años, pero cuando pasa duele. Es el régimen donde el modelo
// 'expected' (repartir una fracción de evento en todos los años) miente más sobre la forma.
const RIESGO_RARO_SEVERO = {
    iterations: 10000,
    seed: 777,
    tef: { min: 0.05, mode: 0.1, max: 0.3 },
    vuln: { min: 20, mode: 40, max: 70 },
    lossMagnitudes: {
        productividad: { min: 1000, mode: 5000, max: 20000 },
        respuesta: { min: 5000, mode: 50000, max: 400000 },
    },
};

// Frecuente y menor: varias veces al año, poco dinero cada vez. El régimen opuesto — y ahí el
// modelo compuesto BAJA la cola en vez de subirla (ver el test correspondiente más abajo).
const RIESGO_FRECUENTE_MENOR = {
    iterations: 10000,
    seed: 777,
    tef: { min: 20, mode: 40, max: 60 },
    vuln: { min: 40, mode: 50, max: 60 },
    lossMagnitudes: { productividad: { min: 100, mode: 500, max: 2000 } },
};

test('getPoissonRandom: la media y la varianza muestrales convergen a lambda (las dos, que es lo que define a Poisson)', () => {
    const rng = mulberry32(31337);
    const lambda = 3.5;
    const n = 200000;
    let suma = 0;
    const muestras = new Array(n);
    for (let i = 0; i < n; i++) {
        muestras[i] = getPoissonRandom(lambda, rng);
        suma += muestras[i];
    }
    const media = suma / n;
    const varianza = muestras.reduce((acc, v) => acc + (v - media) * (v - media), 0) / (n - 1);
    assert.ok(Math.abs(media - lambda) < 0.03, `media ${media.toFixed(3)} debería estar cerca de ${lambda}`);
    assert.ok(Math.abs(varianza - lambda) < 0.06, `varianza ${varianza.toFixed(3)} debería estar cerca de ${lambda}`);
    assert.ok(
        muestras.every((v) => Number.isInteger(v) && v >= 0),
        'toda muestra debe ser un entero >= 0',
    );
});

test('getPoissonRandom: lambda 0 o negativo devuelve 0 sin consumir el rng (no es un error, es "nunca pasa")', () => {
    let llamadas = 0;
    const rng = () => {
        llamadas++;
        return 0.5;
    };
    assert.strictEqual(getPoissonRandom(0, rng), 0);
    assert.strictEqual(getPoissonRandom(-1, rng), 0);
    assert.strictEqual(llamadas, 0);
});

test('magnitudeParams + sampleMagnitude dan exactamente lo mismo que getLognormalRandom (la separación es solo de rendimiento)', () => {
    const casos = [
        [1000, 5000, 20000], // lognormal
        [0, 0, 20000], // moda en 0 -> respaldo triangular
        [7000, 7000, 7000], // sin varianza -> constante
    ];
    casos.forEach(([min, mode, max]) => {
        const rngA = mulberry32(99);
        const rngB = mulberry32(99);
        const params = magnitudeParams(min, mode, max);
        for (let i = 0; i < 50; i++) {
            assert.strictEqual(
                sampleMagnitude(params, rngA),
                getLognormalRandom(min, mode, max, rngB),
                `min=${min} mode=${mode} max=${max}`,
            );
        }
    });
});

test('frequencyModel: el default es el modelo COMPUESTO (calibración 5)', () => {
    const sinPedir = runMonteCarloSimulation(RIESGO_RARO_SEVERO);
    const explicito = runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, frequencyModel: 'compound' });
    assert.deepStrictEqual(sinPedir.annualLosses, explicito.annualLosses);
    assert.strictEqual(sinPedir.frequencyModel, 'compound');

    // eventCounts solo existe en el compuesto: con el modelo de valor esperado la pregunta
    // "¿cuántos eventos hubo?" no tiene respuesta, porque reparte una fracción en todos los años.
    const anterior = runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, frequencyModel: 'expected' });
    assert.strictEqual(anterior.eventCounts, null);
    assert.strictEqual(anterior.frequencyModel, 'expected');
});

test('frequencyModel: por encima de MAX_COMPOUND_TEF el compuesto cae solo al de valor esperado, sin error', () => {
    // Un riesgo muy frecuente es un riesgo válido y corriente, no una petición mal formada: a esa
    // frecuencia los dos modelos ya coinciden y el compuesto solo costaría tiempo (sortea una
    // magnitud por evento). Cae solo, y el modelo realmente usado viaja de vuelta.
    const muyFrecuente = {
        ...RIESGO_RARO_SEVERO,
        tef: { min: MAX_COMPOUND_TEF + 100, mode: MAX_COMPOUND_TEF + 200, max: MAX_COMPOUND_TEF + 300 },
    };
    const r = runMonteCarloSimulation({ ...muyFrecuente, frequencyModel: 'compound' });
    assert.strictEqual(r.frequencyModel, 'expected');
    assert.strictEqual(r.eventCounts, null);
    assert.deepStrictEqual(
        r.annualLosses,
        runMonteCarloSimulation({ ...muyFrecuente, frequencyModel: 'expected' }).annualLosses,
    );
});

test('frequencyModel compound: es reproducible con la misma semilla', () => {
    const params = { ...RIESGO_RARO_SEVERO, frequencyModel: 'compound' };
    assert.deepStrictEqual(runMonteCarloSimulation(params).annualLosses, runMonteCarloSimulation(params).annualLosses);
});

test('frequencyModel compound: el ALE se conserva — los dos modelos tienen la MISMA media por construcción', () => {
    // Con 95% de años en cero, una sola corrida trae mucho ruido de muestreo: el promedio de la
    // media sobre varias semillas es lo que muestra que no hay sesgo, no que dé igual corrida a
    // corrida. Este test es la garantía de que cambiar de modelo NO reabre las ocho anclas de
    // calibración: el número con el que se decide el apetito de riesgo sigue siendo el mismo.
    let sumaExpected = 0;
    let sumaCompound = 0;
    for (let seed = 1; seed <= 40; seed++) {
        sumaExpected += summarizeLosses(runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, seed }).annualLosses).average;
        sumaCompound += summarizeLosses(
            runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, seed, frequencyModel: 'compound' }).annualLosses,
        ).average;
    }
    const desvio = Math.abs(sumaCompound / sumaExpected - 1);
    assert.ok(desvio < 0.03, `el ALE promedio se desvió ${(desvio * 100).toFixed(2)}%, esperaba menos de 3%`);
});

test('frequencyModel compound: aparecen los años en cero (y el modelo actual no los tiene nunca)', () => {
    const actual = runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, frequencyModel: 'expected' });
    const compuesto = runMonteCarloSimulation(RIESGO_RARO_SEVERO);

    assert.ok(
        actual.annualLosses.every((l) => l > 0),
        'el modelo actual reparte una fracción de evento en TODOS los años: ninguno sale en cero',
    );

    const enCero = compuesto.annualLosses.filter((l) => l === 0).length;
    // 1 − e^(−LEF) con LEF ~0,045 da ~4,4% de años CON evento, o sea ~95% en cero.
    assert.ok(
        enCero / compuesto.annualLosses.length > 0.9,
        `esperaba más de 90% de años sin pérdida, dio ${((enCero / compuesto.annualLosses.length) * 100).toFixed(1)}%`,
    );
    // Un año vale cero exactamente cuando no ocurrió ningún evento — no por redondeo.
    compuesto.annualLosses.forEach((loss, i) => {
        assert.strictEqual(loss === 0, compuesto.eventCounts[i] === 0, `iteración ${i}`);
    });
    assert.ok(
        compuesto.eventCounts.some((n) => n >= 2),
        'con 10.000 años debería haber al menos uno con dos eventos encimados',
    );
});

test('frequencyModel compound: SUBE la cola del riesgo raro-severo y la BAJA en el frecuente-menor', () => {
    // Las dos mitades del mismo hallazgo, y por eso van en un solo test: el modelo actual no
    // "subestima el riesgo" en general — deforma la cola en direcciones OPUESTAS según el régimen.
    // Donde los eventos son raros, esconde el año malo (la pérdida llega junta, no repartida);
    // donde son frecuentes, inventa una dispersión que no existe (multiplica la magnitud de UN
    // evento por la frecuencia entera, así que un solo sorteo caro contamina todo el año).
    const cola = (params) => ({
        anterior: summarizeLosses(runMonteCarloSimulation({ ...params, frequencyModel: 'expected' }).annualLosses)
            .cvar95,
        compuesto: summarizeLosses(runMonteCarloSimulation(params).annualLosses).cvar95,
    });
    const colaRaro = cola(RIESGO_RARO_SEVERO);
    const colaFrecuente = cola(RIESGO_FRECUENTE_MENOR);

    assert.ok(
        colaRaro.compuesto > colaRaro.anterior * 2,
        `raro-severo: la cola debería crecer bastante, pasó de ${colaRaro.anterior.toFixed(0)} a ${colaRaro.compuesto.toFixed(0)}`,
    );
    assert.ok(
        colaFrecuente.compuesto < colaFrecuente.anterior,
        `frecuente-menor: la cola debería BAJAR, pasó de ${colaFrecuente.anterior.toFixed(0)} a ${colaFrecuente.compuesto.toFixed(0)}`,
    );
});

test('frequencyModel compound: el tope de daño sigue siendo POR EVENTO, no por año', () => {
    const cap = 30000;
    const compuesto = runMonteCarloSimulation({
        ...RIESGO_RARO_SEVERO,
        frequencyModel: 'compound',
        magnitudeCap: cap,
    });

    compuesto.annualLosses.forEach((loss, i) => {
        const n = compuesto.eventCounts[i];
        // Ningún año puede costar más que N veces el tope...
        assert.ok(loss <= n * cap + 1e-9, `iteración ${i}: ${loss} > ${n} × ${cap}`);
    });
    // ...pero un año CON DOS eventos sí puede pasarse del tope: contener el daño de cada incendio
    // no promete que no haya dos incendios. Esta es justamente la lectura que el modelo actual no
    // puede dar, porque ahí nunca hay "dos eventos".
    const añosDobles = compuesto.annualLosses.filter((loss, i) => compuesto.eventCounts[i] >= 2);
    assert.ok(añosDobles.length > 0, 'el caso de prueba debería producir años con dos eventos');
    assert.ok(
        añosDobles.some((loss) => loss > cap),
        'un año con dos eventos topados debe poder superar el tope de UN evento',
    );
});

test('frequencyModel compound: magnitudeSamples sigue siendo la magnitud de UN evento (lo que necesita la cascada)', () => {
    // cascadeSimulation.js suma magnitudeSamples[i] cuando un padre arrastra a este riesgo — o sea,
    // el costo de UN evento forzado, no el total del año. Debe seguir estando ahí incluso en los
    // años que salieron en cero, donde no ocurrió ningún evento propio.
    const compuesto = runMonteCarloSimulation({ ...RIESGO_RARO_SEVERO, frequencyModel: 'compound' });
    const enCero = compuesto.eventCounts.findIndex((n) => n === 0);
    assert.ok(enCero >= 0, 'el caso de prueba debería producir años sin eventos');
    assert.strictEqual(compuesto.annualLosses[enCero], 0);
    assert.ok(compuesto.magnitudeSamples[enCero] > 0, 'la magnitud representativa debe existir igual');

    // Y en un año de UN evento, el total del año ES esa magnitud.
    const unEvento = compuesto.eventCounts.findIndex((n) => n === 1);
    assert.ok(unEvento >= 0);
    assert.strictEqual(compuesto.annualLosses[unEvento], compuesto.magnitudeSamples[unEvento]);
});

// --- Residual de Mitigar en modo MANUAL: la escala la fija el usuario, la forma la simulación ---

const RIESGO_MANUAL = {
    tef: { min: 0.5, mode: 1, max: 2 },
    vuln: { min: 20, mode: 40, max: 70 },
    lossMagnitudes: { respuesta: { min: 5000, mode: 50000, max: 400000 } },
};
const SEMILLA_MANUAL = 12345;

function simularActual(extra = {}) {
    return summarizeLosses(
        runMonteCarloSimulation({ iterations: 10000, seed: SEMILLA_MANUAL, ...RIESGO_MANUAL, ...extra }).annualLosses,
    );
}

test('calculateResidualFromReduction: el ALE residual es EXACTAMENTE el que el usuario declaró', () => {
    // "Reduce mi pérdida anual un 60%" es una definición, no un estimado. Ver "$39.847" después de
    // teclear 60% se lee como un error de la app, no como precisión.
    const actual = simularActual();
    const res = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: actual.average,
        seed: SEMILLA_MANUAL,
    });
    assert.strictEqual(res.residualALE, actual.average * 0.4);
});

test('calculateResidualFromReduction: la cola baja MENOS que el promedio — prevenir hace los malos años más raros, no menos malos', () => {
    // El hallazgo central de la calibración 5, medido de punta a punta. Un control que corta la
    // pérdida promedio un 60% NO corta el mal año un 60%: reduce la cantidad de eventos, no lo que
    // cuesta cada uno. Suponer proporcionalidad sobreestimaba lo que logra el control.
    const actual = simularActual();
    const res = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: actual.average,
        currentCVaR: actual.cvar95,
        seed: SEMILLA_MANUAL,
    });
    const proporcional = actual.cvar95 * 0.4;
    assert.ok(
        res.residualCVaR > proporcional * 1.1,
        `la cola residual debe superar al escalado proporcional (${proporcional.toFixed(0)}), dio ${res.residualCVaR.toFixed(0)}`,
    );
    // Pero sigue siendo una MEJORA: el control ayuda, solo que menos de lo que se creía.
    assert.ok(res.residualCVaR < actual.cvar95, 'la cola residual debe seguir por debajo de la actual');
});

test('calculateResidualFromReduction: con el modelo ANTERIOR daba exactamente el escalado proporcional', () => {
    // Documenta de dónde venía la cifra que la app mostraba hasta la calibración 4: escalar la
    // Vulnerabilidad multiplicaba cada pérdida simulada por k (en getPertRandom, escalar
    // min/mode/max deja alpha/beta idénticos), así que las dos corridas pareadas tenían la MISMA
    // razón cola/media y el factor de deformación valía 1 exacto.
    const actual = summarizeLosses(
        runMonteCarloSimulation({
            iterations: 10000,
            seed: SEMILLA_MANUAL,
            ...RIESGO_MANUAL,
            frequencyModel: 'expected',
        }).annualLosses,
    );
    const res = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: actual.average,
        currentCVaR: actual.cvar95,
        seed: SEMILLA_MANUAL,
        frequencyModel: 'expected',
    });
    assert.ok(
        Math.abs(res.residualCVaR - actual.cvar95 * 0.4) < 1e-6,
        `esperaba ${actual.cvar95 * 0.4}, dio ${res.residualCVaR}`,
    );
});

test('calculateResidualFromReduction: la cola se ancla al CVaR que el usuario ya ve, no al simulado a secas', () => {
    // Si el ale/cvar95 guardados no cuadran con los inputs guardados (dato viejo, inputs editados
    // sin volver a simular), tomar el CVaR simulado directo haría que ese desajuste apareciera como
    // si fuera efecto del tratamiento. Lo único que se toma de la simulación es el FACTOR de
    // deformación de la cola; la escala la sigue poniendo lo que la pantalla muestra.
    const conCVaRDeclarado = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: 100000, // a propósito, sin relación con lo que darían tef/vuln/lossMagnitudes
        currentCVaR: 250000,
        seed: SEMILLA_MANUAL,
    });
    assert.ok(Math.abs(conCVaRDeclarado.residualALE - 40000) < 1e-6);

    // Duplicar el CVaR declarado debe duplicar el residual: el factor de deformación no depende de
    // la escala, solo de la forma. Si el residual saliera del CVaR simulado a secas, no se movería.
    const conElDoble = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: 100000,
        currentCVaR: 500000,
        seed: SEMILLA_MANUAL,
    });
    assert.ok(
        Math.abs(conElDoble.residualCVaR / conCVaRDeclarado.residualCVaR - 2) < 1e-9,
        `esperaba el doble, dio ${conElDoble.residualCVaR / conCVaRDeclarado.residualCVaR}`,
    );
});

test('calculateResidualFromReduction: devuelve la Curva de Excedencia del residual, a la escala declarada', () => {
    const actual = simularActual();
    const res = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: actual.average,
        seed: SEMILLA_MANUAL,
    });
    assert.strictEqual(res.residualLossExceedanceCurve.length, LEC_EXCEEDANCE_PROBABILITIES.length);
    assert.ok(res.residualLossExceedanceCurve.every((p) => p.loss >= 0 && p.probability >= 0));
});

test('calculateResidualFromReduction: con un tope de daño, la cola YA NO baja en la misma proporción que el promedio', () => {
    // Primera grieta del supuesto proporcional, y existe HOY, sin modelo compuesto de por medio:
    // contener trunca los peores escenarios en vez de escalar toda la distribución.
    const actual = simularActual();
    const res = calculateResidualFromReduction({
        ...RIESGO_MANUAL,
        reductionPercent: 60,
        currentALE: actual.average,
        currentCVaR: actual.cvar95,
        seed: SEMILLA_MANUAL,
        damageCap: 40000,
    });
    assert.strictEqual(res.residualALE, actual.average * 0.4, 'el ALE declarado se respeta igual');
    assert.ok(
        res.residualCVaR < actual.cvar95 * 0.4,
        `con tope, la cola debe quedar por DEBAJO del escalado proporcional (${actual.cvar95 * 0.4}), dio ${res.residualCVaR}`,
    );
});

test('calculateResidualFromReduction: con inputs que no producen pérdida, cae al escalado proporcional en vez de inventar un efecto', () => {
    // Un riesgo cuyas Magnitudes de Pérdida están todas en cero (caso real: el wizard con perfiles
    // por defecto, si nadie tocó el Paso 3) no le da a la simulación nada que medir sobre la forma
    // de la cola. Ahí el factor de deformación debe ser 1 — devolver el ALE, o un 0, afirmaría un
    // efecto del tratamiento que nunca se midió.
    const res = calculateResidualFromReduction({
        tef: { min: 1, mode: 2, max: 3 },
        vuln: { min: 20, mode: 40, max: 70 },
        lossMagnitudes: { respuesta: { min: 0, mode: 0, max: 0 } },
        reductionPercent: 95,
        currentALE: 100000,
        currentCVaR: 200000,
        seed: SEMILLA_MANUAL,
    });
    assert.ok(Math.abs(res.residualALE - 5000) < 1e-6);
    assert.ok(Math.abs(res.residualCVaR - 10000) < 1e-6, `esperaba 10000, dio ${res.residualCVaR}`);
    assert.deepStrictEqual(res.residualLossExceedanceCurve, []);
});

// --- La receta del residual: prevenir y contener dejan de confundirse en el portafolio ---------

const RIESGO_TRATABLE = {
    riskName: 'RT',
    riskType: 'amenaza',
    vulnManualOverride: true,
    tef: { min: 1, mode: 2, max: 4 },
    vuln: { min: 20, mode: 40, max: 60 },
    lossMagnitudes: { respuesta: { min: 5000, mode: 25000, max: 1000000 } },
};

test('residualSpecOf: sin receta cae al escalado de siempre (decisiones adoptadas antes de que existiera)', () => {
    const risk = { ...RIESGO_TRATABLE, ale: 1000, treatmentDecision: { strategy: 'mitigar', residualALE: 250 } };
    assert.deepStrictEqual(residualSpecOf(risk), { scale: 0.25 });
    // Sin decisión, tampoco hay nada que cambiar.
    assert.deepStrictEqual(residualSpecOf({ ...RIESGO_TRATABLE, ale: 1000 }), { scale: 1 });
});

test('residualSpecOf: traduce la receta a las dos palancas por separado', () => {
    const conTope = residualSpecOf({
        ...RIESGO_TRATABLE,
        ale: 1000,
        treatmentDecision: {
            strategy: 'mitigar',
            residualALE: 250,
            residualInputs: { preventionScale: 0.5, damageCap: 60000 },
        },
    });
    assert.deepStrictEqual(conTope, { scale: 0.5, damageCap: 60000 });

    const conDefensaObjetivo = residualSpecOf({
        ...RIESGO_TRATABLE,
        ale: 1000,
        treatmentDecision: {
            strategy: 'mitigar',
            residualALE: 250,
            residualInputs: { targetDefenseKey: 'avanzada' },
        },
    });
    assert.strictEqual(conDefensaObjetivo.defenseKey, 'avanzada');
    assert.strictEqual(conDefensaObjetivo.scale, 1, 'con Nivel de Defensa objetivo no se escala nada a mano');
});

test('residualSpecOf: ignora una receta con un perfil de defensa que ya no existe', () => {
    const spec = residualSpecOf({
        ...RIESGO_TRATABLE,
        ale: 1000,
        treatmentDecision: {
            strategy: 'mitigar',
            residualALE: 250,
            residualInputs: { targetDefenseKey: 'inventada', preventionScale: 0.25 },
        },
    });
    assert.strictEqual(spec.defenseKey, undefined);
    assert.strictEqual(spec.scale, 0.25);
});

test('el portafolio ya NO reconstruye la contención como si fuera prevención', () => {
    // El bug medido: la Decisión guardaba solo el RESULTADO (residualALE), y de un número no se
    // puede reconstruir una distribución. Las dos palancas de Mitigar dan la MISMA media y colas
    // completamente distintas — prevenir escala la frecuencia, contener trunca cada evento — así
    // que el portafolio reproducía cualquier tratamiento como prevención pura: acertaba el ALE y
    // casi triplicaba la cola.
    const CAP = 60000;
    // El residual REAL de un tratamiento de pura contención, simulado directo.
    const real = summarizeLosses(
        runMonteCarloSimulation({
            iterations: 20000,
            seed: 4242,
            tef: RIESGO_TRATABLE.tef,
            vuln: RIESGO_TRATABLE.vuln,
            lossMagnitudes: RIESGO_TRATABLE.lossMagnitudes,
            magnitudeCap: CAP,
        }).annualLosses,
    );
    const conRiesgo = (residualInputs) => ({
        ...RIESGO_TRATABLE,
        ale: 133371,
        treatmentDecision: { strategy: 'mitigar', residualALE: real.average, residualInputs },
    });

    const sinReceta = simulateResidualPortfolio([conRiesgo(undefined)]);
    const conReceta = simulateResidualPortfolio([conRiesgo({ damageCap: CAP })]);

    // Con la receta, la cola del portafolio coincide con el residual real; sin ella, se dispara.
    const desvio = Math.abs(conReceta.summary.cvar95 / real.cvar95 - 1);
    assert.ok(
        desvio < 0.1,
        `con receta debería parecerse al real ${real.cvar95.toFixed(0)}: ${conReceta.summary.cvar95.toFixed(0)}`,
    );
    assert.ok(
        sinReceta.summary.cvar95 > conReceta.summary.cvar95 * 2,
        `sin receta la cola se sobreestima: ${sinReceta.summary.cvar95.toFixed(0)} vs ${conReceta.summary.cvar95.toFixed(0)}`,
    );
});

test('la receta con Nivel de Defensa objetivo re-simula con ESE perfil, no con el actual', () => {
    const conPerfiles = (residualInputs) => ({
        ...RIESGO_TRATABLE,
        vulnManualOverride: false,
        attackerKey: 'organizado',
        defenseKey: 'basica',
        dataConfidence: 'medio',
        ale: 1000,
        treatmentDecision: { strategy: 'mitigar', residualALE: 400, residualInputs },
    });
    const sinTratar = simulatePortfolio([conPerfiles(undefined)]);
    const conObjetivo = simulateResidualPortfolio([conPerfiles({ targetDefenseKey: 'elite' })]);
    // Subir de defensa básica a élite tiene que bajar la pérdida de verdad, sin depender de que
    // alguien haya calculado bien el residualALE guardado.
    assert.ok(
        conObjetivo.summary.average < sinTratar.summary.average * 0.5,
        `de básica a élite debería bajar bastante: ${sinTratar.summary.average.toFixed(0)} -> ${conObjetivo.summary.average.toFixed(0)}`,
    );
});

// ---------------------------------------------------------------------------------------------
// PROCEDENCIA POR FACTOR (lib/provenance.js)
// ---------------------------------------------------------------------------------------------
// No calcula nada — por eso lo que hay que proteger es distinto de lo habitual: que NO invente
// evidencia donde no la hay, y que no deje pasar un dato que después no se pueda usar.
const {
    normalizeFactorProvenance,
    validateFactorProvenance,
    weakestOrigin,
    summarizeProvenance,
    FACTOR_KEYS,
} = require('../src/lib/provenance');

test('normalizeFactorProvenance: un riesgo sin procedencia declarada es juicio experto, no "desconocido"', () => {
    const p = normalizeFactorProvenance({});
    assert.deepStrictEqual(Object.keys(p), FACTOR_KEYS);
    FACTOR_KEYS.forEach((k) => {
        assert.strictEqual(p[k].origen, 'juicio-experto');
        assert.strictEqual(p[k].observaciones, null);
    });
});

test('normalizeFactorProvenance: los riesgos ya guardados heredan su origen del dataSource viejo', () => {
    // Lo que el usuario SÍ había declarado no se tira a la basura: `dataSource` decía de qué tipo
    // era la fuente, y eso se conserva por factor.
    assert.strictEqual(normalizeFactorProvenance({ dataSource: 'historico' }).tef.origen, 'historico-propio');
    assert.strictEqual(
        normalizeFactorProvenance({ dataSource: 'benchmark' }).vulnerabilidad.origen,
        'benchmark-sector',
    );
    assert.strictEqual(
        normalizeFactorProvenance({ dataSource: 'experto-calibrado' }).magnitud.origen,
        'juicio-experto',
    );
});

test('normalizeFactorProvenance: NO inventa cuántas observaciones respaldan un dato heredado', () => {
    // El `dataSource` viejo decía de qué TIPO era la fuente, nunca CUÁNTA evidencia había.
    // Rellenar ahí un número sería exactamente la falsa precisión que este módulo existe para medir.
    const p = normalizeFactorProvenance({ dataSource: 'historico' });
    FACTOR_KEYS.forEach((k) => {
        assert.strictEqual(p[k].observaciones, null);
        assert.strictEqual(p[k].exposicion, null);
    });
});

test('validateFactorProvenance: rechaza observaciones sin exposición (el conteo solo no se puede usar)', () => {
    // "4 incidentes" no dice nada sin "en cuántos años". Sin exposición no hay unidades de riesgo,
    // y sin unidades no hay Z = n/(n+k) que ponderar.
    const error = validateFactorProvenance({ tef: { origen: 'historico-propio', observaciones: 4 } });
    assert.ok(error && error.includes('exposición'), `esperaba un error sobre la exposición, dio: ${error}`);
    assert.strictEqual(
        validateFactorProvenance({ tef: { origen: 'historico-propio', observaciones: 4, exposicion: 3 } }),
        null,
    );
});

test('validateFactorProvenance: no declarar procedencia es válido — declararla mal, no', () => {
    assert.strictEqual(validateFactorProvenance(null), null);
    assert.strictEqual(validateFactorProvenance(undefined), null);
    assert.ok(validateFactorProvenance({ tef: { origen: 'inventado' } }));
    assert.ok(validateFactorProvenance({ noEsUnFactor: {} }));
    assert.ok(validateFactorProvenance({ tef: { exposicion: -1 } }));
    assert.ok(validateFactorProvenance([]));
});

test('weakestOrigin: el eslabón más débil manda, aunque los otros dos estén bien sostenidos', () => {
    const p = normalizeFactorProvenance({
        factorProvenance: {
            tef: { origen: 'historico-propio', observaciones: 10, exposicion: 5 },
            vulnerabilidad: { origen: 'benchmark-sector' },
            magnitud: { origen: 'juicio-experto' },
        },
    });
    assert.strictEqual(weakestOrigin(p), 'juicio-experto');
});

test('summarizeProvenance: mide por FACTOR, no por riesgo — los tres pesan igual en el ALE', () => {
    // Un riesgo con Frecuencia histórica y Magnitud inventada no está "sostenido a medias": tiene
    // un factor sostenido de tres. Como la elasticidad de los tres es 1, contar por riesgo
    // escondería exactamente el desbalance que este resumen existe para mostrar.
    const risk = (riskName, factorProvenance) => ({
        riskName,
        riskType: 'amenaza',
        tef: { min: 1, mode: 2, max: 3 },
        vuln: { min: 10, mode: 20, max: 30 },
        lossMagnitudes: { respuesta: { min: 1, mode: 2, max: 3 } },
        factorProvenance,
    });
    const resumen = summarizeProvenance([
        risk('Con histórico en frecuencia', {
            tef: { origen: 'historico-propio', observaciones: 6, exposicion: 4 },
        }),
        risk('Todo a juicio', null),
    ]);
    assert.strictEqual(resumen.total, 2);
    assert.strictEqual(resumen.conAlgunDato, 1);
    assert.strictEqual(resumen.porFactor.tef.conDatos, 1);
    assert.strictEqual(resumen.porFactor.magnitud.conDatos, 0);
    assert.strictEqual(resumen.porFactor.tef.observaciones, 6);
    // 1 factor sostenido de 6 posibles (2 riesgos x 3 factores).
    assert.ok(Math.abs(resumen.porcentajeSostenido - 100 / 6) < 1e-9);
});

test('summarizeProvenance: una oportunidad y un riesgo sin analizar no cuentan', () => {
    const resumen = summarizeProvenance([
        { riskName: 'Oportunidad', riskType: 'oportunidad', tef: {}, vuln: {}, lossMagnitudes: {} },
        { riskName: 'Stub del árbol', riskType: 'amenaza' },
    ]);
    assert.strictEqual(resumen.total, 0);
    assert.strictEqual(resumen.porcentajeSostenido, 0);
});

// ============================================================
// Disuasión (Stackelberg) — ver backend/src/lib/stackelbergDeterrence.js
// ============================================================
const {
    DEFAULT_OUTSIDE_OPTION_FRACTION,
    attackerBestResponse,
    deterrenceThreshold,
    simulateDeterrence,
} = require('../src/lib/stackelbergDeterrence');

test('disuasión: más defensa nunca le sube la ganancia al atacante', () => {
    // El invariante más básico: si esto se rompe, todo lo demás (que el umbral exista y sea único)
    // deja de tener sentido, porque la bisección asume exactamente esta monotonía.
    let previo = Infinity;
    for (let d = 0; d <= 100; d += 2) {
        const p = attackerBestResponse(d, 1.5, 275000, 800).payoff;
        assert.ok(p <= previo + 1e-9, `la ganancia subió al pasar a defensa ${d}: ${previo} -> ${p}`);
        previo = p;
    }
});

test('disuasión: el umbral baja cuando el atacante tiene mejores alternativas', () => {
    // Cuanto más fácil le resulta irse a otro lado, menos inversión hace falta para que se vaya.
    let previo = Infinity;
    for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        const { threshold } = deterrenceThreshold({
            m: 1.5,
            valueAtStake: 275000,
            costAttacker: 800,
            outsideOption: f * 275000,
        });
        assert.ok(threshold !== null, `sin umbral con alternativa ${f}`);
        assert.ok(threshold <= previo + 1e-6, `el umbral subió con alternativa ${f}`);
        previo = threshold;
    }
});

test('disuasión: al que no tiene adónde ir NUNCA se lo disuade — a lo sumo desiste', () => {
    // La afirmación central del módulo, y la versión PRECISA de ella. La versión fácil ("al
    // insider no lo disuade nada") es falsa: con un activo chico y un costo de intento alto, hasta
    // un atacante sin alternativas deja de atacar. Pero eso no es disuasión — no se fue a ningún
    // lado, simplemente dejó de rentarle, y vuelve en cuanto suba el valor o se afloje un control.
    // Lo que sí es invariante es que el MOTIVO nunca puede ser "alternativa" cuando vale cero.
    let casos = 0;
    for (const valueAtStake of [1e3, 1e4, 1e5, 275000, 1e6, 1e9]) {
        for (const m of [0.5, 1, 1.5, 2, 3]) {
            for (const costAttacker of [10, 50, 800, 3000, 20000]) {
                const r = deterrenceThreshold({ m, valueAtStake, costAttacker, outsideOption: 0 });
                assert.notStrictEqual(
                    r.reason,
                    'alternativa',
                    `con alternativa 0 apareció disuasión real (V=${valueAtStake}, m=${m}, c=${costAttacker})`,
                );
                casos += 1;
            }
        }
    }
    assert.strictEqual(casos, 150);
    // Y el default del perfil que representa ese caso es exactamente 0, no un número prudente.
    assert.strictEqual(DEFAULT_OUTSIDE_OPTION_FRACTION['empleado-desleal'], 0);
});

test('disuasión: un atacante que eligió este objetivo es más caro de sacar que uno oportunista', () => {
    // El resultado que hace que el análisis valga la pena: el mismo gasto compra cosas distintas
    // según a quién enfrentes. Sin esto, la pantalla sugeriría gastar igual contra todos.
    const base = { m: 1.5, valueAtStake: 275000, costAttacker: 800 };
    const oportunista = deterrenceThreshold({
        ...base,
        outsideOption: DEFAULT_OUTSIDE_OPTION_FRACTION.oportunista * base.valueAtStake,
    });
    const organizado = deterrenceThreshold({
        ...base,
        outsideOption: DEFAULT_OUTSIDE_OPTION_FRACTION.organizado * base.valueAtStake,
    });
    assert.ok(oportunista.threshold !== null, 'al oportunista sí se lo debería poder disuadir');
    // Al organizado o no se lo disuade, o cuesta estrictamente más.
    assert.ok(
        organizado.threshold === null || organizado.threshold > oportunista.threshold,
        `organizado ${organizado.threshold} no es más caro que oportunista ${oportunista.threshold}`,
    );
});

test('disuasión: la simulación reproduce el caso central y la curva es monótona', () => {
    const params = {
        m: 1.5,
        valueAtStake: { min: 250000, mode: 275000, max: 300000 },
        costAttacker: { min: 750, mode: 800, max: 850 },
        outsideOptionFraction: { min: 0.48, mode: 0.5, max: 0.52 },
        iterations: 4000,
        seed: 99,
    };
    const sim = simulateDeterrence(params);
    const central = deterrenceThreshold({
        m: params.m,
        valueAtStake: params.valueAtStake.mode,
        costAttacker: params.costAttacker.mode,
        outsideOption: params.outsideOptionFraction.mode * params.valueAtStake.mode,
    });
    // Con rangos estrechos, la mediana de la distribución tiene que caer cerca del caso resuelto
    // exacto. Es la prueba de que la simulación envuelve al solver y no lo reemplaza.
    assert.ok(
        Math.abs(sim.thresholdMedian - central.threshold) < 5,
        `mediana ${sim.thresholdMedian} lejos del central ${central.threshold}`,
    );
    // La curva "porcentaje disuadido" no puede bajar al subir la defensa.
    let previo = -1;
    sim.deterrenceCurve.forEach((p) => {
        assert.ok(p.deterredPercent >= previo - 1e-9, `la curva bajó en defensa ${p.defenseEffort}`);
        previo = p.deterredPercent;
    });
    // Y las tres cuentas de motivos tienen que cerrar contra el total.
    const suma = sim.neverDeterredPercent + sim.byAlternativePercent + sim.byUnprofitablePercent;
    assert.ok(Math.abs(suma - 100) < 1e-9, `los motivos suman ${suma} %, no 100`);
});

test('disuasión: misma semilla, mismo resultado', () => {
    const p = {
        m: 1.5,
        valueAtStake: { min: 200000, mode: 275000, max: 400000 },
        costAttacker: { min: 500, mode: 800, max: 1500 },
        outsideOptionFraction: { min: 0.3, mode: 0.5, max: 0.7 },
        iterations: 1000,
        seed: 7,
    };
    assert.deepStrictEqual(simulateDeterrence(p), simulateDeterrence(p));
});
