'use strict';

const { evaluateDecisionTree } = require('./decisionTree');

// Traduce Fiabilidad (Alta/Media/Baja, ver el <select> del formulario) a la probabilidad de que
// la estrategia SÍ funcione como se espera — calibración inicial razonable, no un dato medido;
// fácil de ajustar acá si en el futuro se calibra con casos reales. Fiabilidad "Baja" no es 0%
// (un control poco confiable a veces sí funciona) ni "Alta" es 100% (nada es infalible).
const RELIABILITY_TO_PROBABILITY = { alta: 0.9, media: 0.7, baja: 0.4 };

/**
 * Beneficio neto ESPERADO de una estrategia, dado que tiene un costo real capturado — antes este
 * cálculo era un solo número (avoidedLoss - cost), como si la estrategia fuera a funcionar
 * siempre. Ahora es un árbol de decisión de un solo nodo de azar ("¿funciona como se espera?"):
 * si funciona, se logra el avoidedLoss completo menos el costo; si falla, igual se pagó el costo
 * sin lograr nada (relativo a Aceptar, que es el punto de comparación — no es que quedes
 * "-cost -currentALE", es que quedas -cost peor que si nunca hubieras intentado nada, porque de
 * cualquier forma seguías expuesto al currentALE completo).
 *
 * @param {number} cost
 * @param {number} avoidedLoss Lo que se evita SI la estrategia funciona (deterministico, ya
 *   calculado aparte — este valor no cambia, ver avoidedLoss en evaluateTreatmentStrategies).
 * @param {string} reliability 'alta' | 'media' | 'baja'
 * @returns {number}
 */
function expectedNetBenefit(cost, avoidedLoss, reliability) {
    const probabilityOfSuccess = RELIABILITY_TO_PROBABILITY[reliability] ?? RELIABILITY_TO_PROBABILITY.media;
    const tree = {
        type: 'chance',
        label: 'la estrategia funciona como se espera',
        branches: [
            { probability: probabilityOfSuccess, node: { type: 'terminal', value: avoidedLoss - cost } },
            { probability: 1 - probabilityOfSuccess, node: { type: 'terminal', value: -cost } },
        ],
    };
    return evaluateDecisionTree(tree).value;
}

/**
 * Calcula la pérdida retenida por año, aplicando un deducible y un límite de
 * cobertura de seguro sobre CADA escenario simulado (no una aproximación
 * sobre el promedio).
 *
 * Importante: `limit=0` se interpreta literalmente como "cero cobertura
 * adicional" arriba del deducible — no como "sin límite". Para modelar una
 * póliza sin tope, usa unlimited=true explícitamente.
 *
 * @param {number[]} annualLosses Arreglo de pérdidas simuladas (del motor Monte Carlo)
 * @param {number} deductible Deducible por evento
 * @param {number} limit Límite de cobertura por evento (ignorado si unlimited=true)
 * @param {boolean} unlimited Si es true, la aseguradora cubre todo el excedente sobre el deducible
 * @returns {number} Pérdida Anual Esperada retenida (promedio)
 */
function calculateInsuranceRetainedALE(annualLosses, deductible, limit, unlimited) {
    const retained = annualLosses.map((loss) => {
        if (loss <= deductible) return loss;
        const excess = loss - deductible;
        const coveredAmount = unlimited ? excess : Math.min(excess, limit);
        return deductible + Math.max(0, excess - coveredAmount);
    });
    return retained.reduce((a, b) => a + b, 0) / retained.length;
}

