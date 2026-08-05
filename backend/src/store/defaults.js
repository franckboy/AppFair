'use strict';

// Compartido entre JsonStore y PostgresStore — el documento inicial es el mismo
// sin importar dónde se persista.
const DEFAULTS = {
    riskCriteria: null, // se llena con defaultRiskCriteria si no existe
    orgDefaults: { currency: 'USD', defenseKey: 'estandar', owner: '', dataSource: 'experto-sin-calibrar', dataConfidence: 'medio' },
    orgContext: { mision: '', naturalezaNegocio: '', apetitoRiesgo: 'moderado', partesInteresadas: '', entornoLegal: '', alcanceCadenaSuministro: '' },
    riskRegister: [],
    assets: [],
    risks: [],
};

module.exports = { DEFAULTS };
