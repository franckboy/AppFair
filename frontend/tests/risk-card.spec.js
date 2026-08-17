'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

// Un riesgo, un lugar. Antes, dejar UN riesgo terminado obligaba a recorrer cuatro pestañas y en
// ninguna se veía su estado completo: la navegación estaba organizada por HERRAMIENTA y el trabajo
// real está organizado por RIESGO. La ficha no reconstruye HTML — MUEVE los paneles que ya existen
// y los devuelve a su página al cerrar, así que lo que se prueba aquí es sobre todo eso: que vayan
// y vuelvan sin dejar ninguna página vacía.
test.describe('Ficha del riesgo', () => {
    const riskName = 'FICHA Robo en bodega';

    test.afterEach(async ({ page }) => {
        await page.evaluate(async (riskName) => {
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(riskName)}`, {
                method: 'DELETE',
                headers: { 'X-API-Key': 'test-e2e-key' },
            });
        }, riskName);
    });

    test('reúne Resultados, Tratamiento y Gobernanza en un solo lugar, y devuelve cada panel a su página al cerrar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, riskName);

        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);
        await page.click(`[data-simulate-risk="${riskName}"]`);

        // Cabecera: el nombre y la franja de estado con los hitos derivados de lo ya guardado.
        await expect(page.locator('#modalTitle')).toHaveText(riskName);
        const cabecera = page.locator('#modalBody');
        await expect(cabecera).toContainText('Analizado');
        await expect(cabecera).toContainText('Con dueño');

        // Pestaña 1 — Resultados: es donde abre, y trae los gráficos ya dibujados.
        await expect(page.locator('#risk-card-slot #dashboard-risk-detail')).toBeVisible();
        await expect(page.locator('#ale-result')).not.toHaveText('', { timeout: 20000 });

        // Pestaña 2 — Tratamiento: el panel entero de la página de Tratamiento, con ESTE riesgo.
        await page.click('[data-card-tab="tratamiento"]');
        await expect(page.locator('#risk-card-slot #fair-roi-content')).toBeVisible();
        await expect(page.locator('#fair-costoControlAnual')).toBeVisible();
        // Y responde: escribir un costo aquí adentro tiene que llegar al Registro.
        await page.fill('#fair-costoControlAnual', '4321');
        await page.waitForTimeout(1200);

        // Pestaña 3 — Gobernanza: sin el Riesgo Residual del Portafolio ni el Pareto, que son del
        // conjunto y se quedaron en su página.
        await page.click('[data-card-tab="gobernanza"]');
        await expect(page.locator('#risk-card-slot #riskmgmt-per-risk')).toBeVisible();
        await expect(page.locator('#fair-owner')).toBeVisible();
        await expect(page.locator('#risk-card-slot #riskmgmt-portfolio-section')).toHaveCount(0);
        await page.fill('#fair-owner', 'Jefa de Seguridad');
        await page.waitForTimeout(1200);

        await page.click('#risk-card-close-btn');

        // Lo que de verdad importa: los paneles volvieron a su página. Si se hubieran quedado
        // dentro del modal, estas dos pantallas se verían vacías.
        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await expect(page.locator('#treatmentPage #fair-roi-content')).toHaveCount(1);
        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await expect(page.locator('#riskMgmtPage #riskmgmt-per-risk')).toHaveCount(1);
        await expect(page.locator('#riskMgmtPage #riskmgmt-portfolio-section')).toHaveCount(1);

        // Y lo editado desde la ficha quedó guardado de verdad.
        const entry = await page.evaluate(async (riskName) => {
            const res = await fetch('http://localhost:3000/api/register', {
                headers: { 'X-API-Key': 'test-e2e-key' },
            });
            const data = await res.json();
            return data.risks.find((r) => r.riskName === riskName);
        }, riskName);
        expect(entry.mitigar.cost).toBe(4321);
        expect(entry.owner).toBe('Jefa de Seguridad');
    });

    test('abrir la ficha DOS veces sigue devolviendo los paneles a su página', async ({ page }) => {
        // El fallo que este test persigue: la "casa" de cada panel se recuerda la primera vez que
        // se mueve. Si se leyera en cada apertura, la segunda vez daría el cuerpo del modal y el
        // panel nunca volvería a su página — dejándola vacía para siempre.
        await connectAndBoot(page);
        await runFullFairAnalysis(page, riskName);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);

        for (const vuelta of [1, 2]) {
            await page.click(`[data-simulate-risk="${riskName}"]`);
            await page.click('[data-card-tab="gobernanza"]');
            await expect(page.locator('#risk-card-slot #riskmgmt-per-risk')).toBeVisible();
            await page.click('[data-card-tab="tratamiento"]');
            await expect(page.locator('#risk-card-slot #fair-roi-content')).toBeVisible();
            // Cambiar de pestaña también devuelve el panel anterior: dos paneles no pueden estar
            // en el mismo sitio, y el de Gobernanza tuvo que volver a su página.
            await expect(page.locator('#riskMgmtPage #riskmgmt-per-risk')).toHaveCount(1);
            await page.click('#risk-card-close-btn');
            await expect(page.locator('#treatmentPage #fair-roi-content')).toHaveCount(1, {
                message: `vuelta ${vuelta}`,
            });
        }
    });

    test('una Oportunidad no ofrece la pestaña de Tratamiento', async ({ page }) => {
        // ISO 31000, 6.5 asume una pérdida a reducir — mismo criterio que ya excluye 'oportunidad'
        // del selector de Tratamiento.
        await connectAndBoot(page);
        await page.evaluate(async (riskName) => {
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({
                    riskType: 'oportunidad',
                    vulnManualOverride: true,
                    tef: { min: 1, mode: 2, max: 3 },
                    vuln: { min: 20, mode: 40, max: 60 },
                    lossMagnitudes: { respuesta: { min: 1000, mode: 5000, max: 20000 } },
                    ale: 5000,
                    cvar95: 12000,
                    evaluationLevel: 'Aceptable',
                }),
            });
        }, riskName);

        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);
        await page.click(`[data-simulate-risk="${riskName}"]`);

        await expect(page.locator('[data-card-tab="resultados"]')).toBeVisible();
        await expect(page.locator('[data-card-tab="gobernanza"]')).toBeVisible();
        await expect(page.locator('[data-card-tab="tratamiento"]')).toHaveCount(0);
    });
});
