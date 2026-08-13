'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

// Una amenaza NO deliberada (sismo, incendio accidental, falla de equipo) no tiene adversario, así
// que el modelo de contienda Atacante vs. Defensa no aplica: los perfiles se ocultan, la
// Vulnerabilidad se pide directa, y el Equilibrio de Nash — que resuelve una contienda entre dos
// jugadores que eligen su esfuerzo — desaparece.
//
// El interruptor y los perfiles viven en el PASO 2 (Análisis de Frecuencia), no en el Paso 1.
// El panel de Nash además es `advanced-only`, así que solo existe en Modo Técnico; la app abre en
// Modo Simple, y estas pruebas cambian de modo explícitamente cuando necesitan verlo.
test.describe('Amenaza no deliberada', () => {
    test('el interruptor oculta perfiles y ajuste manual, y los devuelve al reactivarlo', async ({ page }) => {
        await connectAndBoot(page);

        // Por defecto una amenaza SÍ es deliberada: es el caso principal de una app de seguridad
        // patrimonial, y el formulario abre con la casilla marcada.
        await page.fill('#fair-riskName', 'E2E — Sismo sin adversario');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-deliberate-threat')).toBeChecked();
        await expect(page.locator('#fair-attacker-defense-section')).toBeVisible();
        await expect(page.locator('#vuln-manual-override-container')).toBeVisible();

        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-attacker-defense-section')).toBeHidden();
        // El checkbox de ajuste manual sobra cuando la Vulnerabilidad SIEMPRE es manual.
        await expect(page.locator('#vuln-manual-override-container')).toBeHidden();
        await expect(page.locator('#vuln-mode')).toBeEditable();

        // Y vuelve todo al reactivar: el modo no es de una sola vía.
        await page.check('#fair-deliberate-threat');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-attacker-defense-section')).toBeVisible();
        await expect(page.locator('#vuln-manual-override-container')).toBeVisible();
    });

    // Etapa 3: sin perfiles no hay contienda que resolver, y el cálculo exige attackerKey +
    // defenseKey — dejar el panel visible sería ofrecer un botón que solo puede terminar en el
    // aviso "completa el Paso 1".
    // El panel vive en el Paso 4 (resultados), así que solo se puede observar después de simular;
    // el interruptor que lo controla está en el Paso 2.
    test('el Equilibrio de Nash desaparece sin adversario y vuelve con él (Modo Técnico)', async ({ page }) => {
        await connectAndBoot(page);
        await page.click('#mode-toggle-btn');
        await page.waitForTimeout(300);
        await runFullFairAnalysis(page, 'E2E — Nash con adversario presente');
        await expect(page.locator('#fair-nash-container')).toBeVisible();

        await page.click('#fair-step4-back');
        await page.waitForTimeout(300);
        await page.click('#fair-step3-back');
        await page.waitForTimeout(400);
        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(400);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
        await expect(page.locator('#fair-nash-container')).toBeHidden();
    });

    test('el flujo completo termina en el Registro con la Vulnerabilidad capturada a mano y sin Perfil de Atacante', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Incendio accidental');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(500);

        // Sin Perfil de Atacante no hay Frecuencia sugerida — para una amenaza no deliberada solo
        // el usuario sabe cada cuánto ocurre, así que aquí SIEMPRE se captura a mano.
        await page.fill('#tef-min', '1');
        await page.fill('#tef-mode', '2');
        await page.fill('#tef-max', '4');
        await page.fill('#vuln-min', '10');
        await page.fill('#vuln-mode', '25');
        await page.fill('#vuln-max', '40');
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        // Sin ninguna Magnitud de Pérdida capturada el ALE sale 0 por definición (Pérdida = LEF x
        // Magnitud) — se llena una categoría para que el resultado sea comprobable.
        await page.check('#lm-manual-override');
        await page.waitForTimeout(300);
        await page.fill('#lm-respuesta-min', '5000');
        await page.fill('#lm-respuesta-mode', '20000');
        await page.fill('#lm-respuesta-max', '50000');
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        const entry = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const register = await res.json();
            return register.risks.find((r) => r.riskName === 'E2E — Incendio accidental');
        });

        expect(entry).toBeTruthy();
        expect(entry.isDeliberate).toBe(false);
        // Sin perfil de atacante: el backend simula muestreando el rango capturado, sin contienda.
        expect(entry.attackerKey || null).toBeNull();
        expect(entry.vuln).toMatchObject({ min: 10, mode: 25, max: 40 });
        expect(entry.vulnManualOverride).toBe(true);
        expect(entry.ale).toBeGreaterThan(0);

        // Y sobrevive al retomarlo: sin persistir isDeliberate, inferDeliberateThreat lo trataba
        // como deliberado y resucitaba unos perfiles que nunca se eligieron.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-fair');
        await page.waitForTimeout(600);
        const fila = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Incendio accidental' });
        await fila.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(900);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-deliberate-threat')).not.toBeChecked();
        await expect(page.locator('#fair-attacker-defense-section')).toBeHidden();
    });

    test('una amenaza deliberada conserva el Equilibrio de Nash y su comparación a esfuerzo fijo', async ({ page }) => {
        await connectAndBoot(page);
        await page.click('#mode-toggle-btn');
        await page.waitForTimeout(300);
        await runFullFairAnalysis(page, 'E2E — Nash con adversario');

        await expect(page.locator('#fair-nash-container')).toBeVisible();
        await page.fill('#nash-cost-attacker', '500');
        await page.fill('#nash-cost-defense', '800');
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/autocalc/nash-equilibrium'), { timeout: 15000 }),
            page.click('#nash-calculate-btn'),
        ]);
        await expect(page.locator('#nash-results')).toBeVisible();
        await expect(page.locator('#nash-fixed-vuln')).not.toHaveText('');
    });
});

