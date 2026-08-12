'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Análisis FAIR completo', () => {
    test('Pasos 1→4 completos: el riesgo termina en Riesgos Guardados como Analizado (FAIR)', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Robo en Bodega Norte');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Robo en Bodega Norte' });
        await expect(row).toBeVisible();
        await expect(row).toContainText('Analizado (FAIR)');

        // Impacto y CVaR 95% deben mostrar un monto en dólares, no un placeholder vacío.
        const cells = row.locator('td');
        await expect(cells.nth(8)).toContainText('$'); // Impacto
        await expect(cells.nth(9)).toContainText('$'); // CVaR 95%
    });

    test('el asistente siempre abre en el Paso 1 al recargar — no salta directo al Paso 4', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Incendio en Almacén Este');

        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);

        await expect(page.locator('#fair-step-1')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-step-4')).toHaveClass(/hidden/);
        await expect(page.locator('#fair-resume-banner')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-riskName')).toHaveValue('');
    });

    test('vulnManualOverride se persiste en el Registro y se restaura fiel al retomar un riesgo (no siempre "manual")', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // runFullFairAnalysis nunca toca el checkbox de Vulnerabilidad — queda en modo automático.
        await runFullFairAnalysis(page, 'E2E — Vulnerabilidad Automática');

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === 'E2E — Vulnerabilidad Automática');
        expect(entry.vulnManualOverride).toBe(false);

        // Bug real corregido: antes, retomar CUALQUIER riesgo dejaba el checkbox marcado como
        // "editado a mano" sin importar si de verdad se había tocado — el autocálculo quedaba
        // roto para siempre desde el primer guardado. Ahora refleja el estado real.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        let row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Vulnerabilidad Automática' });
        await row.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(800);
        await expect(page.locator('#vuln-manual-override')).not.toBeChecked();

        // Un riesgo con Vulnerabilidad SÍ editada a mano debe persistir true y restaurarse marcado.
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Vulnerabilidad Manual');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.check('#vuln-manual-override');
        await page.fill('#vuln-mode', '55');
        await page.waitForTimeout(300);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E — Vulnerabilidad Manual');
        expect(entry.vulnManualOverride).toBe(true);

        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Vulnerabilidad Manual' });
        await row.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(800);
        await expect(page.locator('#vuln-manual-override')).toBeChecked();
    });

    test('retomar un riesgo del Registro restaura Amenaza, Efecto, Horizonte, Fuente/Confianza/Notas de Datos y Perfil de Atacante/Defensa (regresión)', async ({
        page,
    }) => {
        // Bug real corregido: loadRegisteredRiskIntoForm() llama a resetForm(false), que pone
        // estos 8 campos en blanco/default — y antes NUNCA se volvían a leer de la entrada real
        // del Registro. Si el usuario re-simulaba y guardaba (el flujo que el propio toast de la
        // app recomienda), esos valores por defecto pisaban en silencio lo que el análisis
        // original había documentado. Modo Técnico para que los campos "advanced-only"
        // (Fuente de Datos, Notas) sean interactuables — el bug afecta a ambos modos por igual.
        await connectAndBoot(page);
        await expect(page.locator('#mode-toggle-btn')).not.toHaveText('');
        const toggleText = await page.locator('#mode-toggle-btn').textContent();
        if (toggleText.includes('Modo Simple')) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }

        const riskName = 'E2E — Retomar Preserva Campos';
        await page.fill('#fair-riskName', riskName);
        await page.fill('#fair-threat', 'Grupo criminal organizado E2E');
        await page.selectOption('#fair-effect', 'reputacional');
        await page.selectOption('#fair-time-horizon', '3');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await page.selectOption('#fair-data-source', 'benchmark');
        await page.selectOption('#fair-data-confidence', 'alto');
        await page.fill('#fair-data-notes', 'Notas E2E de prueba — no debería perderse al retomar.');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === riskName);
        expect(entry.threat).toBe('Grupo criminal organizado E2E');
        expect(entry.effect).toBe('reputacional');
        expect(entry.timeHorizon).toBe('3');
        expect(entry.dataSource).toBe('benchmark');
        expect(entry.dataConfidence).toBe('alto');
        expect(entry.dataNotes).toBe('Notas E2E de prueba — no debería perderse al retomar.');
        expect(entry.attackerKey).toBe('organizado');
        expect(entry.defenseKey).toBe('basica');

        // Retoma el riesgo desde el Registro (mismo flujo que el bug afectaba) y confirma que el
        // formulario refleja los valores REALES guardados, no los defaults de resetForm.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', { hasText: riskName });
        await row.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(800);

        await expect(page.locator('#fair-threat')).toHaveValue('Grupo criminal organizado E2E');
        await expect(page.locator('#fair-effect')).toHaveValue('reputacional');
        await expect(page.locator('#fair-time-horizon')).toHaveValue('3');
        await expect(page.locator('#fair-attacker-profile')).toHaveValue('organizado');
        await expect(page.locator('#fair-defense-profile')).toHaveValue('basica');
        // Fuente/Notas están en el Paso 4 — se navega ahí para confirmar sin re-simular.
        await page.click('#fair-step1-next');
        await page.waitForTimeout(200);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(200);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(200);
        await expect(page.locator('#fair-data-source')).toHaveValue('benchmark');
        await expect(page.locator('#fair-data-confidence')).toHaveValue('alto');
        await expect(page.locator('#fair-data-notes')).toHaveValue(
            'Notas E2E de prueba — no debería perderse al retomar.',
        );

        // Re-simular y volver a guardar (el flujo que la app recomienda tras retomar) NO debe
        // borrar lo que se acaba de confirmar que se restauró — regresión del bug en su forma
        // más directa: guardar sobre una restauración correcta debe seguir siendo correcta.
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);
        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === riskName);
        expect(entry.threat).toBe('Grupo criminal organizado E2E');
        expect(entry.attackerKey).toBe('organizado');
        expect(entry.defenseKey).toBe('basica');
    });
});
