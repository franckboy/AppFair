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
 * @param {object|null} override
 * @returns {string|null} mensaje de error, o null si es válido
 */
function validateRiskCriteriaOverride(override) {
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
    return null;
}

module.exports = { normalizeRiskCriteria, validateRiskCriteriaOverride };
