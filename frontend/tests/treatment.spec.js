'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Tratamiento del Riesgo (página aparte)', () => {
    test('"Tratar este riesgo" en el wizard lleva a Tratamiento, y los cambios se guardan en el Registro', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Robo en Bodega');

        // El wizard ya no tiene su propio bloque de Tratamiento — solo un CTA hacia la página
        // nueva. #fair-mitigar-title vive ahora en #treatmentPage, no dentro de #fair-step-4.
        await expect(page.locator('#fair-treatment-cta')).toBeVisible();
        await expect(page.locator('#fair-step-4 #fair-mitigar-title')).toHaveCount(0);

        await page.click('#fair-treat-this-risk-btn');
        await page.waitForTimeout(500);

        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Tratamiento — Robo en Bodega');

        // Editar "Costo Anual del Control" — se guarda solo (debounced), sin botón "Guardar".
        await page.fill('#fair-costoControlAnual', '5000');
        await page.waitForTimeout(1000);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Robo en Bodega');
        expect(entry.mitigar.cost).toBe(5000);

        // Recargar la página de Tratamiento con otro riesgo y volver debe restaurar el 5000 ya
        // guardado (no un formulario en blanco) — confirma que el guardado es real, no solo local.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Robo en Bodega');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('5000');
    });

    test('un riesgo tipo Oportunidad no aparece en el selector de Tratamiento ni tiene botón "Tratar" en la tabla', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E Tratamiento — Oportunidad de Mercado');
        await page.selectOption('#fair-risk-type', 'oportunidad');
        await runFullFairAnalysis(page, 'E2E Tratamiento — Oportunidad de Mercado');

        // Una Oportunidad no aplica a Tratamiento — el CTA del wizard tampoco debe aparecer.
        await expect(page.locator('#fair-treatment-cta')).toBeHidden();

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E Tratamiento — Oportunidad de Mercado',
        });
        await expect(row.locator('[data-treat-fair]')).toHaveCount(0);

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        const options = await page.locator('#treatment-risk-select option').allTextContents();
        expect(options).not.toContain('E2E Tratamiento — Oportunidad de Mercado');
    });

    test('el botón "Tratar" de la tabla de riesgos abre Tratamiento con ese riesgo elegido', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Vía Tabla');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E Tratamiento — Vía Tabla' });
        await row.locator('[data-treat-fair]').click();
        await page.waitForTimeout(500);

        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Tratamiento — Vía Tabla');
    });
});
