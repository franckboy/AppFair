'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Eliminar un riesgo', () => {
    test('borrar un riesgo ya analizado lo quita del Registro sin dejar huérfanos', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Robo de Equipo de Cómputo');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Robo de Equipo de Cómputo' });
        await expect(row).toBeVisible();

        // deleteConcentratedRisk borra directo al hacer clic — no hay modal de confirmación.
        await row.locator('[data-delete-risk]').click();
        await page.waitForTimeout(800);

        await expect(
            page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Robo de Equipo de Cómputo' }),
        ).toHaveCount(0);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        expect(register.risks.some((r) => r.riskName === 'E2E — Robo de Equipo de Cómputo')).toBe(false);
    });
});
