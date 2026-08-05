'use strict';

// Compartido entre JsonStore y PostgresStore — el documento inicial es el mismo
// sin importar dónde se persista.
const DEFAULTS = {
    riskCriteria: null, // se llena con defaultRiskCriteria si no existe
    // La app solo calcula en USD (ver la nota en routes/register.js) — ya no hay una moneda
    // por defecto que configurar.
    orgDefaults: { defenseKey: 'estandar', owner: '', dataSource: 'experto-sin-calibrar', dataConfidence: 'medio' },
    orgContext: { mision: '', naturalezaNegocio: '', apetitoRiesgo: 'moderado', partesInteresadas: '', entornoLegal: '', alcanceCadenaSuministro: '' },
    riskRegister: [],
    assets: [],
    risks: [],
};

module.exports = { DEFAULTS };
