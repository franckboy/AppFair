// @ts-check
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

// Algunos entornos de desarrollo traen un Chromium preinstalado en una ruta fija (sin acceso de
// red para que Playwright descargue su propia revisión) — si existe, se usa directo. En CI (con
// `npx playwright install`, ver el workflow) esta ruta no existe y se usa el Chromium normal que
// instala Playwright.
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumExecutablePath = fs.existsSync(PRESET_CHROMIUM) ? PRESET_CHROMIUM : undefined;

// Todos los tests comparten un único backend (y su db.json) durante toda la corrida — no hay
// aislamiento de datos por test todavía (ver el plan de migración, Fase 0). Por eso:
//   - workers: 1 y fullyParallel: false, para que dos tests no lean/escriban el Registro al
//     mismo tiempo y se pisen entre sí.
//   - cada test usa nombres de riesgo descriptivos y únicos, para poder aislar sus propias
//     aserciones aunque el Registro acumule datos de tests anteriores en la misma corrida.
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    timeout: 45000,
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
            },
        },
    ],
    webServer: [
        {
            // db.json se borra antes de arrancar para que cada corrida completa empiece en blanco
            // (Contexto Organizacional sin completar, Registro vacío) — no se borra ENTRE tests
            // individuales, solo al inicio de toda la suite. RATE_LIMIT_MAX alto porque la suite
            // completa hace bastantes más de 300 peticiones (el default de producción) contra el
            // mismo backend en pocos minutos — sin esto, el rate limiter empieza a responder 429 a
            // mitad de la corrida y los tests fallan por una razón que no tiene nada que ver con lo
            // que están probando.
            command:
                'rm -f ../backend/data/db.json && API_KEY=test-e2e-key RATE_LIMIT_MAX=100000 node ../backend/server.js',
            url: 'http://localhost:3000/api/health',
            reuseExistingServer: !process.env.CI,
            timeout: 30000,
            stdout: 'pipe',
        },
        {
            // Servidor de desarrollo de Vite (Fase 1 del plan de migración) en vez de un servidor
            // estático plano — sirve app_fair.html por su ruta de archivo real, igual que antes.
            command: 'npm run dev -- --port 8080 --strictPort',
            url: 'http://localhost:8080/app_fair.html',
            reuseExistingServer: !process.env.CI,
            timeout: 15000,
            stdout: 'pipe',
        },
    ],
});