/**
 * "Mitigar + Transferir" combinados: un árbol de decisión de 2 NIVELES, no dos estrategias
 * evaluadas aparte y comparadas por fuera. Nivel 1 (azar): ¿Mitigar funciona? Nivel 2 (decisión),
 * en CADA rama del nivel 1: dado el ALE que queda después de ese resultado, ¿se acepta tal cual,
 * o también se transfiere (con su propia Fiabilidad de que el seguro responda)? — modela el
 * patrón real de ISO 31000 de tratamiento en capas (mitigar lo que se pueda, transferir el
 * resto), en vez de tratar las estrategias como si solo se pudiera elegir una.
 *
 * El seguro aplicado al residual DESPUÉS de una mitigación exitosa se calcula sobre las mismas
 * pérdidas simuladas (annualLosses) pero ESCALADAS por la reducción lograda — un deducible fijo
 * dispara con menos frecuencia contra pérdidas ya más chicas, que es el comportamiento correcto,
 * no un error de cálculo.
 *
 * @param {Object} params Mismos currentALE/annualLosses/mitigar/transferir que
 *   evaluateTreatmentStrategies — se asume mitigar.cost > 0 Y transferir.premium > 0 (quien
 *   llama decide cuándo tiene sentido evaluar esta combinación, ver evaluateTreatmentStrategies).
 * @returns {{value: number, tree: Object}} `value` es el beneficio neto esperado de la mejor
 *   combinación posible; `tree` es el árbol evaluado completo (con qué opción ganó en cada rama),
 *   por si se necesita explicar la recomendación con más detalle en el futuro.
 */
function evaluateMitigarConTransferir({ currentALE, annualLosses, mitigar, transferir }) {
    const pMitigar = RELIABILITY_TO_PROBABILITY[mitigar.reliability] ?? RELIABILITY_TO_PROBABILITY.media;
    const pTransferir = RELIABILITY_TO_PROBABILITY[transferir.reliability] ?? RELIABILITY_TO_PROBABILITY.media;
    const canCalculateInsurance =
        annualLosses &&
        annualLosses.length > 0 &&
        (transferir.deductible > 0 || transferir.limit > 0 || transferir.unlimited);

    // Nodo "¿qué hacer con el residual?" — baseALE es lo que queda expuesto ANTES de decidir si
    // también se transfiere (currentALE si Mitigar falló, aleAfterMitigar si funcionó);
    // scaleFactor escala annualLosses proporcional a ESE MISMO residual, para que el seguro se
    // calcule sobre las pérdidas que de verdad quedarían en juego en esa rama, no las originales.
    function residualDecisionNode(baseALE, scaleFactor, sunkCost) {
        const acceptedValue = currentALE - baseALE - sunkCost;
        const retainedALE = canCalculateInsurance
            ? calculateInsuranceRetainedALE(
                  annualLosses.map((loss) => loss * scaleFactor),
                  transferir.deductible || 0,
                  transferir.limit || 0,
                  !!transferir.unlimited,
              )
            : baseALE; // sin datos de póliza, transferir no aporta nada sobre aceptar tal cual.

        return {
            type: 'decision',
            options: [
                { label: 'aceptar', node: { type: 'terminal', value: acceptedValue } },
                {
                    label: 'transferir',
                    node: {
                        type: 'chance',
                        label: 'transferir el residual funciona',
                        branches: [
                            {
                                probability: pTransferir,
                                node: {
                                    type: 'terminal',
                                    value: currentALE - retainedALE - sunkCost - transferir.premium,
                                },
                            },
                            {
                                probability: 1 - pTransferir,
                                node: { type: 'terminal', value: acceptedValue - transferir.premium },
                            },
                        ],
                    },
                },
            ],
        };
    }

    // Bug real corregido: acá se derivaba aleAfterMitigar de reductionPercent (un entero
    // REDONDEADO y ACOTADO a [0,100], ver calculateResidualFromSimulation en autocalc.js) en vez
    // de usar mitigar.residualALE real cuando existe — igual que ya hace results.mitigar más
    // abajo en evaluateTreatmentStrategies. Cuando el residual real es PEOR que currentALE (Nivel
    // de Defensa Objetivo más débil), reductionPercent se acota a 0 y esta rama combinada asumía
    // "sin cambio" en vez de reflejar la pérdida real — podía hacer que Mitigar+Transferir pareciera
    // mejor que Mitigar solo (que sí usa el residual real) cuando en realidad es la peor opción.
    const hasRealResidualALE = typeof mitigar.residualALE === 'number';
    const aleAfterMitigar = hasRealResidualALE
        ? mitigar.residualALE
        : currentALE * (1 - (mitigar.reductionPercent || 0) / 100);
    // Escala annualLosses proporcional al residual REAL (no a reductionPercent, que no puede
    // representar un residual peor que el actual por estar acotado a [0,100]) — la mejor
    // aproximación disponible sin volver a correr Monte Carlo con la Vulnerabilidad ya reducida
    // (mismo criterio documentado arriba, en el JSDoc de evaluateTreatmentStrategies).
    const scaleFactor = currentALE > 0 ? aleAfterMitigar / currentALE : 1;
    const tree = {
        type: 'chance',
        label: 'mitigar funciona',
        branches: [
            { probability: pMitigar, node: residualDecisionNode(aleAfterMitigar, scaleFactor, mitigar.cost) },
            { probability: 1 - pMitigar, node: residualDecisionNode(currentALE, 1, mitigar.cost) },
        ],
    };

    return { ...evaluateDecisionTree(tree), tree };
}

