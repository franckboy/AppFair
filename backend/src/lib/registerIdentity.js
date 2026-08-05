'use strict';

/**
 * Ubica, dentro del Registro, la entrada existente que corresponde a `entry` — con prioridad:
 *
 * 1. Por `id` propio del Registro, si el cliente ya lo conoce (re-simular un riesgo que se
 *    cargó desde aquí — ver App.FairWizard.loadRegisteredRiskIntoForm en el frontend).
 * 2. Por `sourceRiskId` — el vínculo estable con /api/risks, que sí permite nombres repetidos
 *    (dos riesgos legítimos pueden llamarse igual, identificados por su propio id). Antes el
 *    Registro hacía upsert solo por `riskName`: dos riesgos DISTINTOS con el mismo nombre se
 *    pisaban entre sí al simular, perdiendo en silencio el análisis FAIR del primero. Con
 *    sourceRiskId como identidad real, ya no colisionan, y renombrar un riesgo entre
 *    simulaciones tampoco crea una entrada huérfana duplicada.
 * 3. Si no hay ninguno de los dos (un análisis FAIR sin Vista Rápida detrás, ej. "Duplicar como
 *    Plantilla"), por `riskName` — el único caso donde el nombre sigue siendo la única señal
 *    disponible, igual que el comportamiento histórico.
 *
 * @param {Array<{id?: string, sourceRiskId?: string|null, riskName: string}>} register
 * @param {{id?: string|null, sourceRiskId?: string|null, riskName: string}} entry
 * @returns {number} índice en `register`, o -1 si no hay coincidencia.
 */
function findRegisterEntryIndex(register, entry) {
    if (entry.id) {
        const byId = register.findIndex((r) => r.id === entry.id);
        if (byId !== -1) return byId;
    }
    if (entry.sourceRiskId) {
        return register.findIndex((r) => r.sourceRiskId === entry.sourceRiskId);
    }
    return register.findIndex((r) => r.riskName === entry.riskName && !r.sourceRiskId);
}

module.exports = { findRegisterEntryIndex };
