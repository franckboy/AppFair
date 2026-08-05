'use strict';

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { createStore } = require('./src/store');
const { createApiKeyAuth } = require('./src/middleware/apiKeyAuth');
const createConfigRouter = require('./src/routes/config');
const createAutocalcRouter = require('./src/routes/autocalc');
const createSimulateRouter = require('./src/routes/simulate');
const createTreatmentRouter = require('./src/routes/treatment');
const createRegisterRouter = require('./src/routes/register');
const createAssetsRouter = require('./src/routes/assets');
const createRisksRouter = require('./src/routes/risks');

const app = express();
// Con DATABASE_URL configurada usa Postgres (persiste entre redeploys); si no, un archivo
// JSON local (desarrollo, tests). Ver src/store/index.js.
const store = createStore();
if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL no configurada — usando almacenamiento en archivo local (JsonStore). En plataformas de disco efímero (ej. Render free tier) los datos se pierden en cada redeploy. Ver backend/README.md para configurar una Postgres gratuita.');
}

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

// Sin ALLOWED_ORIGIN, CORS queda abierto a cualquier origen (igual que antes) — cómodo para
// desarrollo local, pero hay que restringirlo al dominio real del frontend antes de publicar.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
    console.warn('⚠️  ALLOWED_ORIGIN no configurada — CORS está abierto a cualquier origen. Está bien para desarrollo local; antes de publicar el frontend en un dominio real, define ALLOWED_ORIGIN en tu .env (ver .env.example).');
}
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));

app.use(express.json({ limit: '2mb' })); // 2mb por si el cliente reenvía annualLosses (10,000 números)

// Límite general de peticiones por IP — antes no había ninguno. Se aplica antes de la
// autenticación a propósito, para que también frene intentos de adivinar la API key a fuerza
// bruta, no solo el uso normal de la API ya autenticada. Configurable por variables de entorno
// (con el mismo default de siempre) porque una suite de pruebas E2E automatizada —o un backend
// compartido por varios clientes detrás de la misma IP/proxy— puede superar 300 peticiones en
// 15 minutos sin que sea abuso real; forzar ese límite ahí rompía la suite de Playwright.
app.use('/api', rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    limit: Number(process.env.RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas peticiones desde esta IP. Intenta de nuevo en unos minutos.' },
}));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'motor-riesgos-fair-backend' }));

// Todo lo demás bajo /api requiere la API key — el health check queda afuera
// a propósito, para que un monitor de uptime lo pueda seguir consultando.
app.use('/api', createApiKeyAuth(apiKey));

app.use('/api/config', createConfigRouter(store));
app.use('/api/autocalc', createAutocalcRouter());
app.use('/api/simulate', createSimulateRouter(store));
app.use('/api/treatment', createTreatmentRouter());
app.use('/api/register', createRegisterRouter(store));
app.use('/api/assets', createAssetsRouter(store));
app.use('/api/risks', createRisksRouter(store));

// Manejador de errores genérico — evita que una excepción no controlada tumbe el proceso
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    // store.init() crea la tabla en Postgres si hace falta (no-op en JsonStore) — se espera
    // antes de aceptar tráfico para no correr con la tabla a medio crear en el primer request.
    store.init()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Motor de Riesgos FAIR — backend corriendo en http://localhost:${PORT}`);
                console.log(`Prueba: curl http://localhost:${PORT}/api/health`);
            });
        })
        .catch((err) => {
            console.error('No se pudo inicializar el almacenamiento:', err);
            process.exit(1);
        });
}

// Exportado para pruebas (supertest, etc.) — en modo test nunca hay DATABASE_URL, así que
// esto siempre es un JsonStore ya listo por su constructor (no necesita await store.init()
// antes del primer request, a diferencia de PostgresStore en producción, arriba).
module.exports = app;
