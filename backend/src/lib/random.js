'use strict';

/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 * Con la misma semilla y los mismos inputs, produce exactamente la misma
 * secuencia de números — permite reproducir una simulación Monte Carlo
 * para efectos de auditoría, en vez de depender de Math.random().
 * @param {number} seed
 * @returns {() => number} función que devuelve un número en [0, 1)
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Muestreo de una distribución triangular (min, moda, max) por transformación
 * inversa. Es la fórmula estándar de libro de texto para este tipo de
 * distribución.
 * @param {number} min
 * @param {number} mode
 * @param {number} max
 * @param {() => number} [rng=Math.random] generador de números aleatorios en [0,1)
 * @returns {number}
 */
function getTriangularRandom(min, mode, max, rng = Math.random) {
    if (min > max) [min, max] = [max, min];
    if (mode < min || mode > max) mode = (min + max) / 2;
    if (min === max) return min;

    const F = (mode - min) / (max - min);
    const rand = rng();

    if (rand < F) {
        return min + Math.sqrt(rand * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - rand) * (max - min) * (max - mode));
}

/** Normal estándar (Box-Muller) — un solo valor por llamada, no cachea el segundo (mantiene
 * el consumo de la secuencia determinista y simple; el desperdicio de una muestra por llamada
 * no importa para una simulación de miles de iteraciones). */
