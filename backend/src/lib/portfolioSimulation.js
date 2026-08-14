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
 * Factor `k` con el que se escala la Vulnerabilidad de un riesgo para simular su estado RESIDUAL
 * (después del Tratamiento adoptado). 1 = sin cambio.
 *
 * Se deriva de `residualALE / ale`, NO del `reductionPercent` del formulario de Mitigar: la
 * decisión adoptada solo persiste el residual (ver treatmentDecision en routes/register.js), y
 * derivarlo del residual es además autoconsistente con lo que de verdad se adoptó — no con lo que
 * quedara escrito en el formulario después. Sale sin casos especiales para las cuatro estrategias:
 * Evitar da 0, Aceptar da 1.
 *
 * Por qué escalar la Vulnerabilidad reproduce el residual: cada pérdida anual simulada es
 * `LEF x Magnitud` con `LEF = TEF x Vulnerabilidad`, así que multiplicar la Vulnerabilidad por k
 * multiplica cada una de las 10.000 pérdidas por k — y escalar una distribución entera por una
 * constante escala TODAS sus estadísticas por igual (la media tanto como el promedio de la cola).
 * Es el mismo argumento que ya justifica `residualCVaR = currentCVaR x (1 - reducción)` en
 * lib/treatment.js.
 *
 * TRANSFERIR queda fuera a propósito (devuelve 1, es decir: se simula sin tratamiento). El
 * deducible y el límite no son un escalado sino una TRUNCACIÓN de la cola escenario por escenario
 * — una transformación no lineal, sin ningún k que la represente. Simularlo como si nada se
 * hubiera hecho es conservador (nunca subestima), que es el mismo criterio que ya sigue la página
 * de Tratamiento cuando no puede calcular el beneficio real de una póliza.
 */
function residualScaleFactor(risk) {
    const decision = risk && risk.treatmentDecision;
    if (!decision) return 1;
    if (decision.strategy === 'transferir' || decision.strategy === 'mitigarTransferir') return 1;
    if (!(risk.ale > 0)) return 1;
    const k = decision.residualALE / risk.ale;
    if (!Number.isFinite(k) || k < 0) return 1;
    return Math.min(1, k);
}

/** Un tratamiento cuya cola NO se puede representar escalando (ver residualScaleFactor). */
function isNonScalableTreatment(risk) {
    const strategy = risk && risk.treatmentDecision && risk.treatmentDecision.strategy;
    return strategy === 'transferir' || strategy === 'mitigarTransferir';
}

/**
 * @param {Array<Object>} risks Entradas del Registro (ver routes/register.js).
 * @param {Object} [options]
 * @param {number} [options.iterations=10000]
 * @param {number} [options.seed] Semilla base; fija por defecto para que el resultado sea
 *   reproducible entre corridas (una cifra de portafolio que baila sin que cambien los datos es
 *   imposible de auditar).
 * @param {(risk:Object) => number} [options.scaleOf] Factor por el que se escala la Vulnerabilidad
 *   de cada riesgo. Por defecto 1 (sin cambio): la corrida ACTUAL. `simulateResidualPortfolio` le
 *   pasa residualScaleFactor para obtener el estado después del Tratamiento, con la MISMA semilla
 *   — ver ahí por qué el pareo importa.
 * @returns {{summary:Object, lossExceedanceCurve:Array, includedCount:number, skippedCount:number,
 *   skippedRiskNames:string[], sumOfIndividualCVaR:number|null, diversificationBenefit:number|null}}
 */
function simulatePortfolio(
    risks,
    { iterations = PORTFOLIO_ITERATIONS, seed = PORTFOLIO_BASE_SEED, scaleOf = () => 1 } = {},
) {
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
        // El escalado se aplica a los DOS caminos de Vulnerabilidad para que den lo mismo: al
        // triángulo capturado a mano (que muestrea runMonteCarloSimulation) y a la salida del
        // sampler calibrado por perfiles, si el riesgo tiene Atacante/Defensa. Escalar solo el
        // triángulo dejaría sin efecto el tratamiento en todo riesgo con perfiles — que son la
        // mayoría.
        const k = scaleOf(risk);
        const baseSampler = buildVulnSampler(risk);
        const { annualLosses, lefSamples, magnitudeSamples } = runMonteCarloSimulation({
            iterations,
            seed: seed + index * 7919,
            tef: risk.tef,
            vuln: k === 1 ? risk.vuln : { min: risk.vuln.min * k, mode: risk.vuln.mode * k, max: risk.vuln.max * k },
            lossMagnitudes: risk.lossMagnitudes,
            sampleVuln: baseSampler && k !== 1 ? (rng) => k * baseSampler(rng) : baseSampler,
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

/**
 * Simulación conjunta del portafolio en su estado RESIDUAL: después del Tratamiento adoptado de
 * cada riesgo. Los que no tienen decisión adoptada entran tal cual (k = 1), igual que hoy.
 *
 * MISMA SEMILLA que la corrida actual, y no es un detalle: es lo que convierte "cuánto ahorra el
 * tratamiento" en una cifra exacta en vez de una estimación ruidosa. Con semillas distintas, la
 * resta entre las dos colas mezclaría el efecto del tratamiento con ruido de muestreo (a 10.000
 * iteraciones el error estándar ronda el 0,6% — suficiente para ensuciar un ahorro pequeño). Con
 * la misma, las dos corridas quedan PAREADAS: cada iteración es el mismo "año posible" vivido con
 * y sin tratamiento, y la diferencia es atribuible solo a la mitigación.
 *
 * El pareo es exacto, no aproximado: en getPertRandom (lib/random.js) escalar min/mode/max por k
 * deja alpha y beta idénticos, así que el sorteo Beta subyacente es el MISMO y el resultado es
 * exactamente k veces el original.
 *
 * @returns Lo mismo que simulatePortfolio, más `treatedCount` (cuántos riesgos traían una decisión
 *   adoptada) y `nonScalableRiskNames` (los tratados con Transferir, que entran sin escalar porque
 *   su cola no se puede representar con un factor — ver residualScaleFactor).
 */
function simulateResidualPortfolio(risks, options = {}) {
    const threats = (risks || []).filter((r) => r && r.riskType !== 'oportunidad' && hasCompleteInputs(r));
    const result = simulatePortfolio(risks, { ...options, scaleOf: residualScaleFactor });
    return {
        ...result,
        treatedCount: threats.filter((r) => r.treatmentDecision).length,
        nonScalableRiskNames: threats.filter(isNonScalableTreatment).map((r) => r.riskName),
    };
}

module.exports = {
    simulatePortfolio,
    simulateResidualPortfolio,
    residualScaleFactor,
    PORTFOLIO_ITERATIONS,
    PORTFOLIO_BASE_SEED,
};
