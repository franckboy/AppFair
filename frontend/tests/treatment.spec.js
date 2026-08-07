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

    test('cambiar de riesgo justo después de editar (antes del debounce) no pierde la edición', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Riesgo A (carrera)');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Riesgo B (carrera)');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Riesgo A (carrera)');
        await page.waitForTimeout(300);

        // Editar el costo y, ANTES de que venza el debounce (400ms), cambiar de riesgo — sin el
        // flush en selectRisk() esta edición se perdía en silencio (ver App.Treatment).
        await page.fill('#fair-costoControlAnual', '7500');
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Riesgo B (carrera)');
        await page.waitForTimeout(500);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entryA = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Riesgo A (carrera)');
        expect(entryA.mitigar.cost).toBe(7500);
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

    test('"Gestionar Controles" agrega controles nombrados, deriva Costo/Fiabilidad/Retraso, persiste y revierte a manual al vaciarse', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Controles');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Controles');
        await page.waitForTimeout(500);

        // Sin controles: los 3 campos siguen editables a mano (comportamiento manual de siempre).
        await expect(page.locator('#fair-costoControlAnual')).not.toHaveAttribute('readonly', '');
        await expect(page.locator('#treatment-controls-note')).toBeHidden();

        await page.click('#treatment-manage-controls-btn');
        await page.waitForSelector('#treatment-controls-add-btn');

        await page.click('#treatment-controls-add-btn');
        await page.fill('[data-control-row][data-index="0"] [data-field="name"]', 'Cámaras CCTV');
        await page.fill('[data-control-row][data-index="0"] [data-field="cost"]', '5000');
        await page.selectOption('[data-control-row][data-index="0"] [data-field="reliability"]', 'alta');
        await page.fill('[data-control-row][data-index="0"] [data-field="delayDays"]', '10');

        // Agregar una SEGUNDA fila no debe perder lo ya escrito en la primera.
        await page.click('#treatment-controls-add-btn');
        await page.fill('[data-control-row][data-index="1"] [data-field="name"]', 'Rondines Nocturnos');
        await page.fill('[data-control-row][data-index="1"] [data-field="cost"]', '8000');
        await page.selectOption('[data-control-row][data-index="1"] [data-field="reliability"]', 'baja');
        await page.fill('[data-control-row][data-index="1"] [data-field="delayDays"]', '30');

        await page.click('#treatment-controls-save-btn');
        await page.waitForTimeout(1000);

        // Costo = suma (5000+8000), Fiabilidad = la más débil ("baja"), Retraso = el más largo (30).
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('13000');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toHaveValue('baja');
        await expect(page.locator('#fair-mitigar-retraso')).toHaveValue('30');
        await expect(page.locator('#fair-costoControlAnual')).toHaveAttribute('readonly', '');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toBeDisabled();
        await expect(page.locator('#treatment-controls-note')).toContainText('2 controles nombrados');

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Controles');
        expect(entry.mitigar.controls).toEqual([
            { name: 'Cámaras CCTV', cost: 5000, reliability: 'alta', delayDays: 10 },
            { name: 'Rondines Nocturnos', cost: 8000, reliability: 'baja', delayDays: 30 },
        ]);
        expect(entry.mitigar.cost).toBe(13000);
        expect(entry.mitigar.reliability).toBe('baja');
        expect(entry.mitigar.delayDays).toBe(30);

        // Recargar y volver a este riesgo debe restaurar el estado derivado (no un formulario en
        // blanco ni los controles perdidos).
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Controles');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('13000');
        await expect(page.locator('#fair-costoControlAnual')).toHaveAttribute('readonly', '');

        // Quitar ambos controles debe devolver los 3 campos a editables a mano.
        await page.click('#treatment-manage-controls-btn');
        await page.waitForSelector('[data-control-row][data-index="1"] [data-remove-control]');
        await page.click('[data-control-row][data-index="1"] [data-remove-control]');
        await page.click('[data-control-row][data-index="0"] [data-remove-control]');
        await page.click('#treatment-controls-save-btn');
        await page.waitForTimeout(1000);

        await expect(page.locator('#fair-costoControlAnual')).not.toHaveAttribute('readonly', '');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toBeEnabled();
        await expect(page.locator('#treatment-controls-note')).toBeHidden();

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Controles');
        expect(entry.mitigar.controls).toEqual([]);
    });
});
