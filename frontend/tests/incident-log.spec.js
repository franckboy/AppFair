'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

async function abrirBitacora(page) {
    await page.click('#nav-config');
    await page.waitForTimeout(300);
    await page.click('#modalBody button:has-text("Bitácora de Incidentes")');
    await page.waitForTimeout(500);
    await expect(page.locator('#modalTitle')).toHaveText('Bitácora de Incidentes');
}

async function leerBitacora(page) {
    return page.evaluate(
        async ({ API, KEY }) => {
            const res = await fetch(`${API}/api/config/incident-log`, { headers: { 'X-API-Key': KEY } });
            return res.json();
        },
        { API, KEY },
    );
}

test.describe('Bitácora de Incidentes', () => {
    test('captura evidencia con su exposición, la persiste, y la vuelve a mostrar', async ({ page }) => {
        const riskName = 'E2E Bitácora — Robo de carga';
        await connectAndBoot(page);
        // TEF 2/año x Vulnerabilidad 30 % = LEF 0,6/año. Es contra ESE número que se compara la
        // bitácora, no contra el TEF: una bitácora cuenta robos consumados, no intentos.
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskType: 'amenaza',
                        tef: { min: 1.6, mode: 2, max: 2.4 },
                        vuln: { min: 28, mode: 30, max: 32 },
                        lossMagnitudes: { respuesta: { min: 1000, mode: 2000, max: 3000 } },
                        ale: 1200,
                        cvar95: 5000,
                        evaluationLevel: 'Alto',
                        severity: 'alto',
                    }),
                });
            },
            { API, KEY, riskName },
        );
        await page.reload({ waitUntil: 'networkidle' });
        await connectAndBoot(page);

        await abrirBitacora(page);
        await page.click('#log-add-btn');
        const fila = page.locator('[data-log-row]').first();
        await fila.locator('[data-field="tipoEvento"]').fill('Robo de carga completa');
        await fila.locator('[data-field="riskName"]').selectOption(riskName);
        await fila.locator('[data-field="estado"]').selectOption('conteo');
        await fila.locator('[data-field="conteo"]').fill('3');
        await fila.locator('[data-field="cantidad"]').fill('5');
        await fila.locator('[data-field="unidad"]').selectOption('anios');
        await page.click('#log-save-btn');
        await page.waitForTimeout(800);

        const guardada = await leerBitacora(page);
        expect(guardada.entries).toHaveLength(1);
        expect(guardada.entries[0].conteo).toBe(3);
        expect(guardada.entries[0].exposicion).toEqual({ cantidad: 5, unidad: 'anios' });

        // Se compara contra el LEF (2 x 0,30 = 0,6), no contra el TEF crudo (2).
        const d = guardada.summary.diagnostics[0];
        expect(d.tasaObservada).toBeCloseTo(0.6, 6);
        expect(d.lefModelo).toBeCloseTo(0.6, 6);
        expect(guardada.summary.comparables).toBe(1);

        // Y al reabrir, la evidencia vuelve con su diagnóstico a la vista.
        await abrirBitacora(page);
        await expect(page.locator('[data-log-row]').first().locator('[data-field="conteo"]')).toHaveValue('3');
        await expect(page.locator('[data-log-diagnostic]').first()).toContainText('el modelo esperaba');
    });

    test('"no lo medimos" y "revisado: no pasó" se guardan distinto', async ({ page }) => {
        // El punto de diseño que sostiene todo lo demás. Si el formulario los confundiera, el
        // riesgo se iría al piso para todo lo que nadie midió.
        await connectAndBoot(page);
        await abrirBitacora(page);

        // Se parte de lo que haya y se agregan dos filas nuevas.
        const antes = await page.locator('[data-log-row]').count();
        await page.click('#log-add-btn');
        await page.click('#log-add-btn');
        const sinDatos = page.locator('[data-log-row]').nth(antes);
        const cero = page.locator('[data-log-row]').nth(antes + 1);

        await sinDatos.locator('[data-field="tipoEvento"]').fill('E2E Nadie lo midió');
        // Se deja en el estado por defecto a propósito: ese default TIENE que ser "no lo medimos".
        await expect(sinDatos.locator('[data-field="estado"]')).toHaveValue('sin_datos');

        await cero.locator('[data-field="tipoEvento"]').fill('E2E Revisado sin eventos');
        await cero.locator('[data-field="estado"]').selectOption('cero');
        await cero.locator('[data-field="cantidad"]').fill('6');
        await cero.locator('[data-field="unidad"]').selectOption('anios');

        await page.click('#log-save-btn');
        await page.waitForTimeout(800);

        const log = await leerBitacora(page);
        const nadie = log.summary.diagnostics.find((d) => d.tipoEvento === 'E2E Nadie lo midió');
        const revisado = log.summary.diagnostics.find((d) => d.tipoEvento === 'E2E Revisado sin eventos');

        // El que nadie midió no aporta ninguna tasa: ausencia de evidencia, no evidencia de cero.
        expect(nadie.estado).toBe('sin_datos');
        expect(nadie.tasaObservada).toBeNull();
        // El cero declarado sí aporta, y viene con su cota: 3/6 = 0,5 al 95 %.
        expect(revisado.estado).toBe('cero');
        expect(revisado.tasaObservada).toBe(0);
        expect(revisado.cotaSuperior95).toBeCloseTo(0.5, 6);
    });

    test('un conteo sin exposición se rechaza antes de mandarlo, y dice por qué', async ({ page }) => {
        // "3 robos" no significa nada sin "en cuántos años", y descubrirlo meses después —cuando ya
        // no se le puede preguntar a nadie— es descubrirlo tarde.
        await connectAndBoot(page);
        await abrirBitacora(page);

        const antes = await page.locator('[data-log-row]').count();
        await page.click('#log-add-btn');
        const fila = page.locator('[data-log-row]').nth(antes);
        await fila.locator('[data-field="tipoEvento"]').fill('E2E Sin exposición');
        await fila.locator('[data-field="estado"]').selectOption('conteo');
        await fila.locator('[data-field="conteo"]').fill('4');
        // Exposición deliberadamente vacía.
        await page.click('#log-save-btn');
        await page.waitForTimeout(400);

        await expect(page.locator('#log-modal-error')).toBeVisible();
        await expect(page.locator('#log-modal-error')).toContainText('en cuántos años');
        // Y el modal sigue abierto: no se perdió lo escrito.
        await expect(page.locator('#modalTitle')).toHaveText('Bitácora de Incidentes');
    });
});
