'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Análisis FAIR completo', () => {
    test('Pasos 1→4 completos: el riesgo termina en Riesgos Guardados como Analizado (FAIR)', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Robo en Bodega Norte');

        await page.click('#nav-dashboard');
        await page.waitForTimeout(500);

        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Robo en Bodega Norte' });
        await expect(row).toBeVisible();
        await expect(row).toContainText('Analizado (FAIR)');

        // Riesgo Actual y CVaR 95% deben mostrar un monto en dólares, no un placeholder vacío.
        // índices: 0 checkbox, 1 #, 2 riesgo, 3 etapa, 4 inherente, 5 efectividad, 6 actual,
        // 7 residual, 8 activo, 9 cvar, 10 evaluación.
        const cells = row.locator('td');
        await expect(cells.nth(6)).toContainText('$'); // Riesgo Actual
        await expect(cells.nth(9)).toContainText('$'); // CVaR 95%
        // Recién analizado y sin decisión de Tratamiento: la etapa Residual todavía no existe.
        await expect(cells.nth(7)).toContainText('sin tratar');
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

    // El sello de calibración (ver VULNERABILITY_CALIBRATION_VERSION en backend/src/lib/autocalc.js)
    // distingue un riesgo calculado con el modelo de Vulnerabilidad vigente de uno calculado con
    // una calibración anterior. Los viejos NO se recalculan solos — se marcan y el analista decide.
    test('un riesgo recién simulado queda sellado con la calibración vigente; uno viejo se marca "Recalibrar"', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E — Calibración Vigente');

        const { vigente, entry } = await page.evaluate(async () => {
            const headers = { 'X-API-Key': 'test-e2e-key' };
            const profiles = await (await fetch('http://localhost:3000/api/config/profiles', { headers })).json();
            const register = await (await fetch('http://localhost:3000/api/register', { headers })).json();
            return {
                vigente: profiles.calibrationVersion,
                entry: register.risks.find((r) => r.riskName === 'E2E — Calibración Vigente'),
            };
        });
        expect(vigente).toBeGreaterThanOrEqual(2);
        expect(entry.calibrationVersion).toBe(vigente);

        // Un riesgo guardado SIN sello representa lo que ya estaba en el Registro antes de esta
        // recalibración: debe aparecer marcado, sin que nadie le haya tocado los números.
        await page.evaluate(async () => {
            await fetch('http://localhost:3000/api/register/' + encodeURIComponent('E2E — Calibración Vieja'), {
                method: 'PUT',
                headers: { 'X-API-Key': 'test-e2e-key', 'Content-Type': 'application/json' },
                body: JSON.stringify({ ale: 12345, cvar95: 20000, riskType: 'amenaza' }),
            });
        });

        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-dashboard');
        await page.waitForTimeout(600);

        const vieja = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Calibración Vieja' });
        await expect(vieja.getByText('Recalibrar')).toBeVisible();

        const vigenteRow = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E — Calibración Vigente' });
        await expect(vigenteRow.getByText('Recalibrar')).toHaveCount(0);
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
        await page.click('#nav-dashboard');
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
        await page.click('#nav-dashboard');
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
        await page.click('#nav-dashboard');
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

test.describe('Curva de Excedencia de Pérdidas (LEC)', () => {
    test('se dibuja en el Paso 4 con las dos etapas y los umbrales, y se persiste en el Registro', async ({ page }) => {
        await connectAndBoot(page);
        const riskName = 'E2E LEC — Robo con Violencia';
        await runFullFairAnalysis(page, riskName);
        // La curva vive en el modal de detalle del riesgo desde que se separó la captura de los
        // resultados: el wizard pregunta datos, el detalle es donde se estudian.
        await page.click('#fair-goto-dashboard-btn');
        await page.waitForTimeout(600);

        await expect(page.locator('#fair-lec-container')).toBeVisible();

        // Cuatro series: Actual, Inherente, y los dos umbrales de Criterios de Riesgo. Sin los
        // umbrales la curva es solo un dibujo bonito — es su cruce con la curva lo que responde
        // "¿con qué probabilidad me paso de lo que dije tolerar?".
        const grafico = await page.evaluate(() => {
            const chart = Chart.getChart('fair-lec-chart');
            if (!chart) return null;
            return {
                series: chart.data.datasets.map((d) => d.label),
                puntosActual: chart.data.datasets[0].data.length,
                // La curva debe ir hacia abajo: a más dinero, menos probabilidad de excederlo.
                monotona: chart.data.datasets[0].data.every(
                    (p, i, arr) => i === 0 || (p.x >= arr[i - 1].x && p.y <= arr[i - 1].y),
                ),
            };
        });
        expect(grafico).not.toBeNull();
        expect(grafico.puntosActual).toBeGreaterThan(20);
        expect(grafico.monotona).toBe(true);
        expect(grafico.series.length).toBe(4);

        // Persistida: sin esto la curva viviría solo en la sesión donde se simuló y desaparecería
        // del Registro (las 10,000 pérdidas crudas no se guardan, ver buildLossExceedanceCurve).
        const guardada = await page.evaluate(async (nombre) => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const entry = data.risks.find((r) => r.riskName === nombre);
            return {
                puntos: entry.lossExceedanceCurve ? entry.lossExceedanceCurve.length : 0,
                inherente: entry.inherentLossExceedanceCurve ? entry.inherentLossExceedanceCurve.length : 0,
            };
        }, riskName);
        expect(guardada.puntos).toBeGreaterThan(20);
        expect(guardada.inherente).toBeGreaterThan(20);
    });
});
