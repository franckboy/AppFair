'use strict';

/**
 * Ubica, dentro del Registro, la entrada existente que corresponde a `entry` — con prioridad:
 *
 * 1. Por `id` propio del Registro, si el cliente afirma conocerlo — ya sea porque re-simula un
 *    riesgo cargado desde aquí, o porque lo generó él mismo ANTES del primer guardado (ver
 *    App.FairWizard.saveToRiskRegister en el frontend: todo análisis nuevo arranca con un id
 *    propio desde su primer PUT, no solo después de que el backend se lo asigne). Si el cliente
 *    manda un id y no hay ninguna entrada con ese id, NO se cae a los criterios de abajo — es
 *    una entrada nueva de verdad, y tratarla como "sin id" reabriría exactamente el bug de
 *    nombres repetidos que este archivo existe para evitar (dos análisis nuevos sin relación,
 *    mismo riskName, el segundo pisando al primero).
 * 2. Por `sourceRiskId` — el vínculo estable con /api/risks, que sí permite nombres repetidos
 *    (dos riesgos legítimos pueden llamarse igual, identificados por su propio id). Solo aplica
 *    cuando el cliente NO mandó ningún id propio (riesgos promovidos desde una entrada de
 *    /api/risks ya existente, ver App.FairWizard.loadRiskIntoForm).
 * 3. Si no hay ninguno de los dos, por `riskName` — último recurso, solo para datos históricos
 *    sin id ni sourceRiskId (entradas guardadas antes de que este archivo existiera).
 *
 * @param {Array<{id?: string, sourceRiskId?: string|null, riskName: string}>} register
 * @param {{id?: string|null, sourceRiskId?: string|null, riskName: string}} entry
 * @returns {number} índice en `register`, o -1 si no hay coincidencia.
 */
function findRegisterEntryIndex(register, entry) {
    if (entry.id) {
        return register.findIndex((r) => r.id === entry.id);
    }
    if (entry.sourceRiskId) {
        return register.findIndex((r) => r.sourceRiskId === entry.sourceRiskId);
    }
    return register.findIndex((r) => r.riskName === entry.riskName && !r.sourceRiskId);
}

module.exports = { findRegisterEntryIndex };
