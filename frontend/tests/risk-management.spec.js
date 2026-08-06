'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Gestión de Riesgos (página aparte)', () => {
    test('"Gestionar este riesgo" en el wizard lleva a Gestión de Riesgos, y los cambios se guardan en el Registro', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Robo en Bodega');

        // El wizard ya no tiene su propio bloque de Gobernanza/Plan de Seguridad — solo un CTA
        // hacia la página nueva. #fair-owner vive ahora en #riskMgmtPage, no dentro de #fair-step-4.
        await expect(page.locator('#fair-riskmgmt-cta')).toBeVisible();
        await expect(page.locator('#fair-step-4 #fair-owner')).toHaveCount(0);

        await page.click('#fair-manage-this-risk-btn');
        await page.waitForTimeout(500);

        await expect(page.locator('#riskMgmtPage')).toBeVisible();
        await expect(page.locator('#riskmgmt-risk-select')).toHaveValue('E2E Gestión — Robo en Bodega');

        // Editar "Dueño del Riesgo" — se guarda solo (debounced), sin botón "Guardar".
        await page.fill('#fair-owner', 'Gerente de Seguridad Patrimonial');
        await page.waitForTimeout(1000);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Gestión — Robo en Bodega');
        expect(entry.owner).toBe('Gerente de Seguridad Patrimonial');

        // Recargar la página de Gestión de Riesgos con otro riesgo y volver debe restaurar el
        // valor ya guardado (no un formulario en blanco) — confirma que el guardado es real.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(1000);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Robo en Bodega');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-owner')).toHaveValue('Gerente de Seguridad Patrimonial');
    });

    test('un riesgo tipo Oportunidad sí aparece en el selector de Gestión de Riesgos (a diferencia de Tratamiento)', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E Gestión — Oportunidad de Mercado');
        await page.selectOption('#fair-risk-type', 'oportunidad');
        await runFullFairAnalysis(page, 'E2E Gestión — Oportunidad de Mercado');

        // El CTA de Gestión de Riesgos sí aparece para una Oportunidad (a diferencia del de
        // Tratamiento, que se oculta).
        await expect(page.locator('#fair-riskmgmt-cta')).toBeVisible();
        await expect(page.locator('#fair-treatment-cta')).toBeHidden();

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        const options = await page.locator('#riskmgmt-risk-select option').allTextContents();
        expect(options).toContain('E2E Gestión — Oportunidad de Mercado');
    });
});
