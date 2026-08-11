'use strict';

const { tullockSuccessProbability } = require('./autocalc');

// Rango de esfuerzo permitido para cada lado — mismo 0-100 que el resto de la app usa para
// puntajes de perfil, aunque conceptualmente "esfuerzo" (una elección del jugador) es distinto
// de "fuerza" (un atributo fijo del perfil, ver tullockSuccessProbability): un esfuerzo óptimo
// que "querría" superar 100 simplemente queda en el borde, que sigue siendo el óptimo
// restringido correcto mientras la ganancia sea monótona cerca del borde.
const MAX_EFFORT = 100;
const TERNARY_TOLERANCE = 0.01;
const TERNARY_MAX_ITERATIONS = 200;
const BEST_RESPONSE_MAX_ITERATIONS = 200;
const CONVERGENCE_TOLERANCE = 0.01;

/** Ganancia neta del Atacante: valor esperado del botín menos el costo de su propio esfuerzo. */
function attackerPayoff(a, d, m, valueAtStake, costAttacker) {
    return tullockSuccessProbability(a, d, m) * valueAtStake - costAttacker * a;
}

/** Pérdida esperada de la Defensa MÁS el costo de su propio esfuerzo — esto es lo que minimiza. */
function defenseLoss(a, d, m, valueAtStake, costDefense) {
    return tullockSuccessProbability(a, d, m) * valueAtStake + costDefense * d;
}

/**
 * Encuentra el x en [lo, hi] que MAXIMIZA f(x), asumiendo f unimodal (un solo máximo interior o
 * en el borde) en ese intervalo — cierto para la ganancia del Atacante/Defensa con Tullock de m
 * moderado (ver la nota de concavidad en solveNashEquilibrium). Método de libro de texto: reduce
 * el intervalo a un tercio en cada paso comparando dos puntos internos.
 */
function ternarySearchMax(f, lo, hi, tolerance = TERNARY_TOLERANCE, maxIterations = TERNARY_MAX_ITERATIONS) {
    for (let i = 0; i < maxIterations && hi - lo > tolerance; i++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (f(m1) < f(m2)) lo = m1;
        else hi = m2;
    }
    return (lo + hi) / 2;
}

function ternarySearchMin(f, lo, hi, tolerance = TERNARY_TOLERANCE, maxIterations = TERNARY_MAX_ITERATIONS) {
    return ternarySearchMax((x) => -f(x), lo, hi, tolerance, maxIterations);
}

/**
 * Equilibrio de Nash del juego de contienda de Tullock entre Atacante y Defensa: el par de
 * esfuerzos (a*, d*) donde ninguno de los dos puede mejorar su propio resultado cambiando SOLO
 * su propia jugada — a diferencia de Tullock solo (tullockSuccessProbability), que responde
 * "dado un esfuerzo fijo, quién gana", esto responde "qué esfuerzo es racional invertir para
 * cada lado, dado cuánto vale lo que está en juego y cuánto cuesta invertir esfuerzo".
 *
 * No hay fórmula cerrada para `m` arbitrario — se resuelve por iteración de mejor-respuesta
 * (best-response dynamics): en cada ronda, el Atacante encuentra su esfuerzo óptimo ASUMIENDO
 * fijo el esfuerzo actual de la Defensa (vía búsqueda ternaria), y luego la Defensa encuentra el
 * suyo asumiendo fijo el nuevo esfuerzo del Atacante. Se repite hasta que ambos dejan de cambiar
 * o se agota el límite de iteraciones.
 *
 * Limitación conocida (no resuelta aquí, documentada como tal en vez de ocultada): la búsqueda
 * ternaria asume que cada ganancia es cóncava en el propio esfuerzo — cierto para Tullock con
 * `m` moderado, pero la literatura de contiendas de Tullock documenta que valores altos de `m`
 * pueden romper esa concavidad (el equilibrio en estrategias puras puede no existir o ser
 * inestable). No se rechaza un `m` alto, pero si la iteración no converge se reporta
 * honestamente (`converged: false`) en vez de devolver un número con falsa certeza.
 *
 * @param {Object} params
 * @param {number} [params.m=1] Factor de decisividad de Tullock — independiente del `m` fijo
 *   (TULLOCK_M) que usa el cálculo automático de Vulnerabilidad en autocalc.js.
 * @param {number} params.valueAtStake Valor en juego (V) — típicamente la suma de Magnitud de
 *   Pérdida "Más Probable" de las 9 categorías del riesgo.
 * @param {number} params.costAttacker Costo por unidad de esfuerzo del Atacante.
 * @param {number} params.costDefense Costo por unidad de esfuerzo de la Defensa.
 * @param {number} [params.maxIterations=200]
 * @returns {{attackerEffort:number, defenseEffort:number, equilibriumVulnerability:number,
 *   attackerPayoff:number, defenseLoss:number, converged:boolean, iterations:number}}
 *   `equilibriumVulnerability` es un decimal en [0,1].
 */
function solveNashEquilibrium({
    m = 1,
    valueAtStake,
    costAttacker,
    costDefense,
    maxIterations = BEST_RESPONSE_MAX_ITERATIONS,
}) {
    let a = MAX_EFFORT / 2;
    let d = MAX_EFFORT / 2;
    let converged = false;
    let iterations = 0;

    for (; iterations < maxIterations; iterations++) {
        const newA = ternarySearchMax((x) => attackerPayoff(x, d, m, valueAtStake, costAttacker), 0, MAX_EFFORT);
        const newD = ternarySearchMin((x) => defenseLoss(newA, x, m, valueAtStake, costDefense), 0, MAX_EFFORT);
        const delta = Math.max(Math.abs(newA - a), Math.abs(newD - d));
        a = newA;
        d = newD;
        if (delta < CONVERGENCE_TOLERANCE) {
            converged = true;
            iterations += 1;
            break;
        }
    }

    return {
        attackerEffort: a,
        defenseEffort: d,
        equilibriumVulnerability: tullockSuccessProbability(a, d, m),
        attackerPayoff: attackerPayoff(a, d, m, valueAtStake, costAttacker),
        defenseLoss: defenseLoss(a, d, m, valueAtStake, costDefense),
        converged,
        iterations,
    };
}

module.exports = { attackerPayoff, defenseLoss, solveNashEquilibrium };
