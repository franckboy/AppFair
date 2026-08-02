'use strict';

// Tope duro de iteraciones para /api/simulate. Sin esto, un cliente podía
// mandar `iterations: 50000000` y el servidor intentaba reservar arreglos de
// ese tamaño y correr la simulación de forma síncrona, bloqueando el event
// loop de Node para todas las demás peticiones — una denegación de servicio
// trivial y sin necesitar credenciales. 10,000 es también el valor por
// defecto (y único, en la práctica) que usa el frontend — fijarlo como tope
// evita que una simulación "grande" tarde de forma impredecible al
// re-simular un riesgo guardado desde el Registro.
const MAX_ITERATIONS = 10000;

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Valida un rango triangular {min, mode, max}. Antes de esto, valores no
 * numéricos (strings, undefined, NaN) pasaban directo al motor Monte Carlo y
 * producían resultados corruptos en silencio (ej. `average: null`,
 * `"$NaN"` en la justificación) en vez de un error claro.
 * @param {*} range
 * @param {string} label
 * @param {{min:number, max:number}} [bounds] límites permitidos adicionales, ej. {min:0, max:100} para %
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validateTriangularRange(range, label, bounds = null) {
    if (!range || typeof range !== 'object') {
        return `${label} es requerido y debe ser un objeto {min, mode, max}.`;
    }
    const { min, mode, max } = range;
    if (![min, mode, max].every(isFiniteNumber)) {
        return `${label}.min, ${label}.mode y ${label}.max deben ser números.`;
    }
    if (min < 0 || mode < 0 || max < 0) {
        return `${label}: min, mode y max no pueden ser negativos.`;
    }
    if (!(min <= mode && mode <= max)) {
        return `${label}: se requiere min <= mode <= max.`;
    }
    if (bounds) {
        if (min < bounds.min || max > bounds.max) {
            return `${label}: min y max deben estar entre ${bounds.min} y ${bounds.max}.`;
        }
    }
    return null;
}

/** @returns {string|null} mensaje de error, o null si es válido */
function validateIterations(iterations) {
    if (!isFiniteNumber(iterations) || !Number.isInteger(iterations)) {
        return 'iterations debe ser un número entero.';
    }
    if (iterations < 1 || iterations > MAX_ITERATIONS) {
        return `iterations debe estar entre 1 y ${MAX_ITERATIONS}.`;
    }
    return null;
}

/** @returns {string|null} mensaje de error, o null si es válido */
function validateSeed(seed) {
    if (seed === undefined || seed === null) return null;
    if (!isFiniteNumber(seed)) return 'seed debe ser un número.';
    return null;
}

module.exports = { MAX_ITERATIONS, isFiniteNumber, validateTriangularRange, validateIterations, validateSeed };
