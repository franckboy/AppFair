'use strict';

// Compartido entre JsonStore y PostgresStore — el documento inicial es el mismo
// sin importar dónde se persista.
const DEFAULTS = {
    riskCriteria: null, // se llena con defaultRiskCriteria si no existe
    // La app solo calcula en USD (ver la nota en routes/register.js) — ya no hay una moneda
    // por defecto que configurar.
    orgDefaults: { defenseKey: 'estandar', owner: '', dataSource: 'experto-sin-calibrar', dataConfidence: 'medio' },
    orgContext: {
        nombreEmpresa: '',
        mision: '',
        naturalezaNegocio: '',
        apetitoRiesgo: 'moderado',
        partesInteresadas: '',
        entornoLegal: '',
        alcanceCadenaSuministro: '',
    },
    // Bitácora de incidentes reales (ver lib/incidentLog.js). Arranca vacía a propósito: una
    // bitácora en blanco significa "nadie midió nada todavía", que es distinto de "no pasó nada".
    incidentLog: { entries: [], actualizadoEn: null },
    riskRegister: [],
    assets: [],
    risks: [],
};

module.exports = { DEFAULTS };
