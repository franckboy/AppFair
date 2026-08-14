'use strict';

const { mulberry32, getPertRandom, getLognormalRandom } = require('./random');
const { lossFormsKeys, lossFormsLabels } = require('../data/profiles');
const { sampleCorrelation } = require('simple-statistics');

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
 * @param {number} [params.magnitudeCap] Tope de daño POR EVENTO, en dinero. Modela un control de
 *        CONTENCIÓN: compartimentación, rociadores, un límite de efectivo en caja, segmentación de
 *        red. Se aplica escenario por escenario (`min(lm_i, cap)`), nunca sobre el promedio.
 *
 *        Por qué existe, y por qué es distinto de todo lo demás: reducir la Vulnerabilidad
 *        multiplica CADA pérdida por una constante, y escalar una distribución entera escala TODAS
 *        sus estadísticas por igual — la razón cola/media queda congelada. Por eso un control de
 *        PREVENCIÓN nunca puede cambiar la FORMA de la cola en este modelo, solo su tamaño. Un tope
 *        sí: trunca los peores escenarios y deja los demás intactos, así que baja el CVaR mucho más
 *        que el ALE. Es la única palanca del motor que distingue "que pase menos veces" de "que
 *        duela menos cuando pase".
 *
 *        Sin tope (por defecto) el comportamiento es idéntico bit a bit al de antes.
 * @returns {{annualLosses:number[], usedSeed:number, sensitivity:Array, lefSamples:number[], magnitudeSamples:number[]}}
 */
function runMonteCarloSimulation({ iterations, seed, tef, vuln, lossMagnitudes, sampleVuln, magnitudeCap }) {
    const usedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
    const rng = mulberry32(usedSeed);

    const vulnDecimal = { min: vuln.min / 100, mode: vuln.mode / 100, max: vuln.max / 100 };
    const drawVuln = sampleVuln || ((r) => getPertRandom(vulnDecimal.min, vulnDecimal.mode, vulnDecimal.max, 4, r));

    // Un tope de 0 o negativo se ignora: "sin contención" se dice omitiéndolo, no poniendo cero
    // (que significaría que ningún evento cuesta nada).
    const aplicaTope = typeof magnitudeCap === 'number' && Number.isFinite(magnitudeCap) && magnitudeCap > 0;

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

        // El tope actúa sobre el daño de UN evento (la suma de las categorías de pérdida), no sobre
        // la pérdida anual: "ningún incendio pasa de $X" es una afirmación por evento. Se aplica
        // DESPUÉS de sortear las categorías y ANTES de multiplicar por la frecuencia, que es donde
        // de verdad corta la cola.
        if (aplicaTope && lm_i > magnitudeCap) lm_i = magnitudeCap;

        tefSamples[i] = tef_i;
        vulnSamples[i] = vuln_i;
        lefSamples[i] = lef_i;
        magnitudeSamples[i] = lm_i;
        annualLosses[i] = lef_i * lm_i;
    }

    const sensitivity = calculateSensitivity(annualLosses, tefSamples, vulnSamples, lmSamples, activeKeys);

    return { annualLosses, usedSeed, sensitivity, lefSamples, magnitudeSamples };
}

/**
 * Correlación de Pearson entre dos arreglos numéricos del mismo largo. Envuelve
 * sampleCorrelation de simple-statistics (misma fórmula, cov/std/std) en vez de mantener a mano
 * la varianza + covarianza — pero simple-statistics NO protege dos casos que sí necesitamos:
 *  - Con menos de 2 puntos, sampleCovariance revienta con un Error (nunca ocurría con la
 *    fórmula manual, que devolvía 0). iterations=1 es un valor válido según validateIterations,
 *    así que esto es alcanzable desde la API, no solo un caso de laboratorio.
 *  - Con varianza cero en x o y (ej. vuln.min === vuln.max hace que getPertRandom devuelva
 *    siempre el mismo valor — un arreglo constante), cov/std/std da 0/0 = NaN en vez del 0 que
 *    calculateSensitivity necesita para que Math.abs(...) y .sort() no se rompan.
 * En ambos casos se preserva el mismo comportamiento (devolver 0) que tenía la implementación
 * anterior (ver el `den === 0 ? 0 : ...` que reemplaza esta versión).
 */
function pearsonCorrelation(x, y) {
    if (x.length < 2) return 0;
    const r = sampleCorrelation(x, y);
    return Number.isNaN(r) ? 0 : r;
}

/**
 * Análisis de Sensibilidad (RIMS RA.1-2015, 6.3.4.3): ranking de qué tanto
 * influye cada variable de entrada en el resultado final, medido por su
 * correlación de Pearson contra las pérdidas simuladas.
 */
/**
 * Correlación de rangos de Spearman: Pearson aplicado a los RANGOS en vez de a los valores.
 *
 * Se usa en vez de Pearson porque este modelo no es lineal y Pearson solo mide relación lineal.
 * Tullock con m=6,8254 es fuertemente convexo, y la Magnitud de Pérdida es lognormal con cola
 * pesada: unos pocos sorteos enormes de magnitud dominan la covarianza y aplastan el peso aparente
 * de los demás factores. Medido sobre el modelo real, Pearson subestimaba la Frecuencia y la
 * Vulnerabilidad a la MITAD:
 *
 *      variable          Pearson    Spearman
 *      Frecuencia          0,244      0,367
 *      Vulnerabilidad      0,323      0,496
 *      Magnitud            0,841      0,753
 *
 * Spearman es robusto a cualquier relación MONÓTONA, sea lineal o no, que es exactamente el caso:
 * más frecuencia siempre implica más pérdida, aunque no de forma proporcional. No captura
 * interacciones entre factores (para eso harían falta índices de Sobol, con su propio diseño
 * muestral); si algún día la varianza sin explicar lo justifica, ese es el siguiente paso.
 */
