'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

// El Nivel de Acceso modula la Fuerza de Resistencia (R_efectiva = R x alfa): quien ya está
// adentro se salta salvaguardas enteras, así que la misma defensa rinde menos contra él. Es una
// propiedad del RIESGO, no del Perfil de Atacante — el mismo empleado tiene acceso total a su
// bodega y ninguno al centro de datos.
test.describe('Nivel de Acceso del atacante', () => {
    async function analizarConAcceso(page, riskName, accessLevel) {
        await page.fill('#fair-riskName', riskName);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.selectOption('#fair-attacker-profile', 'empleado-desleal');
        await page.selectOption('#fair-defense-profile', 'avanzada');
        await page.selectOption('#fair-access-level', accessLevel);
        await page.waitForTimeout(900);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1200);
    }

    test('más acceso sube la Vulnerabilidad, y el nivel se persiste y se restaura', async ({ page }) => {
        await connectAndBoot(page);
        await analizarConAcceso(page, 'E2E — Insider sin acceso', 'nulo');
        await connectAndBoot(page);
        await analizarConAcceso(page, 'E2E — Insider privilegiado', 'alto');

        const entries = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const { risks } = await res.json();
            return {
                nulo: risks.find((r) => r.riskName === 'E2E — Insider sin acceso'),
                alto: risks.find((r) => r.riskName === 'E2E — Insider privilegiado'),
            };
        });

        expect(entries.nulo.accessLevel).toBe('nulo');
        expect(entries.alto.accessLevel).toBe('alto');
        // Mismo atacante, misma defensa: lo único que cambia es cuánto de esa defensa se interpone.
        expect(entries.alto.vuln.mode).toBeGreaterThan(entries.nulo.vuln.mode);

        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(600);
        const fila = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Insider privilegiado' });
        await fila.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(900);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-access-level')).toHaveValue('alto');
    });

    test('sin adversario el Nivel de Acceso desaparece: un incendio no tiene credenciales', async ({ page }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Acceso sin adversario');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-access-level-container')).toBeVisible();
        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-access-level-container')).toBeHidden();
    });
});
