'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Informe Consolidado (PDF único)', () => {
    test('incluye el resumen de portafolio y el detalle técnico completo de cada riesgo', async ({ page }) => {
        await page.addInitScript(() => {
            window.print = () => { window.__printCalled = (window.__printCalled || 0) + 1; };
        });
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Incendio en Almacén Central');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-export-consolidated-btn')).toBeVisible();
        // El botón individual del Paso 4 se eliminó — el único punto de exportación es este.
        await expect(page.locator('#fair-export-report-btn')).toHaveCount(0);

        await page.click('#fair-export-consolidated-btn');
        await page.waitForTimeout(3000); // recalcula Tratamiento por riesgo + regenera histogramas

        const printCalled = await page.evaluate(() => window.__printCalled || 0);
        expect(printCalled).toBeGreaterThan(0);

        const reportHTML = await page.locator('#fair-print-report').innerHTML();
        expect(reportHTML).toContain('Informe Consolidado de Riesgos');
        expect(reportHTML).toContain('Contexto Organizacional');
        expect(reportHTML).toContain('Mapa de Calor Consolidado');
        expect(reportHTML).toContain('Análisis 80-20');
        expect(reportHTML).toContain('Sensibilidad Consolidada');

        // Detalle técnico completo del riesgo — antes vivía en un PDF aparte (eliminado).
        expect(reportHTML).toContain('E2E — Incendio en Almacén Central');
        expect(reportHTML).toContain('Alcance del Riesgo');
        expect(reportHTML).toContain('Gobernanza y Calidad de la Información');
        expect(reportHTML).toContain('Frecuencia y Vulnerabilidad');
        expect(reportHTML).toContain('Magnitud de Pérdida por Categoría');
        expect(reportHTML).toContain('Resultados de la Simulación Monte Carlo');
        expect(reportHTML).toContain('Análisis de Sensibilidad');
        expect(reportHTML).toContain('Comparación de Estrategias de Tratamiento');
    });
});
