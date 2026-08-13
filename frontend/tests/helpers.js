'use strict';
const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const STUBS_DIR = path.join(__dirname, 'fixtures');
const CHART_JS = fs.readFileSync(path.join(STUBS_DIR, 'chart.umd.js'), 'utf8');
const HTML2CANVAS_JS = fs.readFileSync(path.join(STUBS_DIR, 'html2canvas.min.js'), 'utf8');
const CYTOSCAPE_JS = fs.readFileSync(path.join(STUBS_DIR, 'cytoscape.min.js'), 'utf8');
const CYTOSCAPE_DAGRE_JS = fs.readFileSync(path.join(STUBS_DIR, 'cytoscape-dagre.min.js'), 'utf8');
const CYTOSCAPE_NODE_HTML_LABEL_JS = fs.readFileSync(path.join(STUBS_DIR, 'cytoscape-node-html-label.min.js'), 'utf8');

// El entorno de CI no siempre tiene salida a cdnjs.cloudflare.com/jsdelivr — se sirven Chart.js,
// html2canvas y Cytoscape.js (+ sus 2 plugins, ver el Árbol de Riesgos en Cascada) desde archivos
// locales (misma versión exacta que <script src> en app_fair.html) en vez de la red real, y Font
// Awesome (solo iconos, cosmético) se stubbea vacío.
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
        await page.route('**cytoscape.min.js', (route) =>
            route.fulfill({ status: 200, contentType: 'application/javascript', body: CYTOSCAPE_JS }),
        );
        await page.route('**cytoscape-dagre.min.js', (route) =>
            route.fulfill({ status: 200, contentType: 'application/javascript', body: CYTOSCAPE_DAGRE_JS }),
        );
        await page.route('**cytoscape-node-html-label.min.js', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: CYTOSCAPE_NODE_HTML_LABEL_JS,
            }),
        );
        await use(page);
    },
});

// Arrancar la app tiene tres desenlaces posibles y NO se sabe de antemano cuál toca: se abre el
// gate de Contexto Organizacional, el de Criterios de Riesgo, o ninguno (ya estaban completos —
// el backend es compartido por toda la corrida, ver playwright.config.js, así que solo el primer
// test que llega hasta acá los ve realmente vacíos). Esta función espera a que ocurra CUALQUIERA
// de los tres, en vez de dormir un tiempo fijo y confiar en que ya pasó.
//
// Los botones del nav marcados .nav-requires-boot se habilitan solo cuando la app terminó de
// inicializarse y ningún gate está pendiente (ver App.Api.hideBootGate / App.OrgContext /
// App.Criteria) — ese es el indicador de "lista" más fiable que expone la app.
async function waitForGateOrReady(page) {
    await page.waitForFunction(
        () => {
            const abierto = (id) => {
                const el = document.getElementById(id);
                return !!el && !el.classList.contains('hidden');
            };
            const nav = document.getElementById('nav-fair');
            return abierto('orgcontext-gate') || abierto('criteria-gate') || (!!nav && !nav.disabled);
        },
        undefined,
        { timeout: 30000 },
    );
}

const gateAbierto = (page, id) =>
    page.evaluate((gateId) => {
        const el = document.getElementById(gateId);
        return !!el && !el.classList.contains('hidden');
    }, id);

