'use strict';

const { JsonStore } = require('./jsonStore');
const { PostgresStore } = require('./postgresStore');

/**
 * Con DATABASE_URL configurada (ej. una Postgres gratuita de Neon/Supabase), los datos
 * sobreviven a cada redeploy. Sin ella, cae de vuelta a JsonStore (archivo local) — sigue
 * funcionando igual que antes para desarrollo local y para los tests, que nunca configuran
 * DATABASE_URL a propósito.
 */
function createStore() {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
        return new PostgresStore(databaseUrl);
    }
    return new JsonStore();
}

module.exports = { createStore };
