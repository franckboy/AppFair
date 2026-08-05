'use strict';

const { Pool } = require('pg');
const { DEFAULTS } = require('./defaults');

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

    async _writeAll(data) {
        await this.pool.query('UPDATE store_data SET data = $1 WHERE id = 1', [JSON.stringify(data)]);
    }

    async get(key) {
        const all = await this._readAll();
        return all[key];
    }

    async set(key, value) {
        const all = await this._readAll();
        all[key] = value;
        await this._writeAll(all);
        return value;
    }

    async upsertRiskInRegister(entry) {
        const all = await this._readAll();
        const register = all.riskRegister || [];
        const idx = register.findIndex((r) => r.riskName === entry.riskName);
        if (idx !== -1) register[idx] = entry;
        else register.push(entry);
        all.riskRegister = register;
        await this._writeAll(all);
        return register;
    }

    async deleteRiskFromRegister(riskName) {
        const all = await this._readAll();
        all.riskRegister = (all.riskRegister || []).filter((r) => r.riskName !== riskName);
        await this._writeAll(all);
        return all.riskRegister;
    }

    async upsertAsset(entry) {
        const all = await this._readAll();
        const assets = all.assets || [];
        const idx = assets.findIndex((a) => a.id === entry.id);
        if (idx !== -1) assets[idx] = entry;
        else assets.push(entry);
        all.assets = assets;
        await this._writeAll(all);
        return assets;
    }

    async deleteAsset(id) {
        const all = await this._readAll();
        all.assets = (all.assets || []).filter((a) => a.id !== id);
        await this._writeAll(all);
        return all.assets;
    }

    async upsertRisk(entry) {
        const all = await this._readAll();
        const risks = all.risks || [];
        const idx = risks.findIndex((r) => r.id === entry.id);
        if (idx !== -1) risks[idx] = entry;
        else risks.push(entry);
        all.risks = risks;
        await this._writeAll(all);
        return risks;
    }

    async deleteRisk(id) {
        const all = await this._readAll();
        all.risks = (all.risks || []).filter((r) => r.id !== id);
        await this._writeAll(all);
        return all.risks;
    }
}

module.exports = { PostgresStore };