function rankOf(values) {
    const indexed = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    // Rangos promediados en los empates — sin esto, valores idénticos recibirían rangos
    // arbitrarios según el orden de llegada y la correlación dependería del muestreo.
    let i = 0;
    while (i < indexed.length) {
        let j = i;
        while (j + 1 < indexed.length && indexed[j + 1][0] === indexed[i][0]) j++;
        const promedio = (i + j) / 2;
        for (let k = i; k <= j; k++) ranks[indexed[k][1]] = promedio;
        i = j + 1;
    }
    return ranks;
}

function spearmanCorrelation(x, y) {
    return pearsonCorrelation(rankOf(x), rankOf(y));
}

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
        correlation: spearmanCorrelation(f.values, losses),
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

    // Error estándar de la media: cuánta incertidumbre queda por usar 10.000 iteraciones en vez de
    // infinitas. Se REPORTA, no se usa como criterio de parada: la app fija la semilla a propósito
    // para que un resultado sea reproducible y auditable, y un corte dinámico rompería eso — dos
    // corridas con los mismos datos pararían en N distintos y darían cifras distintas.
    //
    // `standardErrorPercent` (error relativo) es el número accionable: por debajo del ~1% las
    // iteraciones sobran para decidir; por encima del ~5% el ALE todavía baila lo bastante como
    // para que convenga subirlas antes de sustentar una decisión con él.
    const variance = sorted.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / (n > 1 ? n - 1 : 1);
    const standardError = Math.sqrt(variance / n);
    const standardErrorPercent = avg > 0 ? (standardError / avg) * 100 : 0;

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

    return {
        average: avg,
        median,
        min,
        max,
        p90,
        cvar95,
        probExceedance,
        standardError,
        standardErrorPercent,
        iterations: n,
    };
}

// Escalera de probabilidades de excedencia para la Curva de Excedencia de Pérdidas, en %.
// Deliberadamente MÁS DENSA en la cola (de 10% hacia abajo) en vez de equiespaciada: la parte
// que de verdad se mira al decidir es "¿qué tan probable es una pérdida que me duela?", y con
// puntos equiespaciados en dinero esa zona quedaría con dos o tres puntos mientras se
// desperdicia resolución en el tramo alto de probabilidad, que es plano y poco informativo.
const LEC_EXCEEDANCE_PROBABILITIES = [
    100, 99, 98, 97, 96, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 7.5, 5, 4, 3, 2, 1.5,
    1, 0.75, 0.5, 0.25, 0.1,
];

/**
 * Curva de Excedencia de Pérdidas (LEC) — para cada umbral en dinero, la probabilidad de que la
 * pérdida anual lo SUPERE. Es la entrega insignia de FAIR: responde "¿qué probabilidad hay de
 * perder más de X en un año?", que es la pregunta con la que se decide, a diferencia del ALE
 * (un solo promedio) o del histograma (la forma de la distribución, sin leerse en probabilidades
 * acumuladas).
 *
 * Se construye al revés de como se lee: para cada probabilidad de la escalera se busca el umbral
 * que se excede con ESA probabilidad, o sea el cuantil (1 − p) de la distribución simulada. Así
 * los puntos quedan repartidos sobre el eje de probabilidad (donde se quiere control) y no sobre
 * el de dinero (donde el rango depende del riesgo y no se puede fijar de antemano).
 *
 * Devuelve ~34 puntos en vez de las 10,000 pérdidas crudas justamente para poder PERSISTIRSE en
 * el Registro (mismo criterio que el histograma de 20 barras, ver chartLabels/chartData en
 * routes/register.js) y que el Registro y el PDF puedan volver a dibujarla sin re-simular.
 *
 * @param {number[]} losses Pérdidas anuales simuladas — NO necesita venir ordenado.
 * @param {number[]} [probabilities] Escalera de probabilidades de excedencia (%), de mayor a menor.
 * @returns {Array<{loss:number, probability:number}>} Vacío si no hay pérdidas.
 */
function buildLossExceedanceCurve(losses, probabilities = LEC_EXCEEDANCE_PROBABILITIES) {
    if (!Array.isArray(losses) || losses.length === 0) return [];
    const sorted = [...losses].sort((a, b) => a - b);
    const n = sorted.length;
    return probabilities.map((probability) => {
        const cuantil = 1 - probability / 100;
        const idx = Math.min(n - 1, Math.max(0, Math.floor(cuantil * (n - 1))));
        return { loss: sorted[idx], probability };
    });
}

module.exports = {
    runMonteCarloSimulation,
    calculateSensitivity,
    summarizeLosses,
    pearsonCorrelation,
    spearmanCorrelation,
    buildLossExceedanceCurve,
    LEC_EXCEEDANCE_PROBABILITIES,
};
