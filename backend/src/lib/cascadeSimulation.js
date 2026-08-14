'use strict';

const { runMonteCarloSimulation } = require('./simulation');
const { walkMarkovChain } = require('./markov');
const { mulberry32 } = require('./random');

// Tope defensivo al tamaño de un subárbol simulable — mismo espíritu que MAX_ITERATIONS en
// validate.js: nada en la app hoy construye árboles así de grandes (son creados a mano, riesgo
// por riesgo, desde el botón "+"), esto solo evita que una petición manual/scripted pida simular
// una familia gigantesca por accidente o a propósito.
const MAX_FAMILY_SIZE = 100;

/**
 * Arma el subárbol de riesgos que cuelgan de `rootRiskName` vía `triggeredBy` — mismo patrón que
 * App.RiskCascadeTree.buildGraph() en el frontend (risk-cascade-tree.js), pero acotado a UN solo
 * subárbol (el que cuelga de la raíz elegida), no todo el grafo del Registro.
 *
 * Un riesgo puede tener MÁS DE UNA causa (`triggeredBy` es un array) — dos padres distintos
 * pueden declarar genuinamente al mismo hijo, algo imposible cuando el vínculo era de un solo
 * valor. Por eso la membresía del subárbol (qué nodos caen bajo la raíz) y las aristas de
 * cascada (con qué probabilidad) se arman en DOS pasadas separadas: la primera solo determina
 * QUÉ nodos son alcanzables (con `visited` para no reprocesar uno ya visto, tolerando un ciclo
 * en los datos — el vínculo se guarda por nombre, sin validar que no cierre un ciclo al
 * guardarlo); la segunda arma las aristas finales filtrando a que AMBOS extremos hayan quedado
 * dentro del subárbol ya resuelto. Un padre FUERA del subárbol simulado (la raíz elegida no es
 * su descendiente) simplemente no aporta ninguna arista — "Simular Familia" es, por diseño, una
 * vista acotada a la raíz elegida, no un Monte Carlo del Registro completo.
 *
 * @param {string} rootRiskName
 * @param {Array<Object>} register Todo el Registro (state.fair.riskRegister / store.riskRegister)
 * @returns {{ order: string[], childrenOf: Map<string, Array<{riskName: string, probability: number|null}>>, byName: Map<string, Object> }}
 */
function buildFamilySubtree(rootRiskName, register) {
    const byName = new Map(register.map((r) => [r.riskName, r]));

    // Grafo COMPLETO padre→hijos (con la probabilidad de cada arista), armado ANTES de saber
    // qué subárbol se recorre — un mismo riesgo puede aparecer bajo varios padres a la vez.
    const childrenByParent = new Map();
    register.forEach((r) => {
        (r.triggeredBy || []).forEach(({ riskName: parentName, probability }) => {
            if (!parentName || parentName === r.riskName || !byName.has(parentName)) return;
            if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
            childrenByParent.get(parentName).push({ riskName: r.riskName, probability });
        });
    });

    const order = [];
    const visited = new Set();
    const stack = [rootRiskName];
    while (stack.length > 0) {
        const name = stack.pop();
        if (visited.has(name)) continue;
        visited.add(name);
        order.push(name);
        (childrenByParent.get(name) || []).forEach((c) => {
            if (!visited.has(c.riskName)) stack.push(c.riskName);
        });
    }

    const childrenOf = new Map();
    order.forEach((name) => {
        const kids = (childrenByParent.get(name) || []).filter((c) => visited.has(c.riskName));
        if (kids.length) childrenOf.set(name, kids);
    });

    return { order, childrenOf, byName };
}

/**
 * Simula la pérdida anual combinada de una familia de riesgos en cascada — la raíz elegida más
 * todos sus descendientes vía `triggeredBy` — de forma CORRELACIONADA: en cada iteración Monte
 * Carlo, un riesgo hijo solo se cuenta si se "activó" esa misma iteración, ya sea porque alguno
 * de sus padres activos lo disparó (`triggeredBy[].probability`) o porque le tocaba ocurrir de
 * todos modos (su propia frecuencia). Ver el comentario de diseño completo en markov.js y junto a
 * `combinedProbability` más abajo (caso de múltiples padres).
 *
 * No modifica el cálculo individual de ningún riesgo — cada riesgo `analizado` se re-simula con
 * runMonteCarloSimulation() exactamente como ya lo hace App.FairRegister.simulateRegisteredRisk
 * en el frontend (mismos tef/vuln/lossMagnitudes guardados), esto solo agrega una capa nueva
 * encima: sumar sus resultados iteración por iteración, condicionado a si cada uno se activó.
 *
 * @param {Object} params
 * @param {string} params.rootRiskName
 * @param {Array<Object>} params.register Todo el Registro
 * @param {number} params.iterations
 * @param {number} params.seed 0 = aleatoria
 * @returns {{
 *   familyAnnualLosses: number[],
 *   usedSeed: number,
 *   familySize: number,
 *   includedRiskNames: string[],
 *   excludedRiskNames: Array<{riskName: string, reason: string}>,
 *   activationRates: Object<string, number>,
 * }}
 */
