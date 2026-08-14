'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

// Regresiones de maquetado reportadas sobre la app en uso real. No prueban lógica de riesgo:
// prueban que la interfaz siga siendo usable sin bajar el zoom del navegador.
test.describe('Maquetado: modales y acciones del Registro', () => {
    test('un modal largo deja sus botones dentro de la pantalla (el cuerpo es lo que hace scroll)', async ({
        page,
    }) => {
        // Ventana chica a propósito: es donde Criterios de Riesgo empujaba "Guardar" fuera de la
        // pantalla y había que reducir el zoom del navegador para poder llegar al botón.
        await page.setViewportSize({ width: 1280, height: 700 });
        await connectAndBoot(page);

        await page.click('#nav-config');
        await page.waitForTimeout(400);
        await page.click('[data-menu-option="1"]'); // Criterios de Riesgo
        await page.waitForTimeout(500);

        const geom = await page.evaluate(() => {
            const box = document.querySelector('#customModal .modal-box');
            const footer = document.getElementById('modalFooter');
            const body = document.getElementById('modalBody');
            return {
                footerTop: footer.getBoundingClientRect().top,
                footerBottom: footer.getBoundingClientRect().bottom,
                boxWidth: Math.round(box.getBoundingClientRect().width),
                viewportH: window.innerHeight,
                bodyScrolls: body.scrollHeight > body.clientHeight,
                isWide: box.classList.contains('modal-box-wide'),
            };
        });
        expect(geom.footerBottom).toBeLessThanOrEqual(geom.viewportH);
        expect(geom.footerTop).toBeGreaterThan(0);
        expect(geom.bodyScrolls).toBe(true); // el scroll vive en el cuerpo, no en la página
        expect(geom.isWide).toBe(true);
        // El botón "Guardar Criterios" tiene que ser clicable sin más gimnasia.
        await expect(page.locator('#criteria-save-btn')).toBeVisible();

        await page.click('#criteria-cancel-btn');
        await page.waitForTimeout(300);

        // El modal siguiente NO hereda el ancho del anterior — hide() lo devuelve al default.
        await page.click('#nav-config');
        await page.waitForTimeout(400);
        const stillWide = await page.evaluate(() =>
            document.querySelector('#customModal .modal-box').classList.contains('modal-box-wide'),
        );
        expect(stillWide).toBe(false);
    });

    test('"Gestionar Controles" es lo bastante ancho para leer y escribir en sus columnas', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await connectAndBoot(page);
        await page.click('#nav-fair');
        await page.waitForTimeout(400);
        await runFullFairAnalysis(page, 'Riesgo Maquetado Controles');

        await page.click('#nav-treatment');
        await page.waitForTimeout(800);
        await page.click('#treatment-manage-controls-btn');
        await page.waitForTimeout(400);
        await page.click('#treatment-controls-add-btn');
        await page.waitForTimeout(300);

        const geom = await page.evaluate(() => {
            const box = document.querySelector('#customModal .modal-box');
            const nameInput = document.querySelector('[data-control-row] [data-field="name"]');
            return {
                isWide: box.classList.contains('modal-box-wide'),
                nameInputWidth: Math.round(nameInput.getBoundingClientRect().width),
            };
        });
        expect(geom.isWide).toBe(true);
        // Con el ancho por defecto (max-w-md) este campo quedaba por debajo de 100px.
        expect(geom.nameInputWidth).toBeGreaterThan(150);
    });

    test('las acciones de Riesgos Guardados van en UNA fila, y "Simular" responde al clic', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await connectAndBoot(page);
        // El wizard para crear el riesgo; el Dashboard para ver la tabla — la tabla "Riesgos
        // Guardados" vive ahí desde que se separó la captura de los resultados.
        await page.click('#nav-fair');
        await page.waitForTimeout(400);
        await runFullFairAnalysis(page, 'Riesgo Maquetado Acciones');
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1200);

        const cell = page.locator('#quick-concentrated-table-body tr td:last-child').first();
        await expect(cell).toBeVisible();
        await cell.scrollIntoViewIfNeeded();

        // Se comparan los CENTROS verticales, no los bordes superiores: el icono de basura es más
        // bajo que los botones con texto, así que sus `top` difieren aunque estén bien alineados.
        // Medido sobre la página VISIBLE a propósito — en una página oculta todos los rects son 0
        // y "una sola fila" saldría cierto sin serlo.
        const geom = await cell.evaluate((el) => {
            const btns = [...el.querySelectorAll('button')];
            const centers = btns.map((b) => {
                const r = b.getBoundingClientRect();
                return Math.round(r.top + r.height / 2);
            });
            return {
                count: btns.length,
                spread: Math.max(...centers) - Math.min(...centers),
                labeledHeights: btns
                    .filter((b) => b.textContent.trim())
                    .map((b) => Math.round(b.getBoundingClientRect().height)),
            };
        });
        expect(geom.count).toBeGreaterThanOrEqual(3); // Analizar + Simular + Tratar + eliminar
        expect(geom.labeledHeights.every((h) => h > 10)).toBe(true); // de verdad renderizados
        expect(geom.spread).toBeLessThanOrEqual(2); // una sola fila: antes iban apilados

        // No se afirma nada sobre el ancho total de la tabla: depende de cuántos riesgos haya y de qué tan
        // largos sean sus nombres (con el Registro lleno la columna "Riesgo" crece y la tabla
        // desborda a propósito — para eso su contenedor tiene overflow-x-auto). Lo que sí es
        // invariante es que la columna Acciones alcance para sus botones en una línea, que es
        // justo lo que mide `spread` arriba.

        // "Simular" nunca se deshabilita: si al riesgo le faltan insumos, el clic llega igual y
        // simulateRegisteredRisk() lo explica en un aviso (un botón deshabilitado no responde al
        // clic Y su `title` casi nunca se muestra — se veía idéntico a un botón roto).
        const simBtn = cell.locator('[data-simulate-risk]');
        await expect(simBtn).toBeEnabled();
        await simBtn.click();
        await page.waitForTimeout(3000);
        await expect(page.locator('#dashboard-risk-detail')).toBeVisible();
    });

    test('el detalle de un riesgo se abre en un modal, no cuelga del Dashboard', async ({ page }) => {
        await page.setViewportSize({ width: 1400, height: 900 });
        await connectAndBoot(page);
        await page.click('#nav-fair');
        await page.waitForTimeout(400);
        await runFullFairAnalysis(page, 'Riesgo Maquetado Modal');

        // El Dashboard es la vista del PORTAFOLIO: un análisis individual permanente ahí abajo
        // mezcla dos niveles de lectura. El detalle vive en un modal que se abre a demanda.
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1200);
        await expect(page.locator('#dashboard-risk-detail')).toBeHidden();

        // Clic en la FILA (no en un botón) abre el detalle.
        const fila = page.locator('#quick-concentrated-table-body tr[data-risk-row]').first();
        await fila.scrollIntoViewIfNeeded();
        await fila.locator('.risk-name-cell').click();
        // Se espera la CONDICIÓN, no un rato fijo: la simulación tarda lo que tarde el backend, y
        // con un registro grande un sleep se queda corto y el canvas todavía mide cero.
        await expect(page.locator('#dashboard-risk-detail-body')).toBeVisible({ timeout: 20000 });

        const geom = await page.evaluate(() => ({
            dentroDelModal: !!document.querySelector('#modalBody #dashboard-risk-detail'),
            xl: document.querySelector('#customModal .modal-box').classList.contains('modal-box-xl'),
            histograma: document.getElementById('fair-results-chart').getBoundingClientRect().height > 0,
        }));
        expect(geom.dentroDelModal).toBe(true);
        expect(geom.xl).toBe(true);
        expect(geom.histograma).toBe(true);
        // Con el modal a 90vh, el botón de cerrar tiene que quedar alcanzable sin tocar el zoom.
        await expect(page.locator('#risk-detail-close-btn')).toBeVisible();

        // Al cerrar, el panel vuelve a su casa: si se quedara dentro del modal, la próxima
        // apertura no lo encontraría y los gráficos se perderían al vaciar el cuerpo.
        await page.click('#risk-detail-close-btn');
        await page.waitForTimeout(400);
        const trasCerrar = await page.evaluate(() => ({
            enSuCasa: !!document.querySelector('#dashboard-risk-detail-home #dashboard-risk-detail'),
            xlLimpio: !document.querySelector('#customModal .modal-box').classList.contains('modal-box-xl'),
        }));
        expect(trasCerrar.enSuCasa).toBe(true);
        expect(trasCerrar.xlLimpio).toBe(true);
        await expect(page.locator('#dashboard-risk-detail')).toBeHidden();
    });
});
