'use strict';

const { runMonteCarloSimulation, summarizeLosses, buildLossExceedanceCurve } = require('./simulation');
const { mulberry32 } = require('./random');
const { walkMarkovChain } = require('./markov');
const { normalizeTriggeredBy } = require('./register');
const { sampleVulnerabilityFromProfiles } = require('./autocalc');
const { attackerProfiles, defenseProfiles } = require('../data/profiles');

/**
 * Simulación Monte Carlo ACOPLADA del portafolio completo.
 *
 * El problema que resuelve: hasta ahora el CVaR95 y el p90 del portafolio se obtenían SUMANDO los
 * de cada riesgo (`totalResidualCVaR += residualCVaR` en register.js). El ALE sí se puede sumar —la
 * esperanza es lineal— pero un percentil NO: `p90(X + Y) ≠ p90(X) + p90(Y)`.
 *
 * CVaR es una medida coherente, así que es SUBADITIVA: `CVaR(X+Y) ≤ CVaR(X) + CVaR(Y)`. Sumarlos
 * por tanto SOBRESTIMA la cola del portafolio, salvo que todos los riesgos se materialicen el mismo
 * año. El atajo era conservador, no peligroso, pero tenía un costo real de negocio: la app no podía
 * mostrar NINGÚN beneficio de diversificación, así que un portafolio de 20 riesgos independientes
 * aparecía con una cola tan gorda como si los 20 ocurrieran a la vez.
 *
 * La solución correcta es simular todos los riesgos a la vez y sumar POR ITERACIÓN: cada iteración
 * es "un año posible" del portafolio entero, y de esa distribución conjunta salen percentiles de
 * verdad.
 *
 * SUPUESTO DE INDEPENDENCIA — declarado, no escondido: cada riesgo se muestrea con su propia
 * semilla derivada, así que se asumen mutuamente independientes. Eso es lo que produce el beneficio
 * de diversificación, y es una hipótesis fuerte: dos riesgos que comparten causa (un apagón que
 * dispara robo Y parada de producción) están correlacionados y esta simulación los subestimaría.
 * El Árbol de Riesgos en Cascada (cascadeSimulation.js) ya modela esas dependencias explícitamente
 * y es la fuente natural de correlación para una versión futura; hasta entonces, la independencia
 * queda documentada como limitación conocida.
 */

const PORTFOLIO_ITERATIONS = 10000;
const PORTFOLIO_BASE_SEED = 20260813;

/**
 * Reconstruye el sampler de Vulnerabilidad de un riesgo guardado. Si tiene Perfil de Atacante y
 * Defensa, se usa la contienda calibrada (mismo camino que POST /api/simulate); si no, cae al
 * triángulo capturado a mano, que `runMonteCarloSimulation` ya sabe muestrear.
 */
function buildVulnSampler(risk) {
    if (risk.vulnManualOverride) return null;
    const attackerProfile = attackerProfiles[risk.attackerKey];
    const defenseProfile = defenseProfiles[risk.defenseKey];
    if (!attackerProfile || !defenseProfile) return null;
    return sampleVulnerabilityFromProfiles(
        attackerProfile,
        defenseProfile,
        risk.dataConfidence || 'medio',
        risk.accessLevel,
    );
}

/** Un riesgo solo entra a la simulación conjunta si trae los tres insumos que la alimentan. */
function hasCompleteInputs(risk) {
    return !!(risk && risk.tef && risk.vuln && risk.lossMagnitudes);
}

/**
 * @param {Array<Object>} risks Entradas del Registro (ver routes/register.js).
 * @param {Object} [options]
 * @param {number} [options.iterations=10000]
 * @param {number} [options.seed] Semilla base; fija por defecto para que el resultado sea
 *   reproducible entre corridas (una cifra de portafolio que baila sin que cambien los datos es
 *   imposible de auditar).
 * @returns {{summary:Object, lossExceedanceCurve:Array, includedCount:number, skippedCount:number,
 *   skippedRiskNames:string[], sumOfIndividualCVaR:number|null, diversificationBenefit:number|null}}
 */
