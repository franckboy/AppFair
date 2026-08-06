'use strict';

/**
 * Motor genérico de red bayesiana sobre variables discretas — TODAVÍA NO conectado a ningún
 * endpoint ni al motor de simulación existente (mismo criterio que markov.js: pieza aislada,
 * primero se construye y se prueba sola, después se decide cómo conectarla).
 *
 * Pensado como paso futuro para el autocálculo de Vulnerabilidad (ver
 * backend/src/lib/autocalc.js, calculateVulnerability): hoy esa función es una fórmula fija —
 * mismo Perfil de Atacante + mismo Nivel de Defensa siempre dan exactamente el mismo resultado.
 * Los perfiles NO se tocarían — seguirían siendo los nodos padre, con sus valores curados de
 * siempre (ver profiles.js) — lo que se volvería ajustable es la tabla que traduce esa
 * combinación en Vulnerabilidad, incorporando el histórico real del Registro como evidencia. Sin
 * evidencia (organización nueva, Registro vacío), el resultado es idéntico al de hoy.
 *
 * Inferencia por MUESTREO PONDERADO ("likelihood weighting"), no exacta (eliminación de
 * variables/árbol de unión) — se eligió a propósito por dos razones: (1) es mucho más simple de
 * implementar bien, con menos superficie para un bug sutil de matemática que un algoritmo exacto;
 * (2) encaja con el mismo espíritu que el motor Monte Carlo que ya corre en simulation.js —
 * "simular muchas veces y quedarte con lo que es consistente con la evidencia", en vez de una
 * maquinaria de inferencia completamente distinta a la que ya usa el resto de la app.
 *
 * Un nodo: { name, states: string[], parents: string[], cpt: { [claveDePadres]: { [estado]:
 * probabilidad } } } — `claveDePadres` es los valores de los nodos padre (en el mismo orden que
 * `parents`) unidos con '|'; un nodo raíz (sin padres) usa la clave '' (string vacío).
 *
 * Precondición de quien arma la red: `nodes` debe venir en orden topológico (cada nodo después de
 * TODOS sus padres) — este módulo no ordena el grafo por vos, para no sumar esa complejidad a
 * algo que, en la práctica, quien construye la red ya arma en el orden correcto (ver la nota
 * sobre por qué markov.js tampoco resuelve esto por su cuenta).
 */

/** Arma la clave de una fila de la tabla a partir de los valores (ya conocidos) de los padres. */
function cptKey(parentValues) {
    return parentValues.join('|');
}

/**
 * Muestrea un estado de una distribución discreta — recorre los estados en el orden en que
 * aparecen en `distribution` acumulando probabilidad, y se queda con el primero cuyo acumulado
 * supere `rng()`. El último estado es el respaldo final (por si la suma de probabilidades no da
 * EXACTO 1.0 por redondeo de punto flotante, o levemente menos por error de captura de datos).
 *
 * @param {{[state: string]: number}} distribution
 * @param {() => number} rng
 * @returns {string}
 */
function sampleFromDistribution(distribution, rng) {
    const roll = rng();
    let cumulative = 0;
    const states = Object.keys(distribution);
    for (const state of states) {
        cumulative += distribution[state];
        if (roll < cumulative) return state;
    }
    return states[states.length - 1];
}

/**
 * Busca, dentro de la CPT de un nodo, la fila que corresponde a los valores YA ASIGNADOS de sus
 * padres — si la combinación no está en la tabla (dato de calibración incompleto), revienta con
 * un error explícito en vez de devolver `undefined` y fallar más adelante de forma confusa.
 */
function getRow(node, assignment) {
    const key = cptKey(node.parents.map((p) => assignment[p]));
    const row = node.cpt[key];
    if (!row) {
        throw new Error(`Red bayesiana: falta la fila "${key}" en la tabla del nodo "${node.name}".`);
    }
    return row;
}

/**
 * Genera UNA asignación completa de estados para todos los nodos, muestreando cada uno según su
 * propia tabla dada los valores (ya muestreados) de sus padres — "un mundo hipotético posible".
 * Es el paso base sobre el que se construye la inferencia por muestreo ponderado de abajo.
 *
 * @param {Array<{name: string, states: string[], parents: string[], cpt: Object}>} nodes En orden
 *   topológico — ver la nota del archivo.
 * @param {() => number} rng
 * @returns {{[nodeName: string]: string}}
 */
function forwardSample(nodes, rng) {
    const assignment = {};
    for (const node of nodes) {
        assignment[node.name] = sampleFromDistribution(getRow(node, assignment), rng);
    }
    return assignment;
}

/**
 * Una pasada de muestreo ponderado ("likelihood weighting"): los nodos con un valor conocido en
 * `evidence` NO se muestrean — se fijan directo a ese valor, y el "peso" de esta pasada se
 * multiplica por qué tan probable era, según su propia tabla, que ese nodo diera justo ese valor
 * (dados sus padres). Los nodos sin evidencia se muestrean normal. El peso final indica qué tan
 * consistente resultó esta pasada completa con lo que de verdad se observó.
 *
 * @param {Array<Object>} nodes
 * @param {{[nodeName: string]: string}} evidence
 * @param {() => number} rng
 * @returns {{assignment: {[nodeName: string]: string}, weight: number}}
 */
function likelihoodWeightedSample(nodes, evidence, rng) {
    const assignment = {};
    let weight = 1;
    for (const node of nodes) {
        const row = getRow(node, assignment);
        if (Object.prototype.hasOwnProperty.call(evidence, node.name)) {
            const observed = evidence[node.name];
            assignment[node.name] = observed;
            weight *= row[observed] || 0;
        } else {
            assignment[node.name] = sampleFromDistribution(row, rng);
        }
    }
    return { assignment, weight };
}

/**
 * Estima P(queryNode | evidence) corriendo muchas pasadas de likelihoodWeightedSample y
 * acumulando, para cada estado del nodo consultado, la suma de pesos de las pasadas donde salió
 * ese estado — al final se normaliza (se divide entre la suma total de pesos) para que la
 * distribución resultante sume 1. Es una ESTIMACIÓN (mejora con más `numSamples`), no un cálculo
 * exacto — coherente con que el resto del motor de esta app tampoco calcula nada en forma
 * cerrada, todo es Monte Carlo.
 *
 * @param {Array<Object>} nodes
 * @param {string} queryNode Nombre del nodo cuya distribución posterior se quiere conocer.
 * @param {{[nodeName: string]: string}} evidence
 * @param {number} numSamples
 * @param {() => number} rng
 * @returns {{[state: string]: number}} Distribución posterior, normalizada a sumar 1 — o `null`
 *   si ninguna pasada tuvo peso > 0 (evidencia incompatible con la red: probabilidad total 0).
 */
function inferPosterior(nodes, queryNode, evidence, numSamples, rng) {
    const totals = {};
    let totalWeight = 0;

    for (let i = 0; i < numSamples; i++) {
        const { assignment, weight } = likelihoodWeightedSample(nodes, evidence, rng);
        if (weight === 0) continue;
        const state = assignment[queryNode];
        totals[state] = (totals[state] || 0) + weight;
        totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    const posterior = {};
    Object.keys(totals).forEach((state) => {
        posterior[state] = totals[state] / totalWeight;
    });
    return posterior;
}

module.exports = { cptKey, sampleFromDistribution, forwardSample, likelihoodWeightedSample, inferPosterior };