/**
 * ROSI (Retorno de Inversión en Seguridad) = (Pérdida Evitada - Costo) / Costo × 100.
 * Es el mismo Beneficio Neto, expresado como % de retorno.
 * @param {number} cost
 * @param {number} lossAvoided
 * @returns {number|null} null si el costo es 0 (ROSI no está definido)
 */
function calculateROSI(cost, lossAvoided) {
    if (cost <= 0) return null;
    return ((lossAvoided - cost) / cost) * 100;
}

/**
 * Traduce Costo + Pérdida Evitada en un veredicto claro: ¿conviene invertir
 * o no?, y cuánto se ahorraría.
 * @param {number} cost
 * @param {number} lossAvoided
 * @param {(n:number) => string} formatCurrency
 */
function getInvestmentVerdict(cost, lossAvoided, formatCurrency) {
    const netBenefit = lossAvoided - cost;

    if (cost <= 0) {
        if (lossAvoided > 0) {
            return {
                verdict: 'conviene',
                rosi: null,
                message: `Sin costo capturado, evitarías perder ${formatCurrency(lossAvoided)} al año.`,
            };
        }
        return { verdict: 'sin_datos', rosi: null, message: '' };
    }

    const rosi = calculateROSI(cost, lossAvoided);

    if (netBenefit > 0) {
        return {
            verdict: 'conviene',
            rosi,
            message: `Si inviertes ${formatCurrency(cost)} al año, evitas perder ${formatCurrency(lossAvoided)} → te ahorras ${formatCurrency(netBenefit)} netos al año (por cada $1 invertido, recuperas $${(1 + rosi / 100).toFixed(2)}).`,
        };
    }
    if (netBenefit < 0) {
        return {
            verdict: 'no_conviene',
            rosi,
            message: `Costaría ${formatCurrency(cost)} al año pero solo evitarías perder ${formatCurrency(lossAvoided)} → perderías ${formatCurrency(Math.abs(netBenefit))} netos al año.`,
        };
    }
    return { verdict: 'neutro', rosi, message: 'Esta inversión da exactamente lo mismo que no hacer nada.' };
}

