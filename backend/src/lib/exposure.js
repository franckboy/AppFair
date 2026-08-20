'use strict';

/**
 * EXPOSICIÓN — el denominador que le faltaba al modelo.
 *
 * ## El problema que resuelve
 *
 * El TEF está definido como intentos/AÑO. Una empresa de transporte no habla así: dice "3 robos en
 * 1.200 viajes". La bitácora ya sabía capturar eso (ver incidentLog.js) y no podía compararlo con
 * nada, porque el modelo no tenía forma de expresar cuántos viajes hay en un año. Seis de sus siete
 * unidades quedaban muertas: se pedía un dato que después no se podía consumir.
 *
 * La pieza que falta es un solo número por riesgo: **cuánta exposición hay al año**.
 *
 *     TEF_anual = tasa_por_unidad · exposicion_anual
 *
 * Con 1.200 viajes/año, "0,01 intentos por viaje" y "12 intentos al año" son el mismo riesgo dicho
 * de dos maneras. Sin ese 1.200, no hay forma de pasar de una a la otra.
 *
 * ## Por qué el TEF sigue siendo anual y canónico
 *
 * Decisión deliberada: `tef` se guarda en intentos/AÑO, como siempre. La exposición es (a) cómo se
 * LLEGA a ese número y (b) el diccionario que permite comparar una observación en viajes contra un
 * modelo anual. No es una unidad alternativa en la que el motor pueda trabajar.
 *
 * La alternativa —hacer canónica la tasa por unidad— obligaría a que TODO consumidor del TEF
 * (Monte Carlo, portafolio, Euler, Criterios de Riesgo, cascadas) conociera la exposición para
 * interpretarlo, y un riesgo con exposición rota o ausente produciría basura en silencio en vez de
 * un error visible. Además exigiría migrar cada entrada ya guardada. Así, en cambio, un riesgo sin
 * exposición declarada se comporta EXACTAMENTE como hoy: es el caso `anios` con exposición 1.
 *
 * ## Lo que esto NO arregla
 *
 * Que la bitácora observa LEF y no TEF sigue siendo cierto y sigue siendo la trampa más fácil de
 * pisar (ver incidentLog.js). La exposición cambia el denominador, no la magnitud: una tasa
 * observada por viaje sigue siendo de PÉRDIDAS por viaje, no de intentos por viaje. Convertir de
 * una a la otra exige dividir por la Vulnerabilidad, y eso vive en frequencyCalibration.js.
 */

/**
 * Denominadores posibles. `anios` es el neutro: exposición 1 al año, o sea el comportamiento de
 * siempre. Los demás necesitan que el riesgo declare cuántas unidades hay al año.
 *
 * `porAnio` es el valor por defecto que se ofrece al elegir la unidad — un punto de partida para
 * que el usuario no arranque de una caja vacía, nunca un dato que se use sin que lo confirme.
 */
const EXPOSURE_UNITS = {
    anios: { label: 'Años observados', singular: 'año', neutro: true, porAnio: 1 },
    viajes: { label: 'Viajes', singular: 'viaje', neutro: false, porAnio: 500 },
    'unidad-anio': { label: 'Unidades × año', singular: 'unidad', neutro: false, porAnio: 10 },
    'bodega-anio': { label: 'Bodegas × año', singular: 'bodega', neutro: false, porAnio: 3 },
    'noche-estacionado': { label: 'Noches estacionado', singular: 'noche', neutro: false, porAnio: 250 },
    cruces: { label: 'Cruces fronterizos', singular: 'cruce', neutro: false, porAnio: 120 },
    recolecciones: { label: 'Recolecciones', singular: 'recolección', neutro: false, porAnio: 800 },
};

/** La unidad neutra: un riesgo que no declara nada se mide en años, con exposición 1. */
const DEFAULT_EXPOSURE = { unit: 'anios', annual: 1 };

function isValidUnit(unit) {
    return Object.prototype.hasOwnProperty.call(EXPOSURE_UNITS, unit);
}

