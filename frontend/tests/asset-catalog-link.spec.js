'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

test.describe('Catálogo de Activos vinculado a riesgos', () => {
    test('un activo elegido en el wizard queda vinculado (assetId) al riesgo guardado, visible desde el Catálogo de Activos', async ({
        page,
    }) => {
        await connectAndBoot(page);

        // 1) Crear un activo con la categoría RIMS RA.1-2015 / ASIS PAP.1
        await page.click('#nav-config');
        // Por etiqueta y no por índice: agregar una entrada al menú de Configuración corría
        // el índice de esta y rompía el test sin que el Catálogo de Activos hubiera cambiado.
        await page.click('#modalBody button:has-text("Catálogo de Activos")');
        await page.waitForSelector('#asset-nombre');
        await page.fill('#asset-nombre', 'E2E — Bodega de Mercancía');
        await page.fill('#asset-valor', '250000');
        await page.selectOption('#asset-categoria', 'Instalaciones y Sitio');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'POST'),
            page.click('#asset-form button[type="submit"]'),
        ]);
        await page.waitForTimeout(500);

        const assetRow = page.locator('#assets-table-body tr', { hasText: 'E2E — Bodega de Mercancía' });
        await expect(assetRow).toBeVisible();
        await expect(assetRow.locator('td').nth(2)).toHaveText('Instalaciones y Sitio');
        await expect(assetRow).toContainText('Ninguno'); // sin riesgos vinculados todavía

        // 2) Ir al wizard, elegir el activo desde el Catálogo (no escribirlo a mano), y correr
        // el análisis completo (Pasos 1→4).
        await page.click('#nav-fair');
        await page.waitForTimeout(300);
        await page.fill('#fair-riskName', 'E2E — Robo de mercancía en la bodega');
        await page.click('#open-asset-catalog-btn-fair');
        await page.waitForSelector('#assetpick-select');
        await page.click('#assetpick-use-btn');
        await expect(page.locator('#fair-asset')).toHaveValue('E2E — Bodega de Mercancía');

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

        // 3) El riesgo guardado en el backend debe traer el assetId real, no solo el nombre
        // copiado en "asset".
        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const savedEntry = register.risks.find((r) => r.riskName === 'E2E — Robo de mercancía en la bodega');
        expect(savedEntry).toBeTruthy();
        expect(savedEntry.asset).toBe('E2E — Bodega de Mercancía');
        expect(savedEntry.assetId).toBeTruthy();

        // 4) Desde el Catálogo de Activos, el activo ahora debe mostrar 1 riesgo vinculado, y
        // al hacer clic debe listar el nombre correcto.
        await page.click('#nav-config');
        await page.click('#modalBody button:has-text("Catálogo de Activos")');
        await page.waitForSelector('#assets-table-body tr');
        await page.waitForTimeout(500);

        const assetRowAfter = page.locator('#assets-table-body tr', { hasText: 'E2E — Bodega de Mercancía' });
        await expect(assetRowAfter).toContainText('1 riesgo');

        await assetRowAfter.locator('[data-linked-id]').click();
        await page.waitForTimeout(300);
        await expect(page.locator('#modalBody')).toContainText('E2E — Robo de mercancía en la bodega');
    });

    test('advierte (sin bloquear) cuando el Costo de Reemplazo máximo supera el valor declarado del activo', async ({
        page,
    }) => {
        await connectAndBoot(page);

        // 1) Crear un activo con un valor deliberadamente bajo.
        await page.click('#nav-config');
        await page.click('#modalBody button:has-text("Catálogo de Activos")');
        await page.waitForSelector('#asset-nombre');
        await page.fill('#asset-nombre', 'E2E — Caja Fuerte');
        await page.fill('#asset-valor', '50000');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'POST'),
            page.click('#asset-form button[type="submit"]'),
        ]);
        await page.waitForTimeout(500);

        // 2) En el wizard, elegir el activo y luego, en modo manual, capturar un Costo de
        // Reemplazo máximo que supere su valor declarado.
        await page.click('#nav-fair');
        await page.waitForTimeout(300);
        await page.fill('#fair-riskName', 'E2E — Robo con daño colateral');
        await page.click('#open-asset-catalog-btn-fair');
        await page.waitForSelector('#assetpick-select');
        // Otros tests de este archivo ya crearon activos antes que este — el picker puede traer
        // más de una opción, así que se elige explícitamente "E2E — Caja Fuerte" en vez de
        // asumir que es la única/la que queda seleccionada por defecto.
        const targetValue = await page
            .locator('#assetpick-select option', { hasText: 'E2E — Caja Fuerte' })
            .getAttribute('value');
        await page.selectOption('#assetpick-select', targetValue);
        await page.click('#assetpick-use-btn');
        await expect(page.locator('#fair-asset')).toHaveValue('E2E — Caja Fuerte');

        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);

        await page.check('#lm-manual-override');
        await page.waitForTimeout(200);
        await page.fill('#lm-reemplazo-min', '10000');
        await page.dispatchEvent('#lm-reemplazo-min', 'change');
        await page.fill('#lm-reemplazo-max', '500000');
        await page.dispatchEvent('#lm-reemplazo-max', 'change');
        await page.waitForTimeout(200);

        const warning = page.locator('#lm-asset-warning');
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('supera el valor declarado');

        // Bajar el máximo a un valor por debajo del activo debe ocultar la advertencia (nunca
        // bloquea el avance del wizard).
        await page.fill('#lm-reemplazo-max', '20000');
        await page.dispatchEvent('#lm-reemplazo-max', 'change');
        await page.waitForTimeout(200);
        await expect(warning).toBeHidden();

        // Subirlo de nuevo para que la entrada guardada quede con el Costo de Reemplazo por
        // encima del valor del activo, y así verificar la vista enriquecida del Catálogo.
        await page.fill('#lm-reemplazo-max', '500000');
        await page.dispatchEvent('#lm-reemplazo-max', 'change');
        await page.waitForTimeout(200);
        await expect(warning).toBeVisible();

        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        // 3) Desde el Catálogo de Activos, el riesgo vinculado debe listarse con su Costo de
        // Reemplazo resaltado por superar el valor declarado del activo.
        await page.click('#nav-config');
        await page.click('#modalBody button:has-text("Catálogo de Activos")');
        await page.waitForSelector('#assets-table-body tr');
        await page.waitForTimeout(500);

        const assetRow = page.locator('#assets-table-body tr', { hasText: 'E2E — Caja Fuerte' });
        await expect(assetRow).toContainText('1 riesgo');
        await assetRow.locator('[data-linked-id]').click();
        await page.waitForTimeout(300);
        const modalBody = page.locator('#modalBody');
        await expect(modalBody).toContainText('E2E — Robo con daño colateral');
        await expect(modalBody).toContainText('supera el valor del activo');
    });
});