function runFamilyCascadeSimulation({ rootRiskName, register, iterations, seed }) {
    const { order, childrenOf, byName } = buildFamilySubtree(rootRiskName, register);

    if (order.length > MAX_FAMILY_SIZE) {
        const err = new Error(`La familia tiene ${order.length} riesgos — el máximo simulable es ${MAX_FAMILY_SIZE}.`);
        err.code = 'FAMILY_TOO_LARGE';
        throw err;
    }

    const usedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
    const masterRng = mulberry32(usedSeed);

    // Cada riesgo `analizado` se re-simula con SU PROPIA sub-semilla, derivada del master rng en
    // un orden estable (el de `order`, que es determinista para un mismo Registro) — así toda la
    // corrida de familia es reproducible con `usedSeed`, sin que dos riesgos distintos compartan
    // el mismo stream de aleatoriedad (que los correlacionaría de una forma no intencional).
    const perRisk = new Map(); // riskName -> { annualLosses, lefSamples, magnitudeSamples }
    const excludedRiskNames = [];

    order.forEach((name) => {
        const risk = byName.get(name);
        const subSeed = Math.floor(masterRng() * 2147483647) || 1;
        if (!risk || !risk.tef || !risk.vuln || !risk.lossMagnitudes) {
            excludedRiskNames.push({ riskName: name, reason: 'Sin analizar (falta FAIR completo)' });
            return;
        }
        if (risk.riskType === 'oportunidad') {
            excludedRiskNames.push({ riskName: name, reason: 'Oportunidad (no se combina con pérdidas de amenazas)' });
            return;
        }
        const sim = runMonteCarloSimulation({
            iterations,
            seed: subSeed,
            tef: risk.tef,
            vuln: risk.vuln,
            lossMagnitudes: risk.lossMagnitudes,
        });
        perRisk.set(name, {
            annualLosses: sim.annualLosses,
            lefSamples: sim.lefSamples,
            magnitudeSamples: sim.magnitudeSamples,
        });
    });

    const includedRiskNames = [...perRisk.keys()];
    const activationCounts = new Map(order.map((n) => [n, 0]));

    // Un riesgo que NO es la raíz se activa en una iteración si ocurre POR SU CUENTA
    // (P_propia) o si alguno de sus padres activos lo dispara en cascada (P_cascada) — la
    // combinación de ambas vías da 1 − (1−P_propia)×Π(1−P_cascada_i).
    //
    // Las dos vías se evalúan en momentos distintos, y eso es lo que hace que el resultado sea
    // correcto a CUALQUIER profundidad del árbol:
    //
    //   1. P_propia se tira UNA sola vez por riesgo por iteración, ANTES de recorrer la cascada
    //      (ver `selfStarters` abajo). Los riesgos que salen sorteados entran al recorrido como
    //      puntos de partida adicionales, junto a la raíz. P_propia convierte la tasa LEF de ESA
    //      iteración en "probabilidad de al menos un evento este año" (proceso de Poisson:
    //      1 − e^(−LEF)); un riesgo sin FAIR propio (excluido) no tiene LEF, así que su P_propia
    //      es 0 y solo puede activarse por cascada.
    //
    //      Bug real corregido: antes P_propia se evaluaba DENTRO del recorrido, mezclada en la
    //      misma compuerta que P_cascada — o sea, solo si el padre ya se había activado. La raíz
    //      siempre está activa, así que sus hijos DIRECTOS quedaban bien, pero de la segunda
    //      generación en adelante la frecuencia propia se perdía por completo cuando el padre no
    //      ocurría: un nieto con ALE propio de $1,000,000/año aportaba ~$0 a la familia
    //      (activación medida: 0.005% en vez del ~63% que le corresponde por 1−e^(−1)). El error
    //      iba siempre hacia SUBESTIMAR el riesgo, y era peor mientras más profundo el árbol.
    //
    //   2. P_cascada se evalúa arista por arista durante el recorrido. Con múltiples padres, un
    //      mismo hijo recibe un intento por cada padre activo esa vuelta; como cada intento es
    //      una prueba de Bernoulli independiente contra rng(), "se activó en cualquiera de los
    //      intentos" ya da 1 − Π(1−P_cascada_i) sin tocar el motor de markov.js.
    //
    // Sacar P_propia del recorrido también elimina, por construcción, el riesgo de que se cuente
    // más de una vez cuando un hijo tiene varios padres (antes hacía falta llevar esa cuenta a
    // mano con un Set por iteración).
    const ownProbability = (riskName, iterationIndex) => {
        const analyzed = perRisk.get(riskName);
        if (!analyzed) return 0;
        return Math.max(0, Math.min(1, 1 - Math.exp(-Math.max(0, analyzed.lefSamples[iterationIndex]))));
    };

    // La raíz nunca entra acá: walkMarkovChain siempre la incluye, y su annualLosses[i] ya lleva
    // su propia frecuencia (ver el reparto de pérdidas más abajo).
    const selfStartCandidates = order.filter((name) => name !== rootRiskName);

    const getTransitions = (nodeName) =>
        (childrenOf.get(nodeName) || []).map((c) => ({
            state: c.riskName,
            probability: Math.max(0, Math.min(1, (c.probability ?? 0) / 100)),
        }));

    const familyAnnualLosses = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        // Se consume un número aleatorio por candidato SIEMPRE (aunque su P_propia sea 0), para
        // que el stream del rng no dependa de qué riesgos tengan FAIR completo — así la corrida
        // sigue siendo reproducible con la misma semilla.
        const selfStarters = selfStartCandidates.filter((name) => masterRng() < ownProbability(name, i));

        // Bug real corregido: la raíz entraba al recorrido SIEMPRE, así que propagaba a sus hijos
        // los 10.000 años, no solo aquellos en que de verdad ocurría. Con una raíz de LEF≈0.87
        // (ocurre el 56% de los años) y una compuerta al hijo del 70%, el hijo recibía 0.70
        // activaciones por cascada al año en vez de 0.70 x 0.565 = 0.395 — un 77% de más. Era
        // además incoherente consigo mismo: la PÉRDIDA de la raíz sí estaba escalada por su LEF
        // (annualLosses[i]), pero su PROPAGACIÓN no.
        //
        // Ahora la raíz pasa por la misma compuerta de ocurrencia que cualquier auto-iniciador.
        // Su pérdida se sigue sumando SIEMPRE y sin condicionar: annualLosses[i] es LEF×Magnitud,
        // una esperanza anual que ya lleva su frecuencia dentro — condicionarla la descontaría
        // dos veces, el mismo error que este archivo ya documenta para los hijos.
        // Se consume el número aleatorio SIEMPRE, aunque la raíz no tenga FAIR, para que el stream
        // no dependa de qué riesgos estén analizados (mismo criterio que los auto-iniciadores).
        const rootRoll = masterRng();
        // Una raíz SIN análisis FAIR no tiene frecuencia sobre la que condicionar. En ese caso
        // propaga siempre: negarle la propagación devolvería ceros y dejaría inservible "Simular
        // Familia" justo en el caso en que más se usa — un riesgo recién creado desde el árbol,
        // todavía sin analizar, del que cuelga una familia ya modelada. Su propia pérdida es 0 de
        // todas formas (no tiene magnitud), así que solo aporta la estructura de cascada.
        const rootOccurs = !perRisk.has(rootRiskName) || rootRoll < ownProbability(rootRiskName, i);
        const startStates = rootOccurs ? [rootRiskName, ...selfStarters] : selfStarters;
        const activatedNames = walkMarkovChain(startStates, getTransitions, masterRng);

        const rootAnalyzed = perRisk.get(rootRiskName);
        let total = rootAnalyzed ? rootAnalyzed.annualLosses[i] : 0;
        if (rootOccurs) activationCounts.set(rootRiskName, activationCounts.get(rootRiskName) + 1);

        activatedNames.forEach((name) => {
            // La raíz ya se contó arriba (pérdida y activación): saltarla evita duplicar ambas.
            if (name === rootRiskName) return;
            activationCounts.set(name, activationCounts.get(name) + 1);
            const analyzed = perRisk.get(name);
            if (!analyzed) return;
            // Un riesgo activado sí pasó por una compuerta que ya "gastó" su
            // propio lef_i para decidir si el evento ocurrió este año (sea como auto-iniciador
            // vía ownProbability, o por cascada desde un padre activo); sumar
            // analyzed.annualLosses[i] aquí volvería a multiplicar por ese mismo lef_i — la
            // frecuencia se descontaría dos veces, y para un riesgo raro pero severo (lef_i chico,
            // el perfil típico de un riesgo físico/patrimonial) el aporte queda subestimado en
            // órdenes de magnitud (verificado: un hijo con LEF≈0.05-0.2 y magnitud fija de
            // $1,000,000 aportaba ~$2,000/año en vez de los ~$43,000/año que le corresponden).
            // Una vez que la compuerta ya decidió "sí ocurrió", lo que corresponde sumar es la
            // magnitud de ESE evento (magnitudeSamples[i]), no la magnitud vuelta a escalar por
            // la misma frecuencia que decidió que ocurriera.
            total += analyzed.magnitudeSamples[i];
        });
        familyAnnualLosses[i] = total;
    }

    const activationRates = {};
    order.forEach((name) => {
        activationRates[name] = (activationCounts.get(name) / iterations) * 100;
    });

    return {
        familyAnnualLosses,
        usedSeed,
        familySize: order.length,
        includedRiskNames,
        excludedRiskNames,
        activationRates,
    };
}

module.exports = { buildFamilySubtree, runFamilyCascadeSimulation, MAX_FAMILY_SIZE };