/**
 * Siempre devuelve una exposición utilizable. `null`/ausente/rota cae al neutro, que es el
 * comportamiento de todos los riesgos guardados antes de que esto existiera.
 * @param {{unit?:string, annual?:number}|null|undefined} raw
 * @returns {{unit:string, annual:number}}
 */
function normalizeExposure(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_EXPOSURE };
    if (!isValidUnit(raw.unit)) return { ...DEFAULT_EXPOSURE };
    const annual = typeof raw.annual === 'number' && Number.isFinite(raw.annual) && raw.annual > 0 ? raw.annual : null;
    // La unidad neutra ignora cualquier `annual` que llegue: "3 años al año" no significa nada, y
    // aceptarlo dejaría entrar un factor de escala silencioso sobre el TEF.
    if (raw.unit === 'anios') return { ...DEFAULT_EXPOSURE };
    if (annual === null) return { ...DEFAULT_EXPOSURE };
    return { unit: raw.unit, annual };
}

/**
 * Valida lo que llega por la API. Devuelve el mensaje de error, o null si es válido.
 *
 * Se rechaza una unidad no neutra SIN `annual`, en vez de caer al neutro en silencio: elegir
 * "viajes" y no decir cuántos hay al año es justo el dato que hace falta, y tragárselo convertiría
 * un riesgo por viaje en uno por año con el mismo número — un error de escala de tres órdenes de
 * magnitud que nadie vería.
 */
function validateExposure(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) return 'exposure debe ser un objeto o null.';
    if (!isValidUnit(value.unit)) {
        return `exposure.unit debe ser una de: ${Object.keys(EXPOSURE_UNITS).join(', ')}.`;
    }
    if (value.unit === 'anios') return null;
    if (typeof value.annual !== 'number' || !Number.isFinite(value.annual) || value.annual <= 0) {
        return `exposure.annual debe ser un número mayor que 0 cuando la unidad es "${value.unit}" (cuántas unidades hay al año).`;
    }
    return null;
}

/**
 * Tasa anual -> tasa por unidad de exposición. Con exposición 1 (años) devuelve lo mismo que
 * recibe, que es lo que hace que todo lo anterior siga funcionando sin tocarse.
 */
function perUnitRate(annualRate, exposure) {
    const exp = normalizeExposure(exposure);
    if (!Number.isFinite(annualRate) || exp.annual <= 0) return null;
    return annualRate / exp.annual;
}

/** Tasa por unidad -> tasa anual. La inversa exacta de perUnitRate. */
function annualRate(rate, exposure) {
    const exp = normalizeExposure(exposure);
    if (!Number.isFinite(rate)) return null;
    return rate * exp.annual;
}

/**
 * ¿Una observación en la unidad `observedUnit` se puede poner al lado de este riesgo?
 *
 * Antes esto era propiedad de la UNIDAD (`comparableConModelo`), lo que dejaba muertas seis de las
 * siete. Ahora es propiedad del PAR observación-riesgo, que es lo que de verdad decide:
 *
 *   - La unidad neutra (`anios`) siempre compara: el modelo es anual por construcción.
 *   - Cualquier otra compara si el riesgo declaró SU exposición en esa misma unidad.
 *
 * Comparar viajes contra bodegas-año sigue sin tener sentido, y eso no cambia — lo que cambia es
 * que ahora hay una manera de que un riesgo diga en qué unidad vive.
 */
function isComparable(observedUnit, riskExposure) {
    if (!isValidUnit(observedUnit)) return false;
    if (observedUnit === 'anios') return true;
    const exp = normalizeExposure(riskExposure);
    return exp.unit === observedUnit;
}

module.exports = {
    EXPOSURE_UNITS,
    DEFAULT_EXPOSURE,
    isValidUnit,
    normalizeExposure,
    validateExposure,
    perUnitRate,
    annualRate,
    isComparable,
};
