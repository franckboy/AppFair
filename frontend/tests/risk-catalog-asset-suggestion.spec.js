'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

test.describe('Sugerencia de tipo de activo al elegir un riesgo del catálogo', () => {
    test('elegir "Sismo / Terremoto" (Natural > Geológico) sugiere Instalaciones y Sitio / Personas, en Paso 1', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');

        // Sin elegir nada del catálogo todavía, no debe verse ninguna sugerencia.
        await expect(page.locator('#fair-asset-suggestion')).toBeHidden();

        await page.click('#open-risk-catalog-btn-fair');
        await page.waitForSelector('#riskcat-domain');
        await page.selectOption('#riskcat-domain', 'natural');
        await page.selectOption('#riskcat-category', 'geologico');
        await page.selectOption('#riskcat-threat', 'sismo');
        await page.click('#riskcat-use-btn');
        await page.waitForTimeout(300);

        await expect(page.locator('#fair-riskName')).toHaveValue('Sismo / Terremoto');
        const suggestion = page.locator('#fair-asset-suggestion');
        await expect(suggestion).toBeVisible();
        await expect(suggestion).toContainText('Instalaciones y Sitio');
        await expect(suggestion).toContainText('Personas');

        // Categorías sin una sugerencia razonable (arreglo vacío a propósito, ver
        // profiles.js) no deben mostrar nada — Legal > Cumplimiento Regulatorio es una de ellas.
        // "Usar este riesgo" cierra el modal (ver arriba) — hay que reabrirlo.
        await page.click('#open-risk-catalog-btn-fair');
        await page.waitForSelector('#riskcat-domain');
        await page.selectOption('#riskcat-domain', 'legal');
        await page.selectOption('#riskcat-category', 'cumplimiento-regulatorio');
        await page.waitForTimeout(200);
        await page.click('#riskcat-use-btn');
        await page.waitForTimeout(300);
        await expect(page.locator('#fair-asset-suggestion')).toBeHidden();
    });
});
