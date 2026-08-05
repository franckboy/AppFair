'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Guardar borrador en el Paso 1', () => {
    test('"Guardar" deja el riesgo como Triage, y "Analizar con FAIR" lo retoma y lo fusiona en una sola fila', async ({
        page,
    }) => {
        await connectAndBoot(page);

        await page.fill('#fair-riskName', 'E2E — Sabotaje en Línea de Producción');
        await page.fill('#fair-asset', 'Línea de Producción 4');
        await page.fill('#fair-threat', 'Empleado descontento');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/risks') && r.request().method() === 'POST', {
                timeout: 10000,
            }),
            page.click('#fair-save-draft-btn'),
        ]);
        await page.waitForTimeout(800);

        // Sigue en el Paso 1 — "Guardar" no debe forzar avanzar el wizard.
        await expect(page.locator('#fair-step-1')).not.toHaveClass(/hidden/);

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const draftRow = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E — Sabotaje en Línea de Producción',
        });
        await expect(draftRow).toContainText('Triage');

        await draftRow.locator('[data-analyze-quick]').click();
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-riskName')).toHaveValue('E2E — Sabotaje en Línea de Producción');
        await expect(page.locator('#fair-asset')).toHaveValue('Línea de Producción 4');
        await expect(page.locator('#fair-threat')).toHaveValue('Empleado descontento');

        // Completar el resto del wizard — debe fusionarse en la MISMA fila, no duplicarse.
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
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

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const matches = register.risks.filter((r) => r.riskName === 'E2E — Sabotaje en Línea de Producción');
        expect(matches).toHaveLength(1);

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const rows = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E — Sabotaje en Línea de Producción',
        });
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Analizado (FAIR)');
    });
});

test.describe('Reanudar un análisis guardado (REGRESIÓN)', () => {
    test('recargar, reanudar y volver a simular NO duplica la entrada en el Registro', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Fuga de Información Confidencial');

        const before = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const originalEntry = before.risks.find((r) => r.riskName === 'E2E — Fuga de Información Confidencial');
        expect(originalEntry).toBeTruthy();
        const originalId = originalEntry.id;

        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        await expect(page.locator('#fair-resume-banner')).not.toHaveClass(/hidden/);

        await page.click('#fair-resume-banner-btn');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        const after = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const matches = after.risks.filter((r) => r.riskName === 'E2E — Fuga de Información Confidencial');
        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe(originalId);
    });
});
