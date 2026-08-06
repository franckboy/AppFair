'use strict';

/**
 * Limpia el vínculo real hacia un activo eliminado (`assetId`) de todo lo que lo referencie —
 * usado por JsonStore/PostgresStore.deleteAsset, para que ambos backends de persistencia
 * apliquen exactamente la misma cascada (ver el mismo criterio en registerIdentity.js).
 *
 * A diferencia de borrar un riesgo (que sí borra en cascada su entrada del Registro vinculada,
 * ver deleteRisk), acá el activo desapareció, no el riesgo — solo se limpia el vínculo
 * (assetId → null), nunca se borra la entrada. El nombre del activo copiado en `asset`/
 * `fullData.asset` (una foto del momento en que se guardó) se conserva tal cual, a propósito:
 * sigue siendo información válida ("qué activo tenía en mente cuando se apreció este riesgo"),
 * aunque el registro real del catálogo ya no exista.
 *
 * Dos fuentes distintas pueden traer el mismo vínculo (ver App.AssetCatalog.linkedRisksFor en
 * el frontend): una entrada ya simulada del Registro (`riskRegister[].assetId`), o un borrador
 * de Análisis Rápido/Paso 1 todavía sin simular (`risks[].fullData.assetId`) — se limpian las
 * dos, si no un borrador se quedaría enlazado a un activo fantasma que ni siquiera aparece en
 * el Registro todavía.
 *
 * @param {{riskRegister?: Array<Object>, risks?: Array<Object>}} data
 * @param {string} assetId
 * @returns {{riskRegister?: Array<Object>, risks?: Array<Object>}} el mismo `data`, mutado
 */
function clearDanglingAssetId(data, assetId) {
    if (data.riskRegister) {
        data.riskRegister = data.riskRegister.map((r) => (r.assetId === assetId ? { ...r, assetId: null } : r));
    }
    if (data.risks) {
        data.risks = data.risks.map((r) =>
            r.fullData && r.fullData.assetId === assetId ? { ...r, fullData: { ...r.fullData, assetId: null } } : r,
        );
    }
    return data;
}

module.exports = { clearDanglingAssetId };
