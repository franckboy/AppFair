'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

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

        // Se espera a la CONDICIÓN, no a un reloj. Antes había un `waitForTimeout(3000)` fijo para
        // un trabajo que crece con el Registro: el informe recalcula Tratamiento riesgo por riesgo
        // y regenera un histograma por cada uno, y la suite comparte un backend donde los riesgos
        // se acumulan corrida tras corrida. O sea que el margen se achicaba solo cada vez que
        // alguien agregaba un test que sembrara un riesgo — hasta que un día no alcanzaba, y el
        // que fallaba no era el test culpable sino este. `window.print()` se llama en la línea
        // siguiente a escribir el HTML del informe (ver fair-export.js), así que este contador es
        // señal fiable de que el informe ya está completo.
        await expect.poll(() => page.evaluate(() => window.__printCalled || 0), { timeout: 30000 }).toBeGreaterThan(0);

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

    test('un riesgo "Sin analizar" no rompe el informe: sale listado, no hace desaparecer todo', async ({ page }) => {
        // Bug real. El botón "+" del Árbol de Cascada crea Amenazas sin `evaluationLevel` ni `ale`.
        // El informe las metía igual en sus estadísticas y `r.evaluationLevel.includes(...)` tiraba
        // sobre undefined; la excepción se comía el window.print() y el botón de exportar
        // simplemente no hacía nada — sin aviso ni pista. UN riesgo hijo creado desde el árbol
        // dejaba sin informe a todo el Registro. Lo encontró la suite, no una revisión.
        await page.addInitScript(() => {
            window.print = () => {
                window.__printCalled = (window.__printCalled || 0) + 1;
            };
        });
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E PDF — Riesgo analizado de verdad');

        await page.evaluate(
            async ({ API, KEY }) => {
                await fetch(`${API}/api/register/${encodeURIComponent('E2E PDF — Stub sin analizar')}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    // Exactamente lo que guarda el "+" del Árbol: una Amenaza y nada más.
                    body: JSON.stringify({ riskType: 'amenaza' }),
                });
            },
            { API, KEY },
        );

        await page.click('#nav-dashboard');
        await page.waitForTimeout(1000);
        await page.click('#fair-export-consolidated-btn');
        await expect.poll(() => page.evaluate(() => window.__printCalled || 0), { timeout: 30000 }).toBeGreaterThan(0);

        const reportHTML = await page.locator('#fair-print-report').innerHTML();
        // El informe existe...
        expect(reportHTML).toContain('Informe Consolidado de Riesgos');
        // ...la exposición total es un número, no NaN. Se quitan antes las imágenes embebidas: un
        // PNG en base64 contiene "NaN" por pura casualidad de la codificación, y buscarlo sobre el
        // HTML crudo daba un falso positivo que no tenía nada que ver con el informe.
        const sinImagenes = reportHTML.replace(/src="data:[^"]*"/g, 'src="…"');
        expect(sinImagenes).not.toContain('NaN');
        // ...y el riesgo sin analizar se DECLARA en vez de desaparecer en silencio.
        expect(reportHTML).toContain('Sin analizar');
    });
});
