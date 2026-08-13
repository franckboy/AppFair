'use strict';

/**
 * Motor genérico de cadena de Markov sobre estados discretos — TODAVÍA NO conectado a ningún
 * endpoint ni al motor de simulación existente (ver simulation.js). Se agrega aparte, sin cablear
 * nada, como primer paso hacia simular el Árbol de Riesgos en Cascada (App.RiskCascadeTree,
 * frontend) de forma correlacionada: hoy ese árbol es puramente visual (ver el comentario en
 * risk-cascade-tree.js sobre por qué no se combina ningún ALE todavía — riesgo de doble conteo,
 * Broder 1984) y este motor es la pieza que faltaría para poder simular "dado que el riesgo padre
 * ocurrió en esta iteración, ¿se activó también el riesgo hijo en esa MISMA iteración?".
 *
 * Nota de modelado, a propósito de llamarlo "Markov": una cadena de Markov de libro elige UN
 * solo estado siguiente por cada paso (las probabilidades de salida suman como máximo 1). Acá
 * cada transición de salida se evalúa de forma INDEPENDIENTE de las demás (más parecido a un
 * "modelo de cascada independiente") — porque el Árbol de Riesgos ya permite que un mismo riesgo
 * padre tenga VARIOS hijos a la vez (ver buildForest/childrenOf en risk-cascade-tree.js: dos
 * riesgos distintos pueden declarar el mismo "Riesgo Desencadenante"), y en la vida real un mismo
 * evento sí puede disparar más de una consecuencia al mismo tiempo (ej. un incendio causa
 * interrupción operativa Y daño reputacional, no una u otra). La propiedad de Markov que sí se
 * conserva es la que importa acá: si un estado ya está activo, qué dispara desde ahí depende SOLO
 * de las transiciones de ESE estado, no de cómo se llegó hasta él.
 *
 * Desacoplado a propósito de cualquier estructura de datos concreta (no sabe qué es un "riesgo"
 * ni conoce el Registro) — `getTransitions(state)` es quien traduce un estado en sus salidas
 * posibles, así que conectarlo después a datos reales es responsabilidad de quien lo use, no de
 * este archivo.
 */

/**
 * Evalúa, una por una, las transiciones de salida desde el estado actual — cada una se activa o
 * no de forma independiente, comparando un número aleatorio nuevo contra su propia probabilidad.
 *
 * @param {Array<{state: string, probability: number}>} transitions Salidas posibles desde el
 *   estado actual, cada `probability` en [0, 1] — no hace falta que sumen 1 (ver nota de
 *   modelado arriba: no son mutuamente excluyentes).
 * @param {() => number} rng Generador de números aleatorios en [0, 1) — ej. mulberry32(seed) de
 *   random.js, para que la corrida sea reproducible con la misma semilla.
 * @returns {string[]} Los `state` que se activaron en esta pasada (puede ser ninguno, uno, o
 *   varios a la vez).
 */
function sampleActivatedTransitions(transitions, rng) {
    return (transitions || []).filter((t) => rng() < t.probability).map((t) => t.state);
}

/**
 * Recorre en cascada, nivel por nivel, todos los estados que se activan a partir de un estado
 * raíz YA activo — por cada estado recién activado, vuelve a evaluar SUS propias transiciones de
 * salida (sampleActivatedTransitions), y así sucesivamente, hasta que ninguna transición nueva se
 * dispara o se llega a `maxDepth`.
 *
 * Cada estado se activa como máximo una vez por corrida (ver `activated`, usado también para no
 * volver a visitarlo) — así un ciclo en los datos (A→B→A) no hace que esta función quede dando
 * vueltas para siempre; `maxDepth` es una segunda protección, por si el grafo tiene una cadena
 * genuinamente larga sin ciclos.
 *
 * @param {string|string[]} rootStates Estado(s) YA activo(s) desde donde arranca el recorrido.
 *   Se acepta una lista porque un estado puede volverse activo por su cuenta, sin que nadie lo
 *   haya disparado en cascada (ver los "auto-iniciadores" en cascadeSimulation.js: un riesgo con
 *   frecuencia propia puede ocurrir aunque su padre no ocurra ese año). Duplicados se ignoran.
 * @param {(state: string) => Array<{state: string, probability: number}>} getTransitions Dado un
 *   estado, devuelve sus transiciones de salida — quien llama decide de dónde salen esos datos.
 * @param {() => number} rng
 * @param {number} [maxDepth=20]
 * @returns {string[]} Todos los estados activados en esta corrida, en el orden en que se
 *   activaron — los `rootStates` siempre van primero, en el orden recibido.
 */
function walkMarkovChain(rootStates, getTransitions, rng, maxDepth = 20) {
    const roots = Array.isArray(rootStates) ? rootStates : [rootStates];
    const activated = [];
    const seen = new Set();
    roots.forEach((state) => {
        if (seen.has(state)) return;
        seen.add(state);
        activated.push(state);
    });
    let frontier = [...activated];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
        const nextFrontier = [];
        for (const state of frontier) {
            const transitions = getTransitions(state);
            const newlyActivated = sampleActivatedTransitions(transitions, rng).filter((s) => !seen.has(s));
            newlyActivated.forEach((s) => {
                seen.add(s);
                activated.push(s);
                nextFrontier.push(s);
            });
        }
        frontier = nextFrontier;
        depth += 1;
    }

    return activated;
}

module.exports = { sampleActivatedTransitions, walkMarkovChain };
