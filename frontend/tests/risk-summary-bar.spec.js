'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

// La barra persistente de riesgo (App.RiskSummaryBar, ver #risk-summary-bar en app_fair.html)
// vive fuera de #fair-wizard-wrapper, entre el header y el contenido de cada página. Sin datos
// que mostrar quedaría oculta por completo (sin mostrar 3 mosaicos vacíos) — pero eso NO se
// verifica aquí con connectAndBoot recién hecho: toda la suite E2E comparte un único backend
// (ver playwright.config.js), así que para cuando este spec corre el Registro casi siempre ya
// tiene riesgos de OTROS archivos de test y la barra ya está visible desde antes. Lo que sí es
// determinista, sin importar el orden de la suite: que el tile "en curso" nace oculto para UN
// riesgo nuevo específico y aparece justo después de simularlo.
test.describe('Barra persistente de riesgo (Actual/Residual del portafolio + riesgo en curso)', () => {
    test('aparece con la primera simulación, refleja el portafolio y navega al hacer clic', async ({ page }) => {
        await connectAndBoot(page);

        const riskName = 'E2E Barra — Robo en Bodega';
        await page.fill('#fair-riskName', riskName);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);

        // Antes de simular, la app está en el Paso 4 pero todavía no hay un riesgo "en curso"
        // con evaluación — el tile permanece oculto hasta que la simulación resuelva.
        await expect(page.locator('#risk-summary-current')).toBeHidden();

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1000);

        await expect(page.locator('#risk-summary-bar')).toBeVisible();
        await expect(page.locator('#risk-summary-current')).toBeVisible();
        await expect(page.locator('#risk-summary-current-detail')).toHaveText(riskName);
        await expect(page.locator('#risk-summary-current-value')).toContainText('$');
        // El portafolio ya incluye este riesgo recién guardado — ninguno de los 2 mosaicos
        // del portafolio debe quedarse en el placeholder "—".
        await expect(page.locator('#risk-summary-actual-value')).toContainText('$');
        await expect(page.locator('#risk-summary-residual-value')).toContainText('$');

        // Clic en "Estás analizando ahora" navega directo al Paso 4 del wizard, desde otra página.
        await page.click('#nav-dashboard');
        await page.waitForTimeout(300);
        await page.click('#risk-summary-current');
        await page.waitForTimeout(300);
        await expect(page.locator('#fairAnalysisPage')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-step-4')).not.toHaveClass(/hidden/);

        // Clic en el mosaico Residual navega a Gestión de Riesgos.
        await page.click('#risk-summary-residual');
        await page.waitForTimeout(300);
        await expect(page.locator('#riskMgmtPage')).not.toHaveClass(/hidden/);

        // "Borrar todo" (reset del wizard) oculta el tile "en curso" — ya no hay análisis
        // activo — pero los mosaicos del portafolio siguen mostrando el riesgo ya guardado.
        await page.click('#nav-fair');
        await page.waitForTimeout(300);
        await page.click('#fair-reset-btn');
        await page.waitForTimeout(300);
        await page.click('#modal-confirm-btn');
        await page.waitForTimeout(500);
        await expect(page.locator('#risk-summary-current')).toBeHidden();
        await expect(page.locator('#risk-summary-bar')).toBeVisible();
    });
});
