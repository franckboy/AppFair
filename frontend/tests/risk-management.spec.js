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

    test('cambiar de riesgo justo después de editar (antes del debounce) no pierde la edición', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Riesgo A (carrera)');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Riesgo B (carrera)');

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Riesgo A (carrera)');
        await page.waitForTimeout(300);

        // Editar el dueño y, ANTES de que venza el debounce (500ms), cambiar de riesgo — sin el
        // flush en selectRisk() esta edición se perdía en silencio (ver App.RiskManagement).
        await page.fill('#fair-owner', 'Gerente de Riesgo A');
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Riesgo B (carrera)');
        await page.waitForTimeout(500);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entryA = register.risks.find((r) => r.riskName === 'E2E Gestión — Riesgo A (carrera)');
        expect(entryA.owner).toBe('Gerente de Riesgo A');
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

        // Una Oportunidad no tiene Tratamiento (su "ale" es un beneficio, no una pérdida) — la
        // sección de Riesgo Residual (paso 2 del rediseño de Tratamiento) no debe aparecer.
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Oportunidad de Mercado');
        await page.waitForTimeout(300);
        await expect(page.locator('#riskmgmt-residual-section')).toBeHidden();
    });

    test('la sección de Riesgo Residual pasa del inherente al residual reclasificado al adoptar una estrategia en Tratamiento', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Residual');

        // riskCriteriaOverride PROPIO del riesgo (no el global, que es estado compartido entre
        // specs sin aislamiento) — hace la reclasificación determinista sin importar qué haya
        // guardado otro test: aleAceptable = 1000*0.2 = 200.
        await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const entry = data.risks.find((r) => r.riskName === 'E2E Gestión — Residual');
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({
                    ...entry,
                    ale: 2000,
                    cvar95: 2000,
                    riskCriteriaOverride: { aleAceptablePercent: 20, aleCritico: 1000 },
                }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Residual');
        await page.waitForTimeout(500);

        // Sin decisión: el residual mostrado es igual al inherente, con botón para ir a decidir.
        await expect(page.locator('#riskmgmt-residual-section')).toBeVisible();
        await expect(page.locator('#riskmgmt-residual-note')).toContainText('igual al inherente');
        await expect(page.locator('#riskmgmt-residual-ale')).toHaveText('$2,000.00');
        await expect(page.locator('#riskmgmt-goto-treatment-btn')).toBeVisible();

        await page.click('#riskmgmt-goto-treatment-btn');
        await page.waitForTimeout(500);
        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Gestión — Residual');

        // ale=2000 > aleCritico(1000) del override → inherente Crítico. Mitigar al 95% deja
        // residual = 100, bien por debajo de aleAceptable(200) → debe reclasificar a Aceptable.
        await page.check('#fair-reduccionALE-manual-override');
        await page.fill('#fair-reduccionALE', '95');
        await page.waitForTimeout(1000);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Residual');
        await page.waitForTimeout(1500);

        await expect(page.locator('#riskmgmt-residual-note')).toContainText('Con tratamiento (Mitigar)');
        await expect(page.locator('#riskmgmt-residual-ale')).toHaveText('$100.00');
        await expect(page.locator('#riskmgmt-residual-cvar')).toHaveText('$100.00');
        await expect(page.locator('#riskmgmt-residual-badge')).toHaveText('Aceptable');
        await expect(page.locator('#riskmgmt-goto-treatment-btn')).toBeHidden();

        // La fecha de revisión sugerida se actualiza a la cadencia de "Aceptable" (12 meses) —
        // este riesgo nunca tuvo un reviewDate guardado, así que no hay regresión posible.
        const reviewDate = new Date(await page.locator('#fair-review-date').inputValue());
        const now = new Date();
        const monthsAhead =
            (reviewDate.getFullYear() - now.getFullYear()) * 12 + (reviewDate.getMonth() - now.getMonth());
        expect(monthsAhead).toBeGreaterThanOrEqual(11);
        expect(monthsAhead).toBeLessThanOrEqual(12);
    });
});
