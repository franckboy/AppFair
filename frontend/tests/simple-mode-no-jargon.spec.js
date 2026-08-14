'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

// Red de jerga: en Modo Simple, ninguna pantalla debe mostrar nombres de método/distribución,
// acrónimos técnicos, ni fórmulas — codifica directamente el requisito del usuario ("modo fácil
// sea entendible, no necesito palabras raras o técnicas ni que muestre métodos o fórmulas") y
// hubiera detectado, de una sola pasada, todos los huecos que encontró la auditoría manual
// (CVaR95/ALE/Pareto/P90 sin traducir fuera del wizard FAIR, la fórmula cruda de Vulnerabilidad,
// los acrónimos FA/ENC, y la justificación técnica del backend insertada tal cual en los
// banners de evaluación).
const JARGON_PATTERN =
    /\bCVaR\b|\bALE\b|\bP90\b|\bTEF\b|\bLEF\b|\bLEC\b|Beta-PERT|Monte Carlo|\bFA\b|\bENC\b|Pareto|correlaci[oó]n|Excedencia/i;

// Toda la suite E2E comparte un único backend durante la corrida completa (ver
// playwright.config.js) — para cuando este spec corre, el Registro ya acumuló riesgos de OTROS
// archivos de test, algunos con nombres que a propósito incluyen palabras de la lista de arriba
// (ej. "E2E Pareto Residual — ..." en risk-management.spec.js). Esos nombres son datos del
// usuario, no texto generado por la app — no cuentan como jerga. Por eso cada verificación se
// acota al contenedor real de la pantalla en cuestión (nunca todo <body>) y, dentro de ese
// contenedor, se ocultan temporalmente (solo dentro del propio innerText, sin efecto visible)
// las tablas/leyendas que listan nombres de riesgo ajenos, antes de leer el texto.
async function assertNoJargon(page, pageLabel, { containerSelector = 'body', excludeSelectors = [] } = {}) {
    const text = await page.evaluate(
        ({ containerSelector, excludeSelectors }) => {
            const container = document.querySelector(containerSelector);
            if (!container) return '';
            const restore = [];
            excludeSelectors.forEach((sel) => {
                container.querySelectorAll(sel).forEach((el) => {
                    restore.push([el, el.style.display]);
                    el.style.display = 'none';
                });
            });
            const captured = container.innerText;
            restore.forEach(([el, prevDisplay]) => {
                el.style.display = prevDisplay;
            });
            // Bug real corregido: innerText NUNCA incluye el contenido de atributos title=
            // (tooltips de los íconos ⓘ) — un tooltip con jerga cruda podía quedar invisible a
            // esta prueba aunque la página que lo contiene sí esté en el alcance de arriba. Se
            // concatenan los title= de TODOS los elementos del contenedor (visibles o no, para no
            // depender de las mismas exclusiones de arriba) al texto ya capturado.
            const titles = Array.from(container.querySelectorAll('[title]'))
                .map((el) => el.getAttribute('title'))
                .join(' ');
            return `${captured} ${titles}`;
        },
        { containerSelector, excludeSelectors },
    );
    const match = text.match(JARGON_PATTERN);
    expect(match, `Modo Simple todavía muestra jerga técnica en ${pageLabel}: "${match ? match[0] : ''}"`).toBeNull();
}