// Conecta al backend de pruebas (misma API_KEY que arranca playwright.config.js) y completa los
// dos candados obligatorios (Contexto Organizacional y Criterios de Riesgo) SOLO si siguen
// pendientes.
//
// Flake real corregido: antes esto avanzaba con waitForTimeout fijos — 1s tras guardar la
// conexión (esperando que TODO el bootstrap, que son varias llamadas de red, cupiera ahí) y 500ms
// tras cada gate — y al terminar no esperaba nada. En una máquina cargada la app todavía no había
// llegado a switchPage('fair'), así que el test que seguía tocaba elementos aún ocultos o
// deshabilitados. Los síntomas eran siempre los mismos, en un test distinto en cada corrida:
// "element is not visible" (#fair-riskName, #fair-attacker-profile), "element is not enabled"
// (#nav-config y demás .nav-requires-boot) y "Execution context was destroyed" cuando el evaluate
// del gate caía justo sobre una navegación. Ahora cada paso espera una condición real.
async function connectAndBoot(page, { apiKey = 'test-e2e-key', baseUrl = 'http://localhost:3000' } = {}) {
    await page.goto('/app_fair.html', { waitUntil: 'networkidle' });
    await page.click('#nav-api-connection');
    await page.fill('#api-conn-baseurl', baseUrl);
    await page.fill('#api-conn-key', apiKey);
    await page.click('#api-conn-save-btn');
    await waitForGateOrReady(page);

    if (await gateAbierto(page, 'orgcontext-gate')) {
        await page.fill('#orgctx-gate-mision', 'Proteger las operaciones de la organización.');
        await page.fill('#orgctx-gate-naturaleza', 'Operaciones logísticas y almacenaje.');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/config/org-context'), { timeout: 15000 }),
            page.click('#orgctx-gate-save-btn'),
        ]);
        // Al cerrarse este gate puede abrirse el de Criterios, o quedar la app lista.
        await waitForGateOrReady(page);
    }

    if (await gateAbierto(page, 'criteria-gate')) {
        await page.fill('#criteria-gate-critico', '250000');
        await page.fill('#criteria-gate-percent', '20');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/config/criteria'), { timeout: 15000 }),
            page.click('#criteria-gate-save-btn'),
        ]);
    }

    // Sin esta espera final, connectAndBoot devolvía el control mientras la app seguía
    // inicializándose — la causa directa de los fallos intermitentes. La app queda usable cuando
    // el nav está habilitado Y la página por defecto ya se pintó (App.init → continueInit →
    // switchPage('fair')).
    await base.expect(page.locator('#nav-fair')).toBeEnabled({ timeout: 30000 });
    await base.expect(page.locator('#fair-riskName')).toBeVisible({ timeout: 30000 });
}

// Corre el wizard de FAIR completo (Pasos 1→4, con perfiles por defecto) para un riesgo NUEVO,
// dejando el Paso 1 ya con el nombre puesto — reutilizable en cualquier spec que solo necesite
// "un riesgo ya analizado" como punto de partida, sin repetir los 4 pasos a mano en cada archivo.
async function runFullFairAnalysis(page, riskName, { attacker = 'organizado', defense = 'basica' } = {}) {
    await page.fill('#fair-riskName', riskName);
    await page.click('#fair-step1-next');
    // Cada paso espera a que el SIGUIENTE ya esté en pantalla, en vez de dormir un tiempo fijo —
    // "#fair-attacker-profile: element is not visible" era uno de los fallos intermitentes más
    // frecuentes de la suite (ver el comentario de connectAndBoot).
    await base.expect(page.locator('#fair-attacker-profile')).toBeVisible({ timeout: 15000 });
    await page.selectOption('#fair-attacker-profile', attacker);
    await page.selectOption('#fair-defense-profile', defense);
    // Elegir perfiles dispara el autocálculo de Vulnerabilidad (una ida y vuelta a la red que
    // rellena el Paso 2) — sigue siendo una espera por tiempo porque lo que se busca es que ese
    // autocálculo se asiente, no que aparezca un elemento nuevo.
    await page.waitForTimeout(800);
    await page.click('#fair-step2-next');
    await base.expect(page.locator('#fair-step3-next')).toBeVisible({ timeout: 15000 });
    await page.click('#fair-step3-next');
    await base.expect(page.locator('#run-simulation-btn')).toBeVisible({ timeout: 15000 });

    // Los dos waiters se arman ANTES del clic: la simulación y el guardado en el Registro son dos
    // llamadas distintas, y varios specs consultan /api/register apenas vuelve este helper. Armar
    // la espera del PUT después de que ya ocurrió la dejaría colgada hasta el timeout.
    const simulado = page.waitForResponse((r) => r.url().includes('/api/simulate') && r.request().method() === 'POST', {
        timeout: 20000,
    });
    const guardado = page.waitForResponse((r) => r.url().includes('/api/register/') && r.request().method() === 'PUT', {
        timeout: 20000,
    });
    await page.click('#run-simulation-btn');
    await simulado;
    await guardado;
    await base.expect(page.locator('#ale-result')).not.toHaveText('', { timeout: 15000 });
}

module.exports = { test, expect: base.expect, connectAndBoot, runFullFairAnalysis };