function simulatePortfolio(risks, { iterations = PORTFOLIO_ITERATIONS, seed = PORTFOLIO_BASE_SEED } = {}) {
    const threats = (risks || []).filter((r) => r && r.riskType !== 'oportunidad');
    const usable = threats.filter(hasCompleteInputs);
    const skipped = threats.filter((r) => !hasCompleteInputs(r));

    if (usable.length === 0) {
        return {
            summary: null,
            lossExceedanceCurve: [],
            includedCount: 0,
            skippedCount: skipped.length,
            skippedRiskNames: skipped.map((r) => r.riskName),
            sumOfIndividualCVaR: null,
            diversificationBenefit: null,
        };
    }

    // Pérdida del portafolio por iteración: cada índice es "un año posible" vivido por TODOS los
    // riesgos a la vez. Sumar aquí (y no al final) es la diferencia entre un percentil real y la
    // suma de percentiles que se hacía antes.
    const portfolioLosses = new Array(iterations).fill(0);
    let sumOfIndividualCVaR = 0;

    // Dependencias declaradas por el usuario en el Árbol de Riesgos en Cascada. Cada arista dice
    // "si ocurre el padre, con esta probabilidad le sigue el hijo" — es la ÚNICA fuente de
    // correlación del portafolio, y viene de su criterio, no de un supuesto estadístico nuestro.
    const byName = new Map(usable.map((r) => [r.riskName, r]));
    const childrenOf = new Map();
    normalizeTriggeredBy(usable).forEach((risk) => {
        (risk.triggeredBy || []).forEach(({ riskName: parent, probability }) => {
            if (!byName.has(parent) || parent === risk.riskName) return;
            if (!childrenOf.has(parent)) childrenOf.set(parent, []);
            childrenOf.get(parent).push({
                state: risk.riskName,
                probability: Math.max(0, Math.min(1, (probability ?? 0) / 100)),
            });
        });
    });
    const hasCascade = childrenOf.size > 0;

    // lefSamples por riesgo: hace falta para decidir, iteración por iteración, si el riesgo
    // ocurrió "este año" y puede arrastrar a sus hijos.
    const lefByRisk = new Map();
    const magnitudeByRisk = new Map();

    usable.forEach((risk, index) => {
        // Semilla derivada por posición: reproducible, y distinta para cada riesgo (con la misma
        // semilla para todos, los riesgos quedarían perfectamente correlacionados por accidente y
        // el resultado sería idéntico a la suma que estamos corrigiendo).
        const { annualLosses, lefSamples, magnitudeSamples } = runMonteCarloSimulation({
            iterations,
            seed: seed + index * 7919,
            tef: risk.tef,
            vuln: risk.vuln,
            lossMagnitudes: risk.lossMagnitudes,
            sampleVuln: buildVulnSampler(risk),
        });
        for (let i = 0; i < iterations; i++) portfolioLosses[i] += annualLosses[i];
        sumOfIndividualCVaR += summarizeLosses(annualLosses).cvar95;
        if (hasCascade) {
            lefByRisk.set(risk.riskName, lefSamples);
            magnitudeByRisk.set(risk.riskName, magnitudeSamples);
        }
    });

    // --- Correlación por cascada -------------------------------------------------------------
    // Hasta aquí cada riesgo se muestreó independiente. Ahora se AÑADE la pérdida de los riesgos
    // que un padre arrastra al ocurrir: en esa iteración los dos caen juntos, y esa co-ocurrencia
    // es exactamente lo que engorda la cola conjunta.
    //
    // Se SUMA sobre la base, nunca la reemplaza. Eso preserva un invariante que importa: un
    // portafolio SIN dependencias declaradas da exactamente los mismos números que antes, así que
    // conectar la cascada no reescribe en silencio ninguna evaluación existente.
    //
    // Un descendiente activado aporta solo su MAGNITUD, no LEF x Magnitud — misma regla que ya
    // sigue cascadeSimulation.js: la compuerta de cascada ya decidió "ocurrió este año", y volver
    // a multiplicar por su lef_i descontaría la frecuencia dos veces (para un riesgo raro pero
    // severo eso subestima el aporte en órdenes de magnitud).
    // Instantánea ANTES de añadir la cascada: sin ella no se pueden separar los dos efectos, que
    // van en direcciones opuestas. Diversificar BAJA la cola; correlacionar la SUBE. Reportar solo
    // la resta contra la suma los revuelve en un número que no mide ninguno de los dos.
    const independentSummary = summarizeLosses(portfolioLosses);

    let cascadeAddedLoss = 0;
    if (hasCascade) {
        const cascadeRng = mulberry32(seed + 104729);
        const parents = [...childrenOf.keys()];
        const getTransitions = (name) => childrenOf.get(name) || [];
        for (let i = 0; i < iterations; i++) {
            // Un padre "ocurre este año" con probabilidad 1 - e^(-LEF), misma conversión de
            // frecuencia a ocurrencia que usa el Árbol de Cascada.
            const activos = parents.filter((name) => {
                const lef = lefByRisk.get(name);
                const p = lef ? 1 - Math.exp(-Math.max(0, lef[i])) : 0;
                return cascadeRng() < p;
            });
            if (activos.length === 0) continue;
            const alcanzados = walkMarkovChain(activos, getTransitions, cascadeRng);
            alcanzados.forEach((name) => {
                // Los padres ya aportaron su LEF x Magnitud arriba; solo se suma lo arrastrado.
                if (activos.includes(name)) return;
                const mag = magnitudeByRisk.get(name);
                if (!mag) return;
                portfolioLosses[i] += mag[i];
                cascadeAddedLoss += mag[i];
            });
        }
    }

    const summary = summarizeLosses(portfolioLosses);
    // Los dos efectos, medidos por separado contra la MISMA referencia:
    //   diversificationBenefit = cuánto sobrestimaba sumar colas (siempre >= 0)
    //   correlationPenalty     = cuánto engorda la cola la correlación declarada (siempre >= 0)
    // Antes esto era una sola resta contra la suma, que los revolvía: con cascada declarada, el
    // "beneficio de diversificación" salía artificialmente bajo porque le habían restado la
    // correlación sin decirlo.
    const diversificationBenefit = sumOfIndividualCVaR - independentSummary.cvar95;
    const correlationPenalty = summary.cvar95 - independentSummary.cvar95;

    return {
        summary,
        lossExceedanceCurve: buildLossExceedanceCurve(portfolioLosses),
        includedCount: usable.length,
        skippedCount: skipped.length,
        skippedRiskNames: skipped.map((r) => r.riskName),
        sumOfIndividualCVaR,
        diversificationBenefit,
        correlationPenalty,
        independentCVaR: independentSummary.cvar95,
        cascadeEdgeCount: [...childrenOf.values()].reduce((n, c) => n + c.length, 0),
        cascadeAddedALE: cascadeAddedLoss / iterations,
    };
}

module.exports = { simulatePortfolio, PORTFOLIO_ITERATIONS, PORTFOLIO_BASE_SEED };
