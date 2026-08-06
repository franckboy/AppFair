'use strict';

/**
 * Motor genérico de árbol de decisión (análisis de decisiones — nodos de decisión/azar/resultado,
 * NO el clasificador de machine learning que también se llama "decision tree") sobre estructuras
 * arbitrarias — TODAVÍA NO conectado a ningún endpoint (mismo criterio que markov.js y
 * bayesianNetwork.js: pieza aislada primero, se conecta después).
 *
 * Pensado como paso futuro para App.Treatment / evaluateTreatmentStrategies (ver
 * backend/src/lib/treatment.js): cada estrategia (Mitigar/Transferir/Evitar) ya guarda un campo
 * `reliability` (Alta/Media/Baja), pero hoy SOLO dispara un texto de advertencia ("⚠️ Fiabilidad
 * Baja") — el cálculo de "beneficio neto" en sí (avoidedLoss - cost) es un número fijo que no usa
 * ese dato para nada. Con este motor, `reliability` pasaría a ser la probabilidad de un nodo de
 * azar ("¿el control funciona?"), y el beneficio neto de cada estrategia sería un VALOR ESPERADO
 * bajo esa incertidumbre, no un número de un solo punto — mismo criterio que ya usan Markov (para
 * el Árbol de Riesgos) y la red bayesiana (para Vulnerabilidad): usar un dato que la app ya
 * captura pero hoy solo muestra como texto.
 *
 * Tres tipos de nodo:
 *   - `{ type: 'terminal', value: number }` — una hoja, el resultado final de esa rama.
 *   - `{ type: 'chance', branches: [{ probability, node }, ...] }` — un evento incierto (nadie
 *     elige, lo decide el azar) — su valor es el promedio ponderado por probabilidad de sus ramas
 *     (valor esperado).
 *   - `{ type: 'decision', options: [{ label, node }, ...] }` — un punto donde SÍ se elige — su
 *     valor es el de la MEJOR opción entre sus hijos (la de mayor valor esperado), y además
 *     reporta cuál se eligió.
 *
 * El algoritmo es "inducción hacia atrás" (rollback): se evalúa el árbol desde las hojas hacia la
 * raíz — cada nodo necesita el valor YA calculado de sus hijos antes de poder calcular el propio.
 */

/**
 * Valor esperado de un nodo de azar: la suma de cada rama multiplicada por su probabilidad.
 * Función aparte y simple a propósito, para poder probarla sola sin construir un árbol completo.
 *
 * @param {Array<{probability: number, value: number}>} branches
 * @returns {number}
 */
function expectedValue(branches) {
    return branches.reduce((sum, b) => sum + b.probability * b.value, 0);
}

/** Revienta con un mensaje claro si las probabilidades de un nodo de azar no suman ~1 — un error
 * de captura silencioso acá (ej. reliability mal convertida a probabilidad) daría un valor
 * esperado incorrecto sin ningún aviso, más difícil de detectar que un error explícito acá mismo. */
function assertProbabilitiesSumToOne(branches, nodeLabel) {
    const total = branches.reduce((sum, b) => sum + b.probability, 0);
    if (Math.abs(total - 1) > 1e-9) {
        throw new Error(`Árbol de decisión: las probabilidades de "${nodeLabel}" suman ${total}, deberían sumar 1.`);
    }
}

/**
 * Evalúa un árbol (o subárbol) completo por inducción hacia atrás — recorre hasta las hojas y
 * calcula hacia arriba, así que cada nodo ya tiene el valor de sus hijos antes de necesitarlo.
 *
 * @param {Object} node Nodo raíz del árbol/subárbol a evaluar (terminal, chance, o decision).
 * @returns {{value: number, bestOption?: string, options?: Array, branches?: Array}} `value` es
 *   el resultado de ESTE nodo. Para un nodo `decision`, además viene `bestOption` (el `label` de
 *   la opción elegida) y `options` (cada opción con su propio resultado evaluado, para poder
 *   comparar todas, no solo ver la ganadora). Para un nodo `chance`, además viene `branches` (cada
 *   rama con su propio resultado evaluado).
 */
function evaluateDecisionTree(node) {
    if (!node || typeof node.type !== 'string') {
        throw new Error('Árbol de decisión: cada nodo necesita un "type" (terminal, chance, o decision).');
    }

    if (node.type === 'terminal') {
        return { value: node.value };
    }

    if (node.type === 'chance') {
        if (!Array.isArray(node.branches) || node.branches.length === 0) {
            throw new Error('Árbol de decisión: un nodo "chance" necesita al menos una rama.');
        }
        const evaluatedBranches = node.branches.map((b) => ({
            probability: b.probability,
            ...evaluateDecisionTree(b.node),
        }));
        assertProbabilitiesSumToOne(evaluatedBranches, node.label || 'nodo de azar');
        return { value: expectedValue(evaluatedBranches), branches: evaluatedBranches };
    }

    if (node.type === 'decision') {
        if (!Array.isArray(node.options) || node.options.length === 0) {
            throw new Error('Árbol de decisión: un nodo "decision" necesita al menos una opción.');
        }
        const evaluatedOptions = node.options.map((o) => ({
            label: o.label,
            ...evaluateDecisionTree(o.node),
        }));
        const best = evaluatedOptions.reduce((max, o) => (o.value > max.value ? o : max), evaluatedOptions[0]);
        return { value: best.value, bestOption: best.label, options: evaluatedOptions };
    }

    throw new Error(`Árbol de decisión: tipo de nodo desconocido "${node.type}".`);
}

module.exports = { expectedValue, evaluateDecisionTree };