function nextGaussian(rng) {
    let u1 = 0;
    while (u1 === 0) u1 = rng(); // evita log(0) = -Infinity
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma(shape, 1) por el método de Marsaglia y Tsang (2000) — el algoritmo de referencia
 * para muestrear Gamma con una normal + un uniforme, sin funciones especiales. Para shape < 1
 * usa el truco estándar (Gamma(shape+1) escalada por U^(1/shape)) en vez de repetir el
 * algoritmo entero para ese caso. */
function sampleGamma(shape, rng) {
    if (shape < 1) {
        const u = rng();
        return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x, v;
        do {
            x = nextGaussian(rng);
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = rng();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

/** Beta(alpha, beta) en [0,1] a partir de dos Gamma independientes: si X~Gamma(alpha),
 * Y~Gamma(beta), entonces X/(X+Y) ~ Beta(alpha, beta) — la construcción estándar. */
function sampleBeta(alpha, beta, rng) {
    const x = sampleGamma(alpha, rng);
    const y = sampleGamma(beta, rng);
    return x / (x + y);
}

/**
 * Muestreo de una distribución Beta-PERT (min, moda, max) — la distribución recomendada en la
 * práctica de FAIR/Monte Carlo para estimados de 3 puntos de expertos (TEF, Vulnerabilidad),
 * en vez de la triangular: concentra más probabilidad alrededor de la moda (el valor "más
 * probable" pesa 4x en la media, ver pertMean en el frontend) en lugar de tratarla como un
 * punto más de una distribución lineal, que es lo que hace que la triangular sobre-estime la
 * probabilidad de los extremos. Es una Beta(alpha, beta) reescalada a [min, max], con
 * lambda=4 (el valor por defecto estándar de PERT — más alto concentra más peso en la moda).
 * @param {number} min
 * @param {number} mode
 * @param {number} max
 * @param {number} [lambda=4]
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
function getPertRandom(min, mode, max, lambda = 4, rng = Math.random) {
    if (min > max) [min, max] = [max, min];
    if (mode < min || mode > max) mode = (min + max) / 2;
    if (min === max) return min;

    const alpha = 1 + (lambda * (mode - min)) / (max - min);
    const beta = 1 + (lambda * (max - mode)) / (max - min);
    const x = sampleBeta(alpha, beta, rng);
    return min + x * (max - min);
}

/** Varianza teórica de una triangular(min, mode, max) — fórmula estándar de libro de texto,
 * usada como el "ancho de incertidumbre" que el usuario quiso decir con min/mode/max, para
 * preservarlo al recalibrar hacia lognormal (ver getLognormalRandom). */
function triangularVariance(min, mode, max) {
    return (min * min + mode * mode + max * max - min * mode - min * max - mode * max) / 18;
}

/** Resuelve sigma² de una lognormal cuya moda es `mode` y cuya varianza es `targetVariance`,
 * por bisección (no hay fórmula cerrada: sustituyendo mu = ln(mode) + sigma² en la fórmula de
 * varianza de la lognormal queda mode²·(e^s - 1)·e^(3s) = targetVariance, una ecuación
 * trascendente en s = sigma²). La función es monótona creciente en s (para s > 0), así que la
 * bisección converge siempre — no hace falta Newton ni una cota superior fija: se dobla el
 * límite hasta encontrar un cambio de signo. */
function solveLognormalSigmaSquared(mode, targetVariance) {
    if (targetVariance <= 0) return 0;
    const f = (s) => mode * mode * (Math.exp(s) - 1) * Math.exp(3 * s) - targetVariance;
    let lo = 0,
        hi = 1;
    while (f(hi) < 0) hi *= 2;
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) > 0) hi = mid;
        else lo = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Muestreo lognormal (min, moda, max) — la distribución recomendada en la práctica de FAIR/
 * Monte Carlo para Magnitud de Pérdida: a diferencia de triangular/PERT, no tiene un techo
 * duro en `max` (las pérdidas reales sí pueden superar el "peor caso" estimado — por eso la
 * app ya reporta CVaR95/P90, no solo el máximo simulado). En vez de reinterpretar min/max como
 * un percentil (ej. 5/95) — lo que infla la cola sin control, porque min/max los calibró el
 * usuario/`calculateLossMagnitudeRange` pensando en una triangular acotada, no en una promesa
 * estadística de "IC 90%" — se ajusta por MOMENTOS: la lognormal resultante tiene la MISMA
 * varianza que la triangular con ese mismo min/moda/max (ver triangularVariance +
 * solveLognormalSigmaSquared), y su moda es exactamente `mode` (mode = exp(mu - sigma²)). Así
 * el "ancho de incertidumbre" que el usuario quiso decir se preserva tal cual — lo único que
 * cambia es la FORMA (sesgo a la derecha, cola realista sin techo duro), no cuánta
 * incertidumbre hay.
 * Requiere `mode` estrictamente positivo (la lognormal no está definida en 0 o menos) — si no
 * se cumple (categoría de pérdida sin costo típico, un caso real y válido), cae a triangular
 * para esa muestra en vez de reventar.
 * @param {number} min
 * @param {number} mode
 * @param {number} max
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
function getLognormalRandom(min, mode, max, rng = Math.random) {
    return sampleMagnitude(magnitudeParams(min, mode, max), rng);
}

/**
 * Resuelve UNA sola vez los parámetros de muestreo de una Magnitud (min, moda, max) — la parte
 * cara y puramente determinista de getLognormalRandom: solveLognormalSigmaSquared hace 100
 * iteraciones de bisección, y hasta ahora se repetían en CADA muestra aunque min/moda/max no
 * cambian nunca dentro de una corrida.
 *
 * Separarlo no altera ningún resultado (mismos mu/sigma, mismo consumo del rng, mismas ramas de
 * respaldo) — es 18x más rápido, medido. Deja de ser un detalle de rendimiento y pasa a ser un
 * requisito con el modelo COMPUESTO (ver frequencyModel en simulation.js): ahí se sortea una
 * magnitud por CADA evento del año, no una por año, así que un riesgo de frecuencia alta pasa de
 * ~10.000 muestras por corrida a varios millones.
 */
function magnitudeParams(min, mode, max) {
    if (min > max) [min, max] = [max, min];
    if (mode < min || mode > max) mode = (min + max) / 2;
    if (min === max) return { kind: 'constant', value: min };
    // La lognormal no está definida en 0 o menos (categoría de pérdida sin costo típico, un caso
    // real y válido) — se cae a triangular para esa categoría, igual que siempre.
    if (mode <= 0) return { kind: 'triangular', min, mode, max };

    const sigmaSquared = solveLognormalSigmaSquared(mode, triangularVariance(min, mode, max));
    return { kind: 'lognormal', mu: Math.log(mode) + sigmaSquared, sigma: Math.sqrt(sigmaSquared) };
}

/** Una muestra a partir de los parámetros ya resueltos por magnitudeParams. */
function sampleMagnitude(params, rng = Math.random) {
    if (params.kind === 'constant') return params.value;
    if (params.kind === 'triangular') return getTriangularRandom(params.min, params.mode, params.max, rng);
    return Math.exp(params.mu + params.sigma * nextGaussian(rng));
}

// Por encima de este lambda, el sorteo de Poisson usa la aproximación normal en vez del método de
// Knuth (ver getPoissonRandom). A lambda=30 la Poisson ya es casi simétrica y el error relativo de
// la aproximación es de milésimas, mientras que Knuth cuesta lambda+1 llamadas al rng por muestra.
const POISSON_KNUTH_MAX_LAMBDA = 30;

/**
 * Número de eventos en un año, Poisson(lambda) — la pieza que le faltaba al motor para poder
 * decir "este año NO pasó nada" o "este año pasó dos veces", en vez de repartir una fracción de
 * evento en todos los años por igual (ver frequencyModel en simulation.js).
 *
 * Hasta lambda=30 usa el método de Knuth (exacto: multiplica uniformes hasta bajar de e^(-lambda));
 * por encima, la aproximación normal redondeada, porque Knuth cuesta lambda+1 llamadas al rng por
 * muestra y a esa altura la Poisson ya es prácticamente simétrica.
 * @param {number} lambda Tasa media de eventos por año (LEF). <= 0 devuelve 0.
 * @param {() => number} [rng=Math.random]
 * @returns {number} Entero >= 0
 */
function getPoissonRandom(lambda, rng = Math.random) {
    if (!Number.isFinite(lambda) || lambda <= 0) return 0;
    if (lambda > POISSON_KNUTH_MAX_LAMBDA) {
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * nextGaussian(rng)));
    }
    const limite = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
        k++;
        p *= rng();
    } while (p > limite);
    return k - 1;
}

module.exports = {
    mulberry32,
    getTriangularRandom,
    getPertRandom,
    getLognormalRandom,
    getPoissonRandom,
    magnitudeParams,
    sampleMagnitude,
    triangularVariance,
    solveLognormalSigmaSquared,
};
