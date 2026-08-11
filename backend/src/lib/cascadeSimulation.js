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
 * Arma el subárbol de riesgos que cuelgan de `rootRiskName` vía `triggeredByRiskName` — mismo
 * patrón que App.RiskCascadeTree.buildForest() en el frontend (risk-cascade-tree.js), pero
 * acotado a UN solo árbol (el que cuelga de la raíz elegida), no todo el bosque del Registro.
 *
 * `visited` protege contra un ciclo en los datos (A desencadena B, B desencadena A) — un ciclo
 * indirecto entre riesgos guardados en momentos distintos es posible (el vínculo se guarda por
 * nombre, sin validar que no cierre un ciclo al guardarlo), así que hay que tolerarlo sin quedar
 * dando vueltas para siempre.
 *
 * @param {string} rootRiskName
 * @param {Array<Object>} register Todo el Registro (state.fair.riskRegister / store.riskRegister)
 * @returns {{ order: string[], childrenOf: Map<string, Array<Object>>, byName: Map<string, Object> }}
 */
function buildFamilySubtree(rootRiskName, register) {
    const byName = new Map(register.map((r) => [r.riskName, r]));
    const childrenByParent = new Map();
    register.forEach((r) => {
        if (!r.triggeredByRiskName || r.triggeredByRiskName === r.riskName) return;
        if (!childrenByParent.has(r.triggeredByRiskName)) childrenByParent.set(r.triggeredByRiskName, []);
        childrenByParent.get(r.triggeredByRiskName).push(r);
    });

    const order = [];
    const visited = new Set();
    const childrenOf = new Map();
    const stack = [rootRiskName];
    while (stack.length > 0) {
        const name = stack.pop();
        if (visited.has(name)) continue;
        visited.add(name);
        order.push(name);
        const kids = (childrenByParent.get(name) || []).filter((c) => !visited.has(c.riskName));
        childrenOf.set(
            name,
            kids.map((c) => c.riskName),
        );
        kids.forEach((c) => stack.push(c.riskName));
    }

    return { order, childrenOf, byName };
}

/**
 * Simula la pérdida anual combinada de una familia de riesgos en cascada — la raíz elegida más
 * todos sus descendientes vía `triggeredByRiskName` — de forma CORRELACIONADA: en cada iteración
 * Monte Carlo, un riesgo hijo solo se cuenta si se "activó" esa misma iteración, ya sea porque el
 * padre lo disparó (`triggeredByProbability`) o porque le tocaba ocurrir de todos modos (su propia
 * frecuencia). Ver el comentario de diseño completo en markov.js y en el plan de esta tarea.
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

    // P(activado en esta iteración) para un riesgo que NO es la raíz: 1 − (1−P_cascada)×(1−P_propia).
    // P_cascada sale del dato ya capturado en el botón "+" (triggeredByProbability, 0-100%);
    // P_propia sale de convertir la tasa LEF de ESA iteración en "probabilidad de al menos un
    // evento este año" (proceso de Poisson: 1 − e^(−LEF)) — un riesgo sin FAIR propio (excluido)
    // no tiene LEF, así que su P_propia es 0 (solo puede activarse por cascada).
    const combinedProbability = (childRisk, iterationIndex) => {
        const pCascade = Math.max(0, Math.min(1, (childRisk.triggeredByProbability ?? 0) / 100));
        const analyzed = perRisk.get(childRisk.riskName);
        const pOwn = analyzed ? 1 - Math.exp(-Math.max(0, analyzed.lefSamples[iterationIndex])) : 0;
        return Math.max(0, Math.min(1, 1 - (1 - pCascade) * (1 - pOwn)));
    };

    const familyAnnualLosses = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        const getTransitions = (nodeName) =>
            (childrenOf.get(nodeName) || []).map((childName) => ({
                state: childName,
                probability: combinedProbability(byName.get(childName), i),
            }));
        const activatedNames = walkMarkovChain(rootRiskName, getTransitions, masterRng);

        let total = 0;
        activatedNames.forEach((name) => {
            activationCounts.set(name, activationCounts.get(name) + 1);
            const analyzed = perRisk.get(name);
            if (!analyzed) return;
            // La raíz nunca pasa por combinedProbability (walkMarkovChain siempre la incluye) —
            // su annualLosses[i] (LEF×Magnitud, el mismo cálculo actuarial de siempre) es lo
            // correcto tal cual. Un riesgo NO-raíz sí pasó por una compuerta que ya "gastó" su
            // propio lef_i para decidir si el evento ocurrió este año (pOwn arriba); sumar
            // analyzed.annualLosses[i] aquí volvería a multiplicar por ese mismo lef_i — la
            // frecuencia se descontaría dos veces, y para un riesgo raro pero severo (lef_i chico,
            // el perfil típico de un riesgo físico/patrimonial) el aporte queda subestimado en
            // órdenes de magnitud (verificado: un hijo con LEF≈0.05-0.2 y magnitud fija de
            // $1,000,000 aportaba ~$2,000/año en vez de los ~$43,000/año que le corresponden).
            // Una vez que la compuerta ya decidió "sí ocurrió", lo que corresponde sumar es la
            // magnitud de ESE evento (magnitudeSamples[i]), no la magnitud vuelta a escalar por
            // la misma frecuencia que decidió que ocurriera.
            total += name === rootRiskName ? analyzed.annualLosses[i] : analyzed.magnitudeSamples[i];
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
