'use strict';

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');

const { JsonStore } = require('./src/store/jsonStore');
const { createApiKeyAuth } = require('./src/middleware/apiKeyAuth');
const createConfigRouter = require('./src/routes/config');
const createAutocalcRouter = require('./src/routes/autocalc');
const createSimulateRouter = require('./src/routes/simulate');
const createTreatmentRouter = require('./src/routes/treatment');
const createRegisterRouter = require('./src/routes/register');

const app = express();
const store = new JsonStore();

// Sin API_KEY configurada, la API queda completamente abierta a cualquier origen
// (Criterios de Riesgo, Contexto Organizacional y Registro de Riesgos incluidos).
// Si no hay una en el entorno, se genera una temporal para poder arrancar en local
// sin fricción — pero NUNCA se corre sin exigir el header X-API-Key.
let apiKey = process.env.API_KEY;
if (!apiKey) {
    apiKey = crypto.randomBytes(24).toString('hex');
    console.warn('⚠️  API_KEY no configurada — se generó una temporal solo para esta sesión (cambia en cada reinicio):');
    console.warn(`    ${apiKey}`);
    console.warn('   Define API_KEY en tu .env (ver .env.example) para producción o para que no cambie al reiniciar.');
}

app.use(cors());
app.use(express.json({ limit: '2mb' })); // 2mb por si el cliente reenvía annualLosses (10,000 números)

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'motor-riesgos-fair-backend' }));

// Todo lo demás bajo /api requiere la API key — el health check queda afuera
// a propósito, para que un monitor de uptime lo pueda seguir consultando.
app.use('/api', createApiKeyAuth(apiKey));

app.use('/api/config', createConfigRouter(store));
app.use('/api/autocalc', createAutocalcRouter());
app.use('/api/simulate', createSimulateRouter(store));
app.use('/api/treatment', createTreatmentRouter());
app.use('/api/register', createRegisterRouter(store));

// Manejador de errores genérico — evita que una excepción no controlada tumbe el proceso
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Motor de Riesgos FAIR — backend corriendo en http://localhost:${PORT}`);
        console.log(`Prueba: curl http://localhost:${PORT}/api/health`);
    });
}

module.exports = app; // exportado para pruebas (supertest, etc.)