/**
 * Evalúa las 4 estrategias de tratamiento (ISO 31000, cláusula 6.5) para un
 * riesgo dado, y recomienda la de mayor beneficio neto entre las que
 * tengan datos capturados.
 *
 * @param {Object} params
 * @param {number} params.currentALE Pérdida Anual Esperada actual (simulada)
 * @param {number} [params.currentCVaR] CVaR95 actual (simulado) — opcional; si no es un número,
 *   los residualCVaR de abajo quedan en null en vez de calcularse.
 * @param {number[]} [params.annualLosses] Arreglo de pérdidas simuladas (necesario para Transferir)
 * @param {Object} params.mitigar { cost, reductionPercent, residualALE, residualCVaR, reliability,
 *   delayDays } — `residualALE`/`residualCVaR` (opcionales) son el resultado REAL de re-simular
 *   con el Nivel de Defensa Objetivo (ver calculateResidualFromSimulation, autocalc.js) — cuando
 *   vienen como número, se usan TAL CUAL en vez de derivarlos de `reductionPercent` ×
 *   `currentALE`/`currentCVaR`. Esa derivación por escalado proporcional era exacta bajo la vieja
 *   Vulnerabilidad lineal (escalar Vulnerabilidad por X% escalaba TODA la distribución de
 *   pérdidas por igual, ALE y CVaR incluidos) — con el modelo TCap vs. RS + Tullock ya no lo es,
 *   así que sigue siendo solo la mejor aproximación disponible cuando no hay `residualALE`/
 *   `residualCVaR` reales (modo manual, sin un Nivel de Defensa Objetivo que simular).
 * @param {Object} params.transferir { premium, deductible, limit, unlimited, reliability, delayDays }
 * @param {Object} params.evitar { cost, reliability, delayDays }
 * @param {(n:number) => string} formatCurrency
 */
