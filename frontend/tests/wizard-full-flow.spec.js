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
});
