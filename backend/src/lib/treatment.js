'use strict';

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
 * @param {number[]} [params.annualLosses] Arreglo de pérdidas simuladas (necesario para Transferir)
 * @param {Object} params.mitigar { cost, reductionPercent, reliability, delayDays }
 * @param {Object} params.transferir { premium, deductible, limit, unlimited, reliability, delayDays }
 * @param {Object} params.evitar { cost, reliability, delayDays }
 * @param {(n:number) => string} formatCurrency
 */
function evaluateTreatmentStrategies({ currentALE, annualLosses, mitigar, transferir, evitar }, formatCurrency) {
    const results = {};

    // 1. Mitigar
    const aleAfterMitigar = currentALE * (1 - (mitigar.reductionPercent || 0) / 100);
    const avoidedMitigar = currentALE - aleAfterMitigar;
    const netBenefitMitigar = avoidedMitigar - mitigar.cost;
    results.mitigar = {
        cost: mitigar.cost,
        residualALE: aleAfterMitigar,
        avoidedLoss: avoidedMitigar,
        netBenefit: netBenefitMitigar,
        reliability: mitigar.reliability,
        delayDays: mitigar.delayDays,
        // Bug real: reductionPercent se autocalcula solo (ver App.Treatment.updateReduccionALEAuto
        // en el frontend) en cuanto se elige un nivel de defensa objetivo, ANTES de que el usuario
        // haya escrito ningún costo — así que avoidedMitigar > 0 con cost = 0 (su default) era
        // frecuente, no un caso raro, y getInvestmentVerdict genérico diría "SÍ conviene, sin
        // costo capturado" como si mantener un control fuera gratis, lo cual nunca es cierto en
        // la práctica. Mismo criterio que ya usa Evitar más abajo — se exige un costo real.
        verdict:
            mitigar.cost > 0
                ? getInvestmentVerdict(mitigar.cost, avoidedMitigar, formatCurrency)
                : {
                      verdict: 'sin_datos',
                      rosi: null,
                      message:
                          'Ingresa el costo anualizado de mantener este control para ver si conviene invertir en él.',
                  },
    };

    // 2. Transferir (Seguro)
    let retainedALE = currentALE;
    if (
        annualLosses &&
        annualLosses.length > 0 &&
        (transferir.deductible > 0 || transferir.limit > 0 || transferir.unlimited)
    ) {
        retainedALE = calculateInsuranceRetainedALE(
            annualLosses,
            transferir.deductible || 0,
            transferir.limit || 0,
            !!transferir.unlimited,
        );
    }
    const avoidedTransferir = currentALE - retainedALE;
    const netBenefitTransferir = avoidedTransferir - transferir.premium;
    results.transferir = {
        cost: transferir.premium,
        residualALE: retainedALE,
        avoidedLoss: avoidedTransferir,
        netBenefit: netBenefitTransferir,
        reliability: transferir.reliability,
        delayDays: transferir.delayDays,
        // Mismo bug que Mitigar (ver comentario ahí): avoidedTransferir puede ser > 0 en cuanto se
        // captura deducible/límite, sin que el usuario haya escrito todavía la prima anual (0 por
        // default) — una póliza de seguro real siempre tiene prima, nunca es gratis.
        verdict:
            transferir.premium > 0
                ? getInvestmentVerdict(transferir.premium, avoidedTransferir, formatCurrency)
                : {
                      verdict: 'sin_datos',
                      rosi: null,
                      message: 'Ingresa la prima anual del seguro para ver si conviene transferir este riesgo.',
                  },
    };

    // 3. Evitar (elimina la fuente del riesgo → residual = 0 por definición)
    const netBenefitEvitar = currentALE - evitar.cost;
    results.evitar = {
        cost: evitar.cost,
        residualALE: 0,
        avoidedLoss: currentALE,
        netBenefit: netBenefitEvitar,
        reliability: evitar.reliability,
        delayDays: evitar.delayDays,
        // Mismo criterio que Mitigar/Transferir arriba: eliminar la fuente de un riesgo real
        // nunca es gratis — se exige un costo real antes de dar cualquier veredicto. Acá es
        // todavía más fácil de disparar en falso: avoidedLoss de Evitar es SIEMPRE currentALE por
        // definición (elimina el 100% del riesgo), sin depender de ningún otro dato capturado.
        verdict:
            evitar.cost > 0
                ? getInvestmentVerdict(evitar.cost, currentALE, formatCurrency)
                : {
                      verdict: 'sin_datos',
                      rosi: null,
                      message: 'Ingresa el costo anualizado de eliminar la fuente de este riesgo para ver si conviene.',
                  },
    };

    // 4. Aceptar / Retener (sin costo, sin cambio)
    results.aceptar = { cost: 0, residualALE: currentALE, avoidedLoss: 0, netBenefit: 0 };

    // Recomendación: la estrategia activa (con un costo real capturado) con mayor beneficio neto.
    // Bug real corregido: antes, Mitigar/Transferir contaban como "activas" con solo
    // avoidedLoss > 0 (cost = 0, su default) — reductionPercent y deducible/límite se autocalculan
    // o se capturan ANTES de que el usuario escriba ningún costo, así que "SÍ conviene, sin costo
    // capturado" salía seguido, no solo en un caso raro. Ninguna de las 3 estrategias es gratis en
    // la práctica (mantener un control, pagar una prima, o eliminar la fuente del riesgo), así que
    // las 3 comparten la misma regla: solo cuenta como activa si tiene un costo real capturado.
    const activeStrategies = Object.entries(results).filter(([key, r]) => key !== 'aceptar' && r.cost > 0);

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

module.exports = { calculateInsuranceRetainedALE, calculateROSI, getInvestmentVerdict, evaluateTreatmentStrategies };
