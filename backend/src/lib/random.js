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

/**
 * Muestreo lognormal (min, moda, max) — la distribución recomendada en la práctica de FAIR/
 * Monte Carlo para Magnitud de Pérdida: a diferencia de triangular/PERT, no tiene un techo
 * duro en `max` (las pérdidas reales sí pueden superar el "peor caso" estimado — por eso la
 * app ya reporta CVaR95/P90, no solo el máximo simulado). `min`/`max` se calibran como el
 * percentil 5/95 (IC 90%, la construcción estándar de estimados calibrados), y `mode` fija el
 * pico de la curva resultante (fórmula de la moda de la lognormal: mode = exp(mu - sigma²)).
 * Requiere min y mode estrictamente positivos (la lognormal no está definida en 0 o menos) —
 * si no se cumple (categoría de pérdida con costo 0 en el mejor caso o el típico, un caso real
 * y válido), cae a triangular para esa muestra en vez de reventar.
 * @param {number} min
 * @param {number} mode
 * @param {number} max
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
function getLognormalRandom(min, mode, max, rng = Math.random) {
    if (min > max) [min, max] = [max, min];
    if (mode < min || mode > max) mode = (min + max) / 2;
    if (min === max) return min;
    if (min <= 0 || mode <= 0) return getTriangularRandom(min, mode, max, rng);

    const Z90 = 1.6448536269514722; // percentil 95 de la normal estándar (IC 90% = ±Z90·sigma)
    const sigma = (Math.log(max) - Math.log(min)) / (2 * Z90);
    const mu = Math.log(mode) + sigma * sigma;
    return Math.exp(mu + sigma * nextGaussian(rng));
}

module.exports = { mulberry32, getTriangularRandom, getPertRandom, getLognormalRandom };