// Pérdida = Frecuencia x Vulnerabilidad x Magnitud: basta con que uno de los tres quede en cero
// para que el análisis entero valga 0. El caso más fácil de topar es justo el no deliberado — sin
// Perfil de Atacante no hay Frecuencia sugerida.
test.describe('Avisos de datos incompletos', () => {
    test('un análisis que da ALE 0 lo avisa y nombra el factor en cero, en vez de guardarse en silencio', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Análisis sin magnitud');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(400);
        await page.fill('#vuln-min', '10');
        await page.fill('#vuln-mode', '25');
        await page.fill('#vuln-max', '40');
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        // Se deja la Magnitud de Pérdida en cero a propósito.
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1200);

        const aviso = page.locator('#fair-zero-ale-warning');
        await expect(aviso).toBeVisible();
        await expect(aviso).toContainText('Magnitud de Pérdida');
    });

    test('la Frecuencia acepta decimales — un sismo cada 20 años es 0,05 al año, no 0', async ({ page }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E — Sismo cada 20 años');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.uncheck('#fair-deliberate-threat');
        await page.waitForTimeout(400);

        // Antes, type="number" sin step usaba step="1": 0.05 era inválido y el oninput lo borraba.
        await page.fill('#tef-min', '0.02');
        await page.fill('#tef-mode', '0.05');
        await page.fill('#tef-max', '0.1');
        await expect(page.locator('#tef-mode')).toHaveValue('0.05');

        await page.fill('#vuln-min', '40');
        await page.fill('#vuln-mode', '60');
        await page.fill('#vuln-max', '80');
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        await page.check('#lm-manual-override');
        await page.waitForTimeout(300);
        await page.fill('#lm-respuesta-min', '100000');
        await page.fill('#lm-respuesta-mode', '500000');
        await page.fill('#lm-respuesta-max', '2000000');
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
        const [resp] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        expect(resp.request().postDataJSON().tef).toMatchObject({ min: 0.02, mode: 0.05, max: 0.1 });
        await page.waitForTimeout(1200);
        await expect(page.locator('#fair-zero-ale-warning')).toBeHidden();
    });
});
