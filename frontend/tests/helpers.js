'use strict';
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STUBS_DIR = path.join(__dirname, 'fixtures');
const CHART_JS = fs.readFileSync(path.join(STUBS_DIR, 'chart.umd.js'), 'utf8');
const HTML2CANVAS_JS = fs.readFileSync(path.join(STUBS_DIR, 'html2canvas.min.js'), 'utf8');

// El entorno de CI no siempre tiene salida a cdnjs.cloudflare.com/jsdelivr — se sirven Chart.js y
// html2canvas desde archivos locales (misma versión exacta que <script src> en app_fair.html) en
// vez de la red real, y Font Awesome (solo iconos, cosmético) se stubbea vacío.
const test = base.test.extend({
    page: async ({ page }, use) => {
        await page.route('**://cdnjs.cloudflare.com/**', (route) =>
            route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
        );
        await page.route('**chart.umd.js', (route) =>
            route.fulfill({ status: 200, contentType: 'application/javascript', body: CHART_JS }),
        );
        await page.route('**html2canvas.min.js', (route) =>
            route.fulfill({ status: 200, contentType: 'application/javascript', body: HTML2CANVAS_JS }),
        );
        await use(page);
    },
});

// Conecta al backend de pruebas (misma API_KEY que arranca playwright.config.js) y completa el
// gate de Contexto Organizacional SOLO si todavía no se completó — el backend es compartido por
// toda la corrida (ver playwright.config.js), así que solo el primer test que llega hasta acá lo
// ve realmente vacío.
async function connectAndBoot(page, { apiKey = 'test-e2e-key', baseUrl = 'http://localhost:3000' } = {}) {
    await page.goto('/app_fair.html', { waitUntil: 'networkidle' });
    await page.click('#nav-api-connection');
    await page.fill('#api-conn-baseurl', baseUrl);
    await page.fill('#api-conn-key', apiKey);
    await page.click('#api-conn-save-btn');
    await page.waitForTimeout(1000);

    const gateVisible = await page.evaluate(
        () => !document.getElementById('orgcontext-gate').classList.contains('hidden'),
    );
    if (gateVisible) {
        await page.fill('#orgctx-gate-mision', 'Proteger las operaciones de la organización.');
        await page.fill('#orgctx-gate-naturaleza', 'Operaciones logísticas y almacenaje.');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/config/org-context'), { timeout: 10000 }),
            page.click('#orgctx-gate-save-btn'),
        ]);
        await page.waitForTimeout(500);
    }

    // Segundo candado obligatorio, justo después del de Contexto (ver App.Criteria.showGate) —
    // mismo criterio que arriba: solo el primer test que llega hasta acá lo ve realmente vacío.
    const criteriaGateVisible = await page.evaluate(
        () => !document.getElementById('criteria-gate').classList.contains('hidden'),
    );
    if (criteriaGateVisible) {
        await page.fill('#criteria-gate-critico', '250000');
        await page.fill('#criteria-gate-percent', '20');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/config/criteria'), { timeout: 10000 }),
            page.click('#criteria-gate-save-btn'),
        ]);
        await page.waitForTimeout(500);
    }
}

// Corre el wizard de FAIR completo (Pasos 1→4, con perfiles por defecto) para un riesgo NUEVO,
// dejando el Paso 1 ya con el nombre puesto — reutilizable en cualquier spec que solo necesite
// "un riesgo ya analizado" como punto de partida, sin repetir los 4 pasos a mano en cada archivo.
async function runFullFairAnalysis(page, riskName, { attacker = 'organizado', defense = 'basica' } = {}) {
    await page.fill('#fair-riskName', riskName);
    await page.click('#fair-step1-next');
    await page.waitForTimeout(300);
    await page.selectOption('#fair-attacker-profile', attacker);
    await page.selectOption('#fair-defense-profile', defense);
    await page.waitForTimeout(800);
    await page.click('#fair-step2-next');
    await page.waitForTimeout(500);
    await page.click('#fair-step3-next');
    await page.waitForTimeout(500);
    await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
        page.click('#run-simulation-btn'),
    ]);
    await page.waitForTimeout(1500);
}

module.exports = { test, expect: base.expect, connectAndBoot, runFullFairAnalysis };
