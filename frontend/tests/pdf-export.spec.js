'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Informe Consolidado (PDF único)', () => {
    test('incluye el resumen de portafolio y el detalle técnico completo de cada riesgo', async ({ page }) => {
        await page.addInitScript(() => {
            window.print = () => {
                window.__printCalled = (window.__printCalled || 0) + 1;
            };
        });
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Incendio en Almacén Central');

        // Adopta una Decisión de Tratamiento — el PDF debe mostrarla en vez de solo la
        // comparación teórica de las 4 estrategias (ver el hallazgo de la auditoría que motivó
        // esto: el reporte guardaba treatmentDecision pero nunca lo mostraba).
        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E — Incendio en Almacén Central');
        await page.waitForTimeout(500);
        await page.fill('#fair-costoControlAnual', '2000');
        await page.waitForTimeout(600);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        await page.click('#nav-dashboard');
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
        expect(reportHTML).toContain('Matriz de Riesgos');
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

        // Riesgo Inherente: se calcula automáticamente en CADA simulación de una Amenaza (ver
        // POST /api/simulate, calculateInherentRiskFromSimulation) — debe aparecer en el reporte,
        // no solo en pantalla (Registro de Riesgos).
        expect(reportHTML).toContain('Riesgo Inherente (sin ningún control');

        // Decisión de Tratamiento REAL adoptada arriba — el reporte debe decir cuál se adoptó,
        // no solo mostrar la comparación teórica de las 4 estrategias.
        expect(reportHTML).toContain('Decisión de Tratamiento adoptada');
        expect(reportHTML).toContain('Mitigar');

        // REGRESIÓN: los gráficos (mapa de calor, Pareto, histograma del riesgo) se exportaban
        // en blanco cuando se exportaba SIN haber visitado antes "Registro de Riesgos" en la
        // misma sesión — justo el flujo de este test, que solo pasa por "Análisis de Riesgo"
        // (#nav-fair), nunca por #nav-dashboard. Antes del fix, el <canvas> real de esa página
        // nunca se dibujaba y toDataURL() capturaba un PNG casi vacío de 300×150 (el tamaño
        // por defecto del navegador) — ahora los tres gráficos se redibujan fuera de pantalla a
        // tamaño fijo (ver App.FairExport.renderOffscreen*), sin depender de qué página se
        // visitó antes. Un PNG real de un gráfico pesa muchos KB en base64; uno casi vacío pesa
        // unos pocos cientos de bytes — 3000 caracteres es un umbral cómodo entre ambos.
        const images = await page.locator('#fair-print-report img').all();
        expect(images.length).toBeGreaterThanOrEqual(3); // mapa de calor + Pareto + histograma del riesgo
        for (const img of images) {
            const src = await img.getAttribute('src');
            expect(src.length).toBeGreaterThan(3000);
        }
    });
});
