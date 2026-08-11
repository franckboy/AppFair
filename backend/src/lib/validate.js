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

/**
 * Valida que un valor sea un número finito ESTRICTAMENTE positivo (> 0) — para campos donde 0
 * no tiene un significado válido, ej. el factor de decisividad `m` de Tullock, o un costo por
 * unidad de esfuerzo (un costo de 0 no es "gratis pero válido", es un input mal formado).
 * @param {*} value
 * @param {string} label
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validatePositiveNumber(value, label) {
    if (!isFiniteNumber(value) || value <= 0) {
        return `${label} debe ser un número mayor a 0.`;
    }
    return null;
}

/**
 * Valida un objeto { [key]: {min, mode, max} } de Magnitud de Pérdida — cada clave debe estar
 * en `lossFormsKeys` y cada rango debe pasar validateTriangularRange. Extraído de
 * POST /api/simulate (donde vivía inline) porque POST /api/autocalc/nash-equilibrium necesita
 * exactamente la misma validación para poder sumar el Valor en Juego con confianza.
 * @param {Object} lossMagnitudes
 * @param {string[]} lossFormsKeys
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validateLossMagnitudes(lossMagnitudes, lossFormsKeys) {
    const invalidKeys = Object.keys(lossMagnitudes).filter((k) => !lossFormsKeys.includes(k));
    if (invalidKeys.length > 0) {
        return `Categorías de pérdida no reconocidas: ${invalidKeys.join(', ')}`;
    }
    for (const [key, range] of Object.entries(lossMagnitudes)) {
        const lmError = validateTriangularRange(range, `lossMagnitudes.${key}`);
        if (lmError) return lmError;
    }
    return null;
}

/**
 * Valida los campos numéricos del body de /api/treatment/evaluate. Antes de esto no había
 * ningún límite: un reductionPercent > 100 hacía que Mitigar "evitara" más pérdida de la que
 * existe (ALE residual negativo), y un costo/premium/deducible/límite negativo inflaba el
 * beneficio neto calculado — ninguno de los dos es un valor real posible, así que dejarlos
 * pasar sin avisar exageraba o subestimaba el riesgo sin ninguna razón de negocio, solo por
 * falta de validación.
 * @param {Object} body
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validateTreatmentBody(body) {
    const { mitigar = {}, transferir = {}, evitar = {} } = body;

    if (mitigar.reductionPercent !== undefined) {
        if (
            !isFiniteNumber(mitigar.reductionPercent) ||
            mitigar.reductionPercent < 0 ||
            mitigar.reductionPercent > 100
        ) {
            return 'mitigar.reductionPercent debe ser un número entre 0 y 100.';
        }
    }

    const nonNegativeFields = [
        ['mitigar.cost', mitigar.cost],
        ['mitigar.delayDays', mitigar.delayDays],
        // Residual REAL re-simulado (ver evaluateTreatmentStrategias/calculateResidualFromSimulation)
        // — opcional, pero si viene debe ser un número válido ≥ 0 como cualquier otro monto.
        ['mitigar.residualALE', mitigar.residualALE],
        ['mitigar.residualCVaR', mitigar.residualCVaR],
        ['transferir.premium', transferir.premium],
        ['transferir.deductible', transferir.deductible],
        ['transferir.limit', transferir.limit],
        ['transferir.delayDays', transferir.delayDays],
        ['evitar.cost', evitar.cost],
        ['evitar.delayDays', evitar.delayDays],
    ];
    for (const [label, value] of nonNegativeFields) {
        // null se trata igual que undefined ("no viene") — mitigar.residualALE/residualCVaR se
        // mandan explícitamente como null (no se omiten) cuando no hay un residual real que
        // simular (ver Treatment.updateReduccionALEAuto en el frontend), y JSON sí distingue los
        // dos (`{"x":null}` !== `{}`) aunque para esta validación signifiquen lo mismo.
        if (value !== undefined && value !== null && (!isFiniteNumber(value) || value < 0)) {
            return `${label} debe ser un número mayor o igual a 0.`;
        }
    }
    return null;
}

module.exports = {
    MAX_ITERATIONS,
    isFiniteNumber,
    validateTriangularRange,
    validateIterations,
    validateSeed,
    validateTreatmentBody,
    validatePositiveNumber,
    validateLossMagnitudes,
};
