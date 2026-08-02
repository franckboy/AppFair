'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');

const DEFAULTS = {
    riskCriteria: null, // se llena con defaultRiskCriteria si no existe
    orgDefaults: { currency: 'USD', defenseKey: 'estandar', owner: '', dataSource: 'experto-sin-calibrar', dataConfidence: 'medio' },
    orgContext: { mision: '', naturalezaNegocio: '', apetitoRiesgo: 'moderado', partesInteresadas: '', entornoLegal: '', alcanceCadenaSuministro: '' },
    riskRegister: [],
};

/**
 * Almacenamiento mínimo basado en un archivo JSON local — pensado para que
 * el proyecto corra sin necesitar una base de datos externa desde el día 1.
 * Para producción con varios usuarios concurrentes, reemplázalo por
 * PostgreSQL/MongoDB/etc. manteniendo la misma interfaz (get/set).
 *
 * NOTA: no es seguro para escrituras concurrentes de muchos procesos a la
 * vez (usa un solo archivo). Si vas a correr varias instancias del server,
 * cambia esto por una base de datos real antes de ese punto.
 */
class JsonStore {
    constructor(dbPath = DB_PATH) {
        this.dbPath = dbPath;
        this._ensureFile();
    }

    _ensureFile() {
        if (!fs.existsSync(this.dbPath)) {
            fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
            fs.writeFileSync(this.dbPath, JSON.stringify(DEFAULTS, null, 2));
        }
    }

    _readAll() {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        try {
            return { ...DEFAULTS, ...JSON.parse(raw) };
        } catch (e) {
            return { ...DEFAULTS };
        }
    }

    _writeAll(data) {
        fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    }

    get(key) {
        return this._readAll()[key];
    }

    set(key, value) {
        const all = this._readAll();
        all[key] = value;
        this._writeAll(all);
        return value;
    }

    /** Agrega o actualiza (por riskName) una entrada del Registro de Riesgos. */
    upsertRiskInRegister(entry) {
        const all = this._readAll();
        const register = all.riskRegister || [];
        const idx = register.findIndex((r) => r.riskName === entry.riskName);
        if (idx !== -1) register[idx] = entry;
        else register.push(entry);
        all.riskRegister = register;
        this._writeAll(all);
        return register;
    }

    deleteRiskFromRegister(riskName) {
        const all = this._readAll();
        all.riskRegister = (all.riskRegister || []).filter((r) => r.riskName !== riskName);
        this._writeAll(all);
        return all.riskRegister;
    }
}

module.exports = { JsonStore, DEFAULTS };
