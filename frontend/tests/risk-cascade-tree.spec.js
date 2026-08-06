'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Árbol de Riesgos en Cascada', () => {
    test('un riesgo con "Riesgo Desencadenante" aparece anidado bajo su padre, y la rama se puede colapsar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Árbol — Riesgo Padre');

        // Riesgo hijo: página fresca (evita el modal de confirmación de "Nuevo Análisis") y
        // esta vez sí se elige "Riesgo Desencadenante" en el Paso 1 antes de avanzar.
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');
        await page.fill('#fair-riskName', 'E2E Árbol — Riesgo Hijo');
        await page.selectOption('#fair-triggered-by', 'E2E Árbol — Riesgo Padre');
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

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        const parentCard = page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Padre' });
        await expect(parentCard).toBeVisible();

        // El hijo debe estar DENTRO del <li> del padre (anidado en su <ul> de hijos), no solo
        // presente en algún lugar de la página — así se confirma la relación, no solo que
        // ambos nombres aparecen.
        const parentLi = page.locator('li', { has: parentCard });
        const childCard = parentLi.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Hijo' });
        await expect(childCard).toBeVisible();

        // Colapsar la rama del padre oculta al hijo sin quitarlo del DOM.
        await parentLi.locator('[data-tree-toggle]').first().click();
        await page.waitForTimeout(200);
        await expect(childCard).toBeHidden();
    });

    test('clic en una tarjeta abre su detalle, y "Tratar" lo carga en el wizard', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Árbol — Detalle');

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        await page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Detalle' }).click();
        await expect(page.locator('#modalTitle')).toHaveText('E2E Árbol — Detalle');
        await expect(page.locator('#modalBody')).toContainText('Pérdida Anual Esperada');

        await page.click('#risktree-detail-tratar-btn');
        await page.waitForTimeout(500);

        // "Tratar" reusa exactamente lo que ya hace "Analizar" en el Registro: aterriza en el
        // Paso 1 del wizard con el mismo riesgo cargado, no en Tratamiento directo (no existe
        // hoy una forma de saltar ahí sin volver a simular).
        await expect(page.locator('#fairAnalysisPage')).toBeVisible();
        await expect(page.locator('#fair-riskName')).toHaveValue('E2E Árbol — Detalle');
        await expect(page.locator('#fair-step-1')).toBeVisible();
    });
});