function evaluateTreatmentStrategies(
    { currentALE, currentCVaR, annualLosses, mitigar, transferir, evitar },
    formatCurrency,
) {
    const results = {};
    const hasCVaR = typeof currentCVaR === 'number';

    // 1. Mitigar
    const hasRealResidualALE = typeof mitigar.residualALE === 'number';
    const aleAfterMitigar = hasRealResidualALE
        ? mitigar.residualALE
        : currentALE * (1 - (mitigar.reductionPercent || 0) / 100);
    const avoidedMitigar = currentALE - aleAfterMitigar;
    // Bug real: reductionPercent se autocalcula solo (ver App.Treatment.updateReduccionALEAuto
    // en el frontend) en cuanto se elige un nivel de defensa objetivo, ANTES de que el usuario
    // haya escrito ningún costo — así que avoidedMitigar > 0 con cost = 0 (su default) era
    // frecuente, no un caso raro, y getInvestmentVerdict genérico diría "SÍ conviene, sin
    // costo capturado" como si mantener un control fuera gratis, lo cual nunca es cierto en
    // la práctica. Mismo criterio que ya usa Evitar más abajo — se exige un costo real.
    const netBenefitMitigar =
        mitigar.cost > 0
            ? expectedNetBenefit(mitigar.cost, avoidedMitigar, mitigar.reliability)
            : avoidedMitigar - mitigar.cost;
    const hasRealResidualCVaR = typeof mitigar.residualCVaR === 'number';
    results.mitigar = {
        cost: mitigar.cost,
        residualALE: aleAfterMitigar,
        residualCVaR: hasCVaR
            ? hasRealResidualCVaR
                ? mitigar.residualCVaR
                : currentCVaR * (1 - (mitigar.reductionPercent || 0) / 100)
            : null,
        avoidedLoss: avoidedMitigar,
        netBenefit: netBenefitMitigar,
        reliability: mitigar.reliability,
        delayDays: mitigar.delayDays,
        // lossAvoided se manda "ajustado" (netBenefit + cost) para que el netBenefit que
        // getInvestmentVerdict calcula internamente (lossAvoided - cost) coincida exacto con
        // netBenefitMitigar de arriba — así el veredicto/ROSI/mensaje ya reflejan el valor
        // esperado bajo Fiabilidad, no el resultado "si todo sale bien".
        verdict:
            mitigar.cost > 0
                ? getInvestmentVerdict(mitigar.cost, netBenefitMitigar + mitigar.cost, formatCurrency)
                : {
                      verdict: 'sin_datos',
                      rosi: null,
                      message:
                          'Ingresa el costo anualizado de mantener este control para ver si conviene invertir en él.',
                  },
    };

    // 2. Transferir (Seguro)
    const hasInsuranceTerms = transferir.deductible > 0 || transferir.limit > 0 || !!transferir.unlimited;
    const hasAnnualLosses = Array.isArray(annualLosses) && annualLosses.length > 0;
    // Bug real corregido: cuando SÍ hay deducible/límite/sin-límite capturado pero NO hay
    // annualLosses (el Registro solo persiste un histograma de 20 barras, no las 10,000 pérdidas
    // crudas — ver el JSDoc de calculateInsuranceRetainedALE), este bloque caía en silencio a
    // "retainedALE = currentALE" → avoidedLoss = $0, como si el seguro de verdad no ahorrara
    // nada. Eso es un resultado FALSO, no la ausencia de uno: una cobertura ilimitada sobre un
    // deducible bajo NUNCA da $0 de pérdida evitada. Ahora ese caso se distingue explícitamente
    // (transferirCalculable = false) de "no hay términos de seguro capturados todavía" (donde
    // avoidedLoss = $0 sí es la respuesta real, no un hueco de datos).
    const transferirCalculable = !hasInsuranceTerms || hasAnnualLosses;
    const retainedALE =
        hasInsuranceTerms && hasAnnualLosses
            ? calculateInsuranceRetainedALE(
                  annualLosses,
                  transferir.deductible || 0,
                  transferir.limit || 0,
                  !!transferir.unlimited,
              )
            : currentALE;
    const avoidedTransferir = currentALE - retainedALE;
    // Mismo bug que Mitigar (ver comentario ahí): avoidedTransferir puede ser > 0 en cuanto se
    // captura deducible/límite, sin que el usuario haya escrito todavía la prima anual (0 por
    // default) — una póliza de seguro real siempre tiene prima, nunca es gratis.
    const netBenefitTransferir =
        transferir.premium > 0
            ? expectedNetBenefit(transferir.premium, avoidedTransferir, transferir.reliability)
            : avoidedTransferir - transferir.premium;
    results.transferir = {
        cost: transferir.premium,
        residualALE: transferirCalculable ? retainedALE : null,
        avoidedLoss: transferirCalculable ? avoidedTransferir : null,
        netBenefit: transferirCalculable ? netBenefitTransferir : null,
        reliability: transferir.reliability,
        delayDays: transferir.delayDays,
        verdict: !transferirCalculable
            ? {
                  verdict: 'sin_datos',
                  rosi: null,
                  message:
                      'Definiste un deducible/límite de cobertura, pero no se puede calcular la Pérdida Evitada sin los datos completos de la simulación (el Registro solo guarda un resumen, no los 10,000 escenarios). Vuelve a simular este riesgo desde Análisis FAIR para obtener una cotización exacta.',
              }
            : transferir.premium > 0
              ? getInvestmentVerdict(transferir.premium, netBenefitTransferir + transferir.premium, formatCurrency)
              : {
                    verdict: 'sin_datos',
                    rosi: null,
                    message: 'Ingresa la prima anual del seguro para ver si conviene transferir este riesgo.',
                },
    };

    // 3. Evitar (elimina la fuente del riesgo → residual = 0 por definición, SI funciona)
    // Mismo criterio que Mitigar/Transferir arriba: eliminar la fuente de un riesgo real nunca es
    // gratis — se exige un costo real antes de dar cualquier veredicto. Acá es todavía más fácil
    // de disparar en falso: avoidedLoss de Evitar es SIEMPRE currentALE por definición (elimina
    // el 100% del riesgo), sin depender de ningún otro dato capturado.
    const netBenefitEvitar =
        evitar.cost > 0 ? expectedNetBenefit(evitar.cost, currentALE, evitar.reliability) : currentALE - evitar.cost;
    results.evitar = {
        cost: evitar.cost,
        residualALE: 0,
        residualCVaR: 0,
        avoidedLoss: currentALE,
        netBenefit: netBenefitEvitar,
        reliability: evitar.reliability,
        delayDays: evitar.delayDays,
        verdict:
            evitar.cost > 0
                ? getInvestmentVerdict(evitar.cost, netBenefitEvitar + evitar.cost, formatCurrency)
                : {
                      verdict: 'sin_datos',
                      rosi: null,
                      message: 'Ingresa el costo anualizado de eliminar la fuente de este riesgo para ver si conviene.',
                  },
    };

    // 4. Mitigar + Transferir combinados (árbol de decisión de 2 niveles, ver
    // evaluateMitigarConTransferir) — solo tiene sentido evaluar la combinación cuando AMBAS
    // partes tienen un costo real capturado (mismo criterio de "no hay estrategia gratis" que
    // las 3 de arriba); si falta cualquiera de los dos, esa combinación ya está cubierta por
    // Mitigar o Transferir solos, evaluados arriba.
    if (mitigar.cost > 0 && transferir.premium > 0) {
        const combined = evaluateMitigarConTransferir({ currentALE, annualLosses, mitigar, transferir });
        const combinedCost = mitigar.cost + transferir.premium;
        results.mitigarTransferir = {
            cost: combinedCost,
            netBenefit: combined.value,
            mitigarReliability: mitigar.reliability,
            transferirReliability: transferir.reliability,
            delayDays: Math.max(mitigar.delayDays || 0, transferir.delayDays || 0),
            verdict: getInvestmentVerdict(combinedCost, combined.value + combinedCost, formatCurrency),
        };
    }

    // 5. Aceptar / Retener (sin costo, sin cambio)
    results.aceptar = {
        cost: 0,
        residualALE: currentALE,
        residualCVaR: hasCVaR ? currentCVaR : null,
        avoidedLoss: 0,
        netBenefit: 0,
    };

    // Recomendación: la estrategia activa (con un costo real capturado) con mayor beneficio neto,
    // incluyendo la combinación Mitigar+Transferir cuando ambas partes tienen costo capturado.
    // Bug real corregido: antes, Mitigar/Transferir contaban como "activas" con solo
    // avoidedLoss > 0 (cost = 0, su default) — reductionPercent y deducible/límite se autocalculan
    // o se capturan ANTES de que el usuario escriba ningún costo, así que "SÍ conviene, sin costo
    // capturado" salía seguido, no solo en un caso raro. Ninguna estrategia es gratis en la
    // práctica (mantener un control, pagar una prima, o eliminar la fuente del riesgo), así que
    // todas comparten la misma regla: solo cuenta como activa si tiene un costo real capturado.
    // `netBenefit !== null` excluye a Transferir cuando no es calculable (ver
    // transferirCalculable arriba): con cost > 0 pero netBenefit desconocido, comparar `null`
    // contra un número real coerciona `null` a 0 en JS (`null > -500` es `true`) — dejarlo
    // competir podía hacer que un beneficio negativo real perdiera contra un "desconocido" que
    // nunca debió participar en la comparación.
    const activeStrategies = Object.entries(results).filter(
        ([key, r]) => key !== 'aceptar' && r.cost > 0 && r.netBenefit !== null,
    );

    let recommendation;
    if (activeStrategies.length === 0) {
        recommendation = {
            strategy: 'aceptar',
            reason: 'No hay datos capturados en ninguna estrategia activa. Por defecto, este riesgo queda en Aceptar/Retener.',
        };
    } else {
        const [bestKey, best] = activeStrategies.reduce(
            (max, entry) => (entry[1].netBenefit > max[1].netBenefit ? entry : max),
            activeStrategies[0],
        );
        recommendation =
            best.netBenefit > 0
                ? {
                      strategy: bestKey,
                      netBenefit: best.netBenefit,
                      reason: `Mayor beneficio neto entre las estrategias con datos capturados.`,
                  }
                : {
                      strategy: 'aceptar',
                      reason: 'Ninguna estrategia capturada tiene beneficio neto positivo con los datos actuales.',
                  };
    }

    return { ...results, recommendation };
}

module.exports = {
    calculateInsuranceRetainedALE,
    calculateROSI,
    getInvestmentVerdict,
    expectedNetBenefit,
    evaluateMitigarConTransferir,
    RELIABILITY_TO_PROBABILITY,
    evaluateTreatmentStrategies,
};