test.describe('Modo Simple: sin jerga técnica en ninguna página', () => {
    test('Wizard FAIR, Tratamiento, Gestión de Riesgos, Registro y Árbol de Cascada no muestran acrónimos/fórmulas en Modo Simple', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');

        // Modo Simple es el default de fábrica (App.UIMode.mode = 'simple', sin nada guardado
        // aún en localStorage) — se confirma explícitamente en vez de asumirlo, y si por lo que
        // sea ya estuviera en Técnico, se cambia. Se espera a que el botón ya tenga texto (se
        // llena de forma async al terminar App.init(), puede no estar listo justo al volver
        // connectAndBoot) en vez de leerlo una sola vez sin reintentos.
        await expect(page.locator('#mode-toggle-btn')).not.toHaveText('');
        const toggleText = await page.locator('#mode-toggle-btn').textContent();
        if (!toggleText.includes('Modo Simple')) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }

        const riskName = 'E2E Jerga — Robo en Bodega';
        await runFullFairAnalysis(page, riskName);
        await assertNoJargon(page, 'Wizard FAIR (Paso 4, resultados)', { containerSelector: '#fair-step-4' });

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', riskName);
        await page.waitForTimeout(800);
        await assertNoJargon(page, 'Tratamiento', { containerSelector: '#fair-roi-content' });

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', riskName);
        await page.waitForTimeout(800);
        await assertNoJargon(page, 'Gestión de Riesgos', {
            containerSelector: '#riskmgmt-content',
            // #riskmgmt-risk-select vive DENTRO de #riskmgmt-content (a diferencia de
            // #treatment-risk-select, que en Tratamiento queda fuera de #fair-roi-content) — sus
            // <option> son nombres de riesgo de OTROS archivos de test (ej. "E2E Pareto
            // Residual — ..." en risk-management.spec.js), no jerga generada por la app.
            excludeSelectors: ['#riskmgmt-residual-pareto-tbody', '#riskmgmt-risk-select'],
        });

        await page.click('#nav-dashboard');
        await page.waitForTimeout(500);
        await assertNoJargon(page, 'Registro de Riesgos (Matriz/Pareto/Sensibilidad consolidados)', {
            containerSelector: '#fair-register-content',
            // #fair-register-legend (Matriz) y #fair-pareto-legend (Pareto) son DOS leyendas
            // separadas, cada una con la lista de nombres de TODOS los riesgos guardados;
            // #fair-register-interpretation (síntesis del portafolio) también menciona nombres
            // de riesgo específicos dentro de su propio texto (los que concentran el 80%).
            excludeSelectors: ['#fair-register-legend', '#fair-pareto-legend', '#fair-register-interpretation'],
        });

        await page.click('#nav-risk-tree');
        await page.waitForTimeout(500);
        await page.locator('.risk-tree-card', { hasText: riskName }).click();
        await page.waitForSelector('#risktree-detail-simulate-family-btn');
        await assertNoJargon(page, 'Árbol de Cascada (detalle de nodo)', { containerSelector: '#modalBody' });

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/simulate-family'), { timeout: 15000 }),
            page.click('#risktree-detail-simulate-family-btn'),
        ]);
        await expect(page.locator('#risk-tree-family-sim-body')).toBeVisible({ timeout: 15000 });
        await assertNoJargon(page, 'Árbol de Cascada (panel Simular Familia)', {
            containerSelector: '#risk-tree-family-simulation',
            excludeSelectors: ['#risk-tree-family-sim-members'], // lista riesgos incluidos/excluidos por nombre
        });

        // Riesgos Guardados (#historySection, en Análisis de Riesgo) — hueco real de cobertura
        // encontrado en una auditoría: vive FUERA de #fair-step-4 (el wizard), así que las
        // verificaciones de arriba nunca lo tocaban. La columna CVaR95 ya se traduce por
        // STATIC_LABELS (quick-concentrated-th-cvar), pero nada lo confirmaba automáticamente.
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        await assertNoJargon(page, 'Riesgos Guardados', {
            containerSelector: '#historySection',
            // .risk-name-cell son nombres de riesgo de OTROS archivos de test (ej. "E2E Pareto
            // Residual — ...", "E2E Tratamiento — CVaR Residual"), no jerga generada por la app.
            excludeSelectors: ['.risk-name-cell'],
        });
    });

    test('Modo Técnico sigue mostrando el lenguaje técnico de siempre (no se perdió nada al agregar Modo Simple)', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');

        await expect(page.locator('#mode-toggle-btn')).not.toHaveText('');
        const toggleText = await page.locator('#mode-toggle-btn').textContent();
        if (toggleText.includes('Modo Simple')) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }
        await expect(page.locator('#mode-toggle-btn')).toContainText('Modo Técnico');

        const riskName = 'E2E Jerga Técnico — Robo en Bodega';
        await runFullFairAnalysis(page, riskName);
        await expect(page.locator('#cvar-label')).toContainText('CVaR 95%');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', riskName);
        await page.waitForTimeout(800);
        await expect(page.locator('#fair-roi-cvar-label')).toContainText('CVaR95');

        await page.click('#nav-dashboard');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-register-pareto-title')).toContainText('Pareto');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        await expect(page.locator('#quick-concentrated-th-cvar')).toContainText('CVaR 95%');
    });
});
