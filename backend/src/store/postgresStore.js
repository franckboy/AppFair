'use strict';

const { Pool } = require('pg');
const crypto = require('crypto');
const { DEFAULTS } = require('./defaults');
const { findRegisterEntryIndex } = require('../lib/registerIdentity');
const { clearDanglingAssetId } = require('../lib/assetCascade');

/**
 * Mismo modelo que JsonStore (un solo documento con todas las colecciones),
 * pero persistido en Postgres en vez de un archivo local — sobrevive a
 * redeploys en plataformas de disco efímero (ej. Render free tier), a
 * diferencia de JsonStore. Se activa solo si hay DATABASE_URL (ver
 * src/store/index.js); si no, el proyecto sigue funcionando con JsonStore
 * exactamente como antes.
 *
 * Se guarda como una sola fila jsonb (id=1) en vez de tablas relacionales
 * por colección — mantiene get/set/upsertX idénticos a JsonStore sin
 * rediseñar el esquema de datos de todo el proyecto.
 */
class PostgresStore {
    constructor(connectionString) {
        this.pool = new Pool({
            connectionString,
            // Neon (y la mayoría de Postgres gratuitos externos) exige TLS; rejectUnauthorized:false
            // porque estos proveedores usan certificados de una CA intermedia que Node no siempre
            // trae reconocida por defecto — el propio proveedor ya garantiza el canal cifrado.
            ssl: connectionString && connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
        });
    }

    async init() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS store_data (
                id INTEGER PRIMARY KEY DEFAULT 1,
                data JSONB NOT NULL,
                CONSTRAINT single_row CHECK (id = 1)
            )
        `);
        const { rows } = await this.pool.query('SELECT data FROM store_data WHERE id = 1');
        if (rows.length === 0) {
            await this.pool.query('INSERT INTO store_data (id, data) VALUES (1, $1)', [JSON.stringify(DEFAULTS)]);
        }
    }

    async _readAll() {
        const { rows } = await this.pool.query('SELECT data FROM store_data WHERE id = 1');
        if (rows.length === 0) return { ...DEFAULTS };
        return { ...DEFAULTS, ...rows[0].data };
    }

    /**
     * Envuelve un ciclo "leer todo → modificar → escribir todo" en una sola transacción, con
     * `SELECT ... FOR UPDATE` para bloquear la fila mientras dura — así ninguna otra petición
     * puede leer esta misma fila hasta que esta transacción termine (COMMIT o ROLLBACK).
     *
     * Bug real que esto corrige: antes, cada método hacía su propio `_readAll()` seguido de un
     * `_writeAll()` como dos llamadas SUELTAS al pool — sin nada que las uniera, dos peticiones
     * casi simultáneas podían leer la MISMA foto de los datos antes de que cualquiera de las dos
     * llegara a escribir, y la que escribía último borraba por completo el cambio de la otra
     * (ej. dos riesgos guardados casi a la vez → uno de los dos desaparecía en silencio). Con
     * `await store.query('SELECT ... FOR UPDATE')` dentro de una transacción, la segunda
     * petición que intente el mismo SELECT se queda esperando hasta que la primera confirme su
     * escritura — la misma garantía que JsonStore ya tenía "gratis" por ser todo síncrono dentro
     * de un solo proceso Node.
     *
     * `mutator(all)` recibe el documento completo (con los defaults ya aplicados) para
     * modificarlo en el sitio y debe devolver lo que el método público quiere retornar — el valor
     * de esa función es lo que `_withLock` propaga tal cual, después de confirmar la escritura.
     *
     * @template T
     * @param {(all: Object) => T} mutator
     * @returns {Promise<T>}
     */
    async _withLock(mutator) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query('SELECT data FROM store_data WHERE id = 1 FOR UPDATE');
            // init() garantiza esta fila antes de que el servidor acepte tráfico (ver server.js) —
            // el fallback a DEFAULTS es solo defensivo, igual que en _readAll().
            const all = rows.length === 0 ? { ...DEFAULTS } : { ...DEFAULTS, ...rows[0].data };
            const result = mutator(all);
            await client.query('UPDATE store_data SET data = $1 WHERE id = 1', [JSON.stringify(all)]);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    async get(key) {
        // Solo lectura — no hay ningún "modificar y volver a escribir" que proteger, así que no
        // hace falta pasar por _withLock (evita bloquear la fila sin necesidad).
        const all = await this._readAll();
        return all[key];
    }

    async set(key, value) {
        return this._withLock((all) => {
            all[key] = value;
            return value;
        });
    }

    // Lee y escribe en un solo paso, DENTRO de la misma transacción bloqueada — usado por PUT
    // /api/config/org-defaults y org-context, que antes hacían su propio store.get() (sin lock)
    // seguido de un store.set() aparte en la ruta misma. Bug real: aunque set() ya sea atómico
    // por dentro, ese get() suelto en la ruta seguía dejando el mismo hueco de carrera un nivel
    // más arriba — dos PUT casi simultáneos podían leer el mismo "actual", mezclar cada uno su
    // propio cambio, y el segundo set() pisaba por completo la mezcla del primero (ej. dos
    // ediciones a campos DISTINTOS de Contexto Organizacional, una de las dos se perdía).
    async mergeConfig(key, partial) {
        return this._withLock((all) => {
            const updated = { ...(all[key] || {}), ...partial };
            all[key] = updated;
            return updated;
        });
    }

    async upsertRiskInRegister(entry) {
        return this._withLock((all) => {
            const register = all.riskRegister || [];
            const idx = findRegisterEntryIndex(register, entry);
            entry.id = (idx !== -1 && register[idx].id) || entry.id || crypto.randomUUID();
            if (idx !== -1) register[idx] = entry;
            else register.push(entry);
            all.riskRegister = register;
            return register;
        });
    }

    async deleteRiskFromRegister(riskName, { id = null, sourceRiskId = null } = {}) {
        return this._withLock((all) => {
            const register = all.riskRegister || [];
            const idx = findRegisterEntryIndex(register, { riskName, id, sourceRiskId });
            all.riskRegister = idx !== -1 ? register.filter((_, i) => i !== idx) : register;
            return all.riskRegister;
        });
    }

    async upsertAsset(entry) {
        return this._withLock((all) => {
            const assets = all.assets || [];
            const idx = assets.findIndex((a) => a.id === entry.id);
            if (idx !== -1) assets[idx] = entry;
            else assets.push(entry);
            all.assets = assets;
            return assets;
        });
    }

    async deleteAsset(id) {
        return this._withLock((all) => {
            all.assets = (all.assets || []).filter((a) => a.id !== id);
            // Cascada: ver assetCascade.js — mismo criterio que JsonStore.deleteAsset.
            clearDanglingAssetId(all, id);
            return all.assets;
        });
    }

    async upsertRisk(entry) {
        return this._withLock((all) => {
            const risks = all.risks || [];
            const idx = risks.findIndex((r) => r.id === entry.id);
            if (idx !== -1) risks[idx] = entry;
            else risks.push(entry);
            all.risks = risks;
            return risks;
        });
    }

    async deleteRisk(id) {
        return this._withLock((all) => {
            all.risks = (all.risks || []).filter((r) => r.id !== id);
            // Cascada: sin esto, una entrada del Registro vinculada a este riesgo (sourceRiskId)
            // quedaba huérfana si quien llamaba a este método no se acordaba de borrarla aparte —
            // el propio store la impone siempre, sin importar quién o cómo se llame a este método.
            all.riskRegister = (all.riskRegister || []).filter((r) => r.sourceRiskId !== id);
            return all.risks;
        });
    }
}

module.exports = { PostgresStore };
