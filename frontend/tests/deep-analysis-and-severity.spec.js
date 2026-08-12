'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Análisis Profundo', () => {
    test('seleccionar un riesgo con el checkbox y abrir "Análisis Profundo" muestra su detalle', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Robo con Violencia en Sucursal');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E — Robo con Violencia en Sucursal',
        });
        await row.locator('.concentrated-checkbox').check();
        await expect(page.locator('#fair-deep-analysis-btn')).toBeEnabled();

        await page.click('#fair-deep-analysis-btn');
        await page.waitForTimeout(300);
        await expect(page.locator('#fair-deep-analysis-panel')).not.toHaveClass(/hidden/);
        const cardText = await page.locator('#fair-deep-analysis-body').textContent();
        expect(cardText).toContain('E2E — Robo con Violencia en Sucursal');
        expect(cardText).toContain('Frecuencia de Evento de Amenaza');
        expect(cardText).toContain('Magnitud de Pérdida');

        await page.click('#fair-deep-analysis-close');
        await expect(page.locator('#fair-deep-analysis-panel')).toHaveClass(/hidden/);
    });
});

test.describe('Criterios de Riesgo aplicados de forma consistente', () => {
    test('Riesgo Actual y Evaluación comparten la misma clasificación de color', async ({ page }) => {
        // La columna "Impacto" (que mostraba fmt(entry.ale), el MISMO número que "Riesgo Actual")
        // se quitó por ser un duplicado — antes este test comparaba las 3 columnas entre sí, ahora
        // solo quedan las 2 que de verdad son fuentes independientes de esa clasificación:
        // "Riesgo Actual" (entry.ale/severity) y "Evaluación" (evaluationLevel/evaluationClasses).
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Vandalismo en Fachada Principal');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E — Vandalismo en Fachada Principal',
        });
        const cells = row.locator('td');
        // índices: 0 checkbox, 1 #, 2 riesgo, 3 etapa, 4 inherente, 5 efectividad, 6 actual,
        // 7 activo, 8 cvar, 9 evaluación.
        const residualClass = await cells.nth(6).locator('span').getAttribute('class');
        const evalClass = await cells.nth(9).locator('span').getAttribute('class');

        expect(residualClass).toBe(evalClass);

        // Riesgo Inherente debe tener SU PROPIA clasificación (siempre visible, puede coincidir
        // o no con la de Actual dependiendo de la Vulnerabilidad).
        const inherenteText = await cells.nth(4).textContent();
        expect(inherenteText.trim()).not.toBe('');
        expect(inherenteText.trim()).not.toBe('—');
    });
});
