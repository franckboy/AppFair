'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

test.describe('Registrar un activo nuevo directo desde el picker del wizard', () => {
    test('el botón "Elegir del Catálogo de Activos" permite dar de alta un activo sin salir del modal, y se aplica de inmediato', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');

        await page.click('#open-asset-catalog-btn-fair');
        await page.waitForSelector('#assetpick-new, #assetpick-existing');

        // Si ya hay activos de una corrida anterior de la suite (el backend se comparte entre
        // specs, ver helpers.js), el modal arranca en modo "elegir existente" y hay que abrir
        // el formulario de alta con el botón toggle. Si el catálogo está vacío, el formulario
        // ya se muestra directo — cualquiera de los dos casos es válido aquí.
        const toggleBtn = page.locator('#assetpick-toggle-new-btn');
        if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
        }
        await expect(page.locator('#assetpick-new')).toBeVisible();

        const assetName = `E2E — Activo creado desde el picker ${Date.now()}`;
        await page.fill('#assetpick-new-nombre', assetName);
        await page.fill('#assetpick-new-valor', '75000');
        await page.selectOption('#assetpick-new-categoria', 'Equipo y Maquinaria');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/assets') && r.request().method() === 'POST'),
            page.click('#assetpick-create-btn'),
        ]);
        await page.waitForTimeout(500);

        // Se aplicó de inmediato al riesgo en curso, sin necesidad de reabrir el picker.
        await expect(page.locator('#fair-asset')).toHaveValue(assetName);

        // Y el activo quedó realmente registrado en el backend (no solo aplicado en memoria).
        const assets = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/assets', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const created = assets.assets.find((a) => a.nombre === assetName);
        expect(created).toBeTruthy();
        expect(created.valorEstimado).toBe(75000);
        expect(created.categoria).toBe('Equipo y Maquinaria');
    });

    test('sin escribir un nombre, "Registrar y Usar" muestra un error y no crea nada', async ({ page }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');

        await page.click('#open-asset-catalog-btn-fair');
        await page.waitForSelector('#assetpick-new, #assetpick-existing');
        const toggleBtn = page.locator('#assetpick-toggle-new-btn');
        if (await toggleBtn.isVisible()) {
            await toggleBtn.click();
        }
        await expect(page.locator('#assetpick-new')).toBeVisible();

        await page.click('#assetpick-create-btn');
        await page.waitForTimeout(300);
        await expect(page.locator('#assetpick-new-error')).toBeVisible();
        await expect(page.locator('#assetpick-new-error')).toContainText('nombre del activo es obligatorio');
        // El modal sigue abierto — no se cerró como si hubiera funcionado.
        await expect(page.locator('#assetpick-new')).toBeVisible();
    });
});
