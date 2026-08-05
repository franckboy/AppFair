'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULTS } = require('./defaults');
const { findRegisterEntryIndex } = require('../lib/registerIdentity');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'db.json');

/**
 * Almacenamiento mínimo basado en un archivo JSON local — pensado para que
 * el proyecto corra sin necesitar una base de datos externa desde el día 1
 * (desarrollo local, tests). En producción sobre una plataforma de disco
 * efímero (ej. Render free tier) este archivo se pierde en cada redeploy —
 * para eso existe PostgresStore (ver src/store/index.js), que se activa
 * solo si hay DATABASE_URL configurada.
 *
 * Todos los métodos son async (aunque internamente sean síncronos) para que
 * las rutas puedan hacer `await store.xxx()` sin importar cuál de los dos
 * backends esté activo.
 *
 * NOTA: no es seguro para escrituras concurrentes de muchos procesos a la
 * vez (usa un solo archivo).
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

    async init() {
        // El constructor ya garantiza el archivo — este método existe solo para que el
        // factory (src/store/index.js) pueda llamar `await store.init()` sin importar
        // cuál de los dos backends esté activo.
    }

    _readAll() {
        // Autorecuperación si el archivo desaparece después de construir el store (ej. se borró
        // a mano, o el disco efímero de un free tier lo perdió al reiniciar) — sin esto, cada
        // lectura tronaba con ENOENT hasta reiniciar el proceso.
        this._ensureFile();
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

    async get(key) {
        return this._readAll()[key];
    }

    async set(key, value) {
        const all = this._readAll();
        all[key] = value;
        this._writeAll(all);
        return value;
    }

    /** Agrega o actualiza una entrada del Registro de Riesgos (ver findRegisterEntryIndex). */
    async upsertRiskInRegister(entry) {
        const all = this._readAll();
        const register = all.riskRegister || [];
        const idx = findRegisterEntryIndex(register, entry);
        // Conserva el id existente si ya había una entrada; si no, usa el que trajo el cliente
        // o genera uno nuevo — así la respuesta siempre trae un id estable que el frontend
        // puede guardar y reutilizar en el próximo PUT/DELETE de este mismo riesgo.
        entry.id = (idx !== -1 && register[idx].id) || entry.id || crypto.randomUUID();
        if (idx !== -1) register[idx] = entry;
        else register.push(entry);
        all.riskRegister = register;
        this._writeAll(all);
        return register;
    }

    async deleteRiskFromRegister(riskName, { id = null, sourceRiskId = null } = {}) {
        const all = this._readAll();
        const register = all.riskRegister || [];
        const idx = findRegisterEntryIndex(register, { riskName, id, sourceRiskId });
        all.riskRegister = idx !== -1 ? register.filter((_, i) => i !== idx) : register;
        this._writeAll(all);
        return all.riskRegister;
    }

    /** Agrega o actualiza (por id) una entrada del Catálogo de Activos. */
    async upsertAsset(entry) {
        const all = this._readAll();
        const assets = all.assets || [];
        const idx = assets.findIndex((a) => a.id === entry.id);
        if (idx !== -1) assets[idx] = entry;
        else assets.push(entry);
        all.assets = assets;
        this._writeAll(all);
        return assets;
    }

    async deleteAsset(id) {
        const all = this._readAll();
        all.assets = (all.assets || []).filter((a) => a.id !== id);
        this._writeAll(all);
        return all.assets;
    }

    /**
     * Agrega o actualiza (por id) un riesgo del historial unificado — nace en Análisis Rápido
     * (antes solo vivía en localStorage del navegador, no en el backend) y puede seguir
     * actualizándose conforme avanza a FAIR/simulación. Igual que los activos, se identifica
     * por id (no por nombre) para poder editar/actualizar sin crear duplicados fantasma.
     */
    async upsertRisk(entry) {
        const all = this._readAll();
        const risks = all.risks || [];
        const idx = risks.findIndex((r) => r.id === entry.id);
        if (idx !== -1) risks[idx] = entry;
        else risks.push(entry);
        all.risks = risks;
        this._writeAll(all);
        return risks;
    }

    async deleteRisk(id) {
        const all = this._readAll();
        all.risks = (all.risks || []).filter((r) => r.id !== id);
        // Cascada: sin esto, una entrada del Registro vinculada a este riesgo (sourceRiskId)
        // quedaba huérfana si quien llamaba a este método no se acordaba de borrarla aparte —
        // antes esa garantía dependía por completo de la disciplina del frontend (ver
        // App.FairRegister.deleteConcentratedRisk); ahora el propio store la impone siempre,
        // sin importar quién o cómo se llame a este método.
        all.riskRegister = (all.riskRegister || []).filter((r) => r.sourceRiskId !== id);
        this._writeAll(all);
        return all.risks;
    }
}

module.exports = { JsonStore, DEFAULTS };
