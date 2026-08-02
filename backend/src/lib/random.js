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
        a = (a + 0x6D2B79F5) | 0;
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

module.exports = { mulberry32, getTriangularRandom };
