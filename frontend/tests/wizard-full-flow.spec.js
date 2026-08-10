'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Análisis FAIR completo', () => {
    test('Pasos 1→4 completos: el riesgo termina en Riesgos Guardados como Analizado (FAIR)', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Robo en Bodega Norte');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Robo en Bodega Norte' });
        await expect(row).toBeVisible();
        await expect(row).toContainText('Analizado (FAIR)');

        // Impacto y CVaR 95% deben mostrar un monto en dólares, no un placeholder vacío.
        const cells = row.locator('td');
        await expect(cells.nth(8)).toContainText('$'); // Impacto
        await expect(cells.nth(9)).toContainText('$'); // CVaR 95%
    });

    test('el asistente siempre abre en el Paso 1 al recargar — no salta directo al Paso 4', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Incendio en Almacén Este');

        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);

        await expect(page.locator('#fair-step-1')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-step-4')).toHaveClass(/hidden/);
        await expect(page.locator('#fair-resume-banner')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-riskName')).toHaveValue('');
    });

    test('vulnManualOverride se persiste en el Registro y se restaura fiel al retomar un riesgo (no siempre "manual")', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // runFullFairAnalysis nunca toca el checkbox de Vulnerabilidad — queda en modo automático.
        await runFullFairAnalysis(page, 'E2E — Vulnerabilidad Automática');

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === 'E2E — Vulnerabilidad Automática');
        expect(entry.vulnManualOverride).toBe(false);

        // Bug real corregido: antes, retomar CUALQUIER riesgo dejaba el checkbox marcado como
        // "editado a mano" sin importar si de verdad se había tocado — el autocálculo quedaba
        // roto para siempre desde el primer guardado. Ahora refleja el estado real.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        let row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Vulnerabilidad Automática' });
        await row.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(800);
        await expect(page.locator('#vuln-manual-override')).not.toBeChecked();

        // Un riesgo con Vulnerabilidad SÍ editada a mano debe persistir true y restaurarse marcado.
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Vulnerabilidad Manual');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.check('#vuln-manual-override');
        await page.fill('#vuln-mode', '55');
        await page.waitForTimeout(300);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E — Vulnerabilidad Manual');
        expect(entry.vulnManualOverride).toBe(true);

        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Vulnerabilidad Manual' });
        await row.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(800);
        await expect(page.locator('#vuln-manual-override')).toBeChecked();
    });
});
