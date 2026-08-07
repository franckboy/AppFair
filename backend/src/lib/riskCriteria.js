'use strict';

/**
 * Los Criterios de Riesgo (ALE Aceptable/Crítico) cambiaron de forma: antes aleAceptable se
 * guardaba directo en dólares; ahora se deriva de aleAceptablePercent (Pérdida Anual Aceptable
 * %) sobre aleCritico. Cualquier documento guardado ANTES de ese cambio (Postgres persistente —
 * no la instalación efímera de Render free tier, que se borra en cada redeploy) sigue teniendo
 * la forma vieja. Sin esta migración, aleAceptablePercent llegaría undefined a
 * evaluateFairThreat/evaluateFairOpportunity, aleAceptable = NaN, y CUALQUIER comparación
 * contra NaN es `false` en JavaScript: todo riesgo se clasificaría como "Aceptable" en
 * silencio, sin importar qué tan grave sea en realidad.
 * @param {object} criteria
 * @returns {object}
 */
function normalizeRiskCriteria(criteria) {
    if (!criteria || typeof criteria.aleAceptablePercent === 'number') return criteria;
    if (
        typeof criteria.aleAceptable === 'number' &&
        typeof criteria.aleCritico === 'number' &&
        criteria.aleCritico > 0
    ) {
        // Reconstruye el % equivalente al monto en dólares que ya estaba guardado, para no
        // cambiarle el criterio a nadie con este cambio de forma — solo cómo se expresa.
        const derivedPercent = Math.min(99, Math.max(1, (criteria.aleAceptable / criteria.aleCritico) * 100));
        return { ...criteria, aleAceptablePercent: derivedPercent };
    }
    return { ...criteria, aleAceptablePercent: 20 };
}

/**
 * Valida un override PARCIAL de criterios (ej. riskCriteria en POST /api/simulate,
 * riskCriteriaOverride en PUT /api/register/:riskName) — a diferencia de PUT
 * /api/config/criteria (que exige el objeto completo), aquí solo se validan los campos que de
 * verdad llegaron, porque un override por riesgo normalmente solo trae aleAceptablePercent/
 * aleCritico, no rrtBands. Sin esto, un override fuera de rango (ej. 200%) no truena, pero sí
 * invierte silenciosamente los umbrales para esa corrida.
 *
 * El override individual puede ser más RESTRICTIVO que el global (un ALE Crítico menor, para un
 * riesgo con menos tolerancia), pero nunca más permisivo — decisión explícita del usuario: "mi
 * máximo global es $1M, pero para este riesgo mi máximo es $2M" se contradice a sí mismo, porque
 * el global YA es el techo absoluto de lo que la organización está dispuesta a perder.
 * globalCriteria (opcional) es el criterio ya vigente (normalizado) contra el que se compara ese
 * techo — sin él, ese chequeo simplemente se omite (ej. si el propio global aún no se conoce).
 * @param {object|null} override
 * @param {object|null} [globalCriteria]
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validateRiskCriteriaOverride(override, globalCriteria = null) {
    if (!override) return null;
    if (
        override.aleAceptablePercent !== undefined &&
        (typeof override.aleAceptablePercent !== 'number' ||
            override.aleAceptablePercent <= 0 ||
            override.aleAceptablePercent >= 100)
    ) {
        return 'aleAceptablePercent debe ser un número entre 0 y 100.';
    }
    if (override.aleCritico !== undefined && (typeof override.aleCritico !== 'number' || override.aleCritico <= 0)) {
        return 'aleCritico debe ser un número mayor que 0.';
    }
    if (
        override.aleCritico !== undefined &&
        globalCriteria &&
        typeof globalCriteria.aleCritico === 'number' &&
        override.aleCritico > globalCriteria.aleCritico
    ) {
        return `El ALE Crítico de este riesgo (override) no puede superar el ALE Crítico global (${globalCriteria.aleCritico}).`;
    }
    return null;
}

module.exports = { normalizeRiskCriteria, validateRiskCriteriaOverride };
