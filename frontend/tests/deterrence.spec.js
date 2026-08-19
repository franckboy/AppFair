'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// Siembra un riesgo listo para Tratamiento con el perfil de atacante que se le pida. Se hace por
// API y no por el asistente porque el asistente no deja elegir el perfil sin recorrerlo entero, y
// lo que se prueba acá es justamente la diferencia entre un perfil y otro.
async function seedRisk(page, riskName, attackerKey) {
    await page.evaluate(
        async ({ API, KEY, riskName, attackerKey }) => {
            await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                body: JSON.stringify({
                    riskType: 'amenaza',
                    attackerKey,
                    defenseKey: 'basica',
                    vulnManualOverride: true,
                    tef: { min: 0.8, mode: 1, max: 1.2 },
                    vuln: { min: 30, mode: 40, max: 50 },
                    lossMagnitudes: { respuesta: { min: 250000, mode: 275000, max: 300000 } },
                    ale: 110000,
                    cvar95: 400000,
                    evaluationLevel: 'Alto',
                    severity: 'alto',
                }),
            });
        },
        { API, KEY, riskName, attackerKey },
    );
}

async function abrirPanel(page, riskName) {
    await page.click('#nav-treatment');
    await page.waitForTimeout(800);
    await page.selectOption('#treatment-risk-select', riskName);
    await page.waitForTimeout(800);
    await page.click('#fair-nash-open-btn');
    await page.waitForTimeout(300);
}

async function calcular(page) {
    await page.fill('#nash-m', '1.5');
    await page.fill('#nash-cost-attacker', '800');
    await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/autocalc/deterrence'), { timeout: 20000 }),
        page.click('#deterrence-calculate-btn'),
    ]);
    await expect(page.locator('#deterrence-results')).toBeVisible();
}

test.describe('Punto de disuasión (¿a partir de cuánto deja de convenirle atacarte?)', () => {
    test('a un oportunista sí se lo saca con inversión, y dice en qué porcentaje de escenarios', async ({ page }) => {
        const riskName = 'E2E Disuasión — Oportunista';
        await connectAndBoot(page);
        // Modo Técnico: el panel exploratorio es `advanced-only`.
        if (await page.evaluate(() => document.body.classList.contains('modo-simple'))) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }
        await seedRisk(page, riskName, 'oportunista');
        await abrirPanel(page, riskName);

        // El supuesto del atacante se pre-carga con la sugerencia del perfil, que viene del
        // backend — no de una copia en el frontend que se podría desincronizar.
        await expect(page.locator('#deterrence-outside-option')).toHaveValue('50');
        await expect(page.locator('#deterrence-outside-hint')).toContainText('vecino');

        await calcular(page);
        await expect(page.locator('#deterrence-headline')).toContainText('Se va a partir de');
        await expect(page.locator('#deterrence-detail')).toContainText('se va a otro objetivo');
        // El supuesto usado se declara junto al resultado: es lo único que no se puede medir.
        await expect(page.locator('#deterrence-assumption-note')).toContainText('criterio, no medición');
        await expect(page.locator('#deterrence-assumption-note')).toContainText('sin cambiar');
    });

    test('al empleado desleal no lo saca ninguna inversión, y la pantalla lo dice', async ({ page }) => {
        // La afirmación que más cambia una decisión de compra: contra quien ya está adentro, el
        // dinero compra que le cueste más lograrlo, nunca que deje de intentarlo. Es el invariante
        // del modelo llevado hasta lo que el usuario ve.
        const riskName = 'E2E Disuasión — Insider';
        await connectAndBoot(page);
        if (await page.evaluate(() => document.body.classList.contains('modo-simple'))) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }
        await seedRisk(page, riskName, 'empleado-desleal');
        await abrirPanel(page, riskName);

        await expect(page.locator('#deterrence-outside-option')).toHaveValue('0');
        await expect(page.locator('#deterrence-outside-hint')).toContainText('ya está adentro');

        await calcular(page);
        await expect(page.locator('#deterrence-headline')).toContainText('no lo saca ninguna inversión');
        await expect(page.locator('#deterrence-detail')).toContainText('100 %');
    });

    test('cambiar el supuesto se refleja en el resultado, y queda declarado que se cambió', async ({ page }) => {
        // La protección contra el "juguete peligroso": mover el supuesto SÍ mueve la respuesta, así
        // que el resultado tiene que decir que se movió, no presentarse como si fuera el sugerido.
        const riskName = 'E2E Disuasión — Supuesto movido';
        await connectAndBoot(page);
        if (await page.evaluate(() => document.body.classList.contains('modo-simple'))) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }
        await seedRisk(page, riskName, 'organizado');
        await abrirPanel(page, riskName);

        // Con el sugerido del crimen organizado (15 %) no se lo disuade.
        await expect(page.locator('#deterrence-outside-option')).toHaveValue('15');
        await calcular(page);
        await expect(page.locator('#deterrence-headline')).toContainText('Ni la defensa máxima');

        // Subiendo mucho su alternativa, sí — y la nota tiene que delatar el cambio.
        await page.fill('#deterrence-outside-option', '70');
        await calcular(page);
        await expect(page.locator('#deterrence-headline')).toContainText('Se va a partir de');
        await expect(page.locator('#deterrence-assumption-note')).toContainText('tú lo cambiaste');
        await expect(page.locator('#deterrence-assumption-note')).toContainText('15 %');
    });
});
