'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// El motor convierte la frecuencia en pérdida anual con `pérdida = LEF × Magnitud`: reparte una
// fracción continua de evento en TODOS los años por igual. Con una vez cada veinte años, eso
// afirma que cada año se pierde la vigésima parte de un incendio. El modelo compuesto sortea
// cuántos eventos ocurren ese año y suma sus magnitudes — mismo promedio, otra forma de cola.
// Es un diagnóstico: no guarda nada ni cambia ninguna cifra del Registro.
test.describe('Modelo de frecuencia: comparador en el detalle del riesgo', () => {
    const riskName = 'FREQ Riesgo raro y severo';

    test.afterEach(async ({ page }) => {
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'DELETE',
                    headers: { 'X-API-Key': KEY },
                });
            },
            { API, KEY, riskName },
        );
    });

    test('compara los dos modelos con la misma semilla: mismo promedio, cola distinta, y años en cero', async ({
        page,
    }) => {
        await connectAndBoot(page);

        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskType: 'amenaza',
                        vulnManualOverride: true,
                        // Raro (una vez cada ~20 años) y caro: el régimen donde los dos modelos
                        // más se separan.
                        tef: { min: 0.05, mode: 0.1, max: 0.3 },
                        vuln: { min: 20, mode: 40, max: 70 },
                        lossMagnitudes: { respuesta: { min: 5000, mode: 50000, max: 400000 } },
                        seed: 42,
                        ale: 5000,
                        cvar95: 20000,
                    }),
                });
            },
            { API, KEY, riskName },
        );

        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);

        // El detalle de un riesgo vive en el modal (ver openRiskDetailModal), y el comparador
        // adentro de él — no en un modal propio, que vaciaría el cuerpo del que lo contiene.
        await page.click(`[data-simulate-risk="${riskName}"]`);
        const panel = page.locator('#fair-frequency-models');
        await expect(panel).toBeVisible();

        await page.click('#fair-freqmodel-btn');
        const salida = page.locator('#fair-freqmodel-result');
        await expect(salida).toContainText('Ningún evento', { timeout: 20000 });

        // La mitad que NO debe moverse: los dos modelos tienen la misma media por construcción,
        // así que cambiar de modelo no reabre la calibración con la que se decide el apetito.
        const filas = await salida.locator('tbody tr').allInnerTexts();
        const aNumero = (texto) => Number(texto.replace(/[^0-9.-]/g, ''));
        const [etiquetaAle, aleActual, aleCompuesto] = filas[0].split('\t');
        expect(etiquetaAle).toBeTruthy();
        const desvio = Math.abs(aNumero(aleCompuesto) / aNumero(aleActual) - 1);
        expect(desvio).toBeLessThan(0.15);

        // La mitad que SÍ debe moverse: la cola de un riesgo raro-severo crece bastante cuando la
        // pérdida deja de llegar repartida y llega junta.
        const [, cvarActual, cvarCompuesto] = filas[2].split('\t');
        expect(aNumero(cvarCompuesto)).toBeGreaterThan(aNumero(cvarActual) * 2);

        // Y la lectura que el modelo de hoy no puede dar: la mayoría de los años no pasa nada.
        await expect(salida).toContainText('% de los años');
        await expect(salida).toContainText('misma semilla (42)');

        // Diagnóstico: el Registro sigue exactamente igual que antes de comparar.
        const guardado = await page.evaluate(
            async ({ API, KEY, riskName }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                const { risks } = await res.json();
                return risks.find((r) => r.riskName === riskName);
            },
            { API, KEY, riskName },
        );
        expect(guardado.ale).toBe(5000);
        expect(guardado.cvar95).toBe(20000);
        expect(guardado.frequencyModel).toBeUndefined();
    });

    // El detalle del riesgo vive en un modal y solo existe tras un clic, así que queda fuera del
    // alcance de simple-mode-no-jargon.spec.js (que recorre páginas). Este comparador es texto
    // nuevo visible para el usuario: su Modo Simple se verifica aquí, con la misma red de jerga.
    test('en Modo Simple no muestra jerga técnica (ni "Poisson", ni las siglas)', async ({ page }) => {
        await connectAndBoot(page);

        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskType: 'amenaza',
                        vulnManualOverride: true,
                        tef: { min: 0.05, mode: 0.1, max: 0.3 },
                        vuln: { min: 20, mode: 40, max: 70 },
                        lossMagnitudes: { respuesta: { min: 5000, mode: 50000, max: 400000 } },
                        seed: 42,
                        ale: 5000,
                        cvar95: 20000,
                    }),
                });
            },
            { API, KEY, riskName },
        );

        await connectAndBoot(page);
        // El botón anuncia el modo VIGENTE y, entre paréntesis, al que se cambiaría — leerlo con
        // un regex de "técnico" daría positivo en los dos casos. La clase del <body> es la señal
        // sin ambigüedad (ver App.UIMode.apply).
        await expect(page.locator('#mode-toggle-btn')).not.toHaveText('');
        if (!(await page.evaluate(() => document.body.classList.contains('modo-simple')))) {
            await page.click('#mode-toggle-btn');
            await page.waitForTimeout(300);
        }
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);

        await page.click(`[data-simulate-risk="${riskName}"]`);
        await page.click('#fair-freqmodel-btn');
        await expect(page.locator('#fair-freqmodel-result')).toContainText('% de los años', { timeout: 20000 });

        const texto = await page.locator('#fair-frequency-models').innerText();
        const jerga = texto.match(
            /\bCVaR\b|\bALE\b|\bP90\b|\bTEF\b|\bLEF\b|\bLEC\b|Beta-PERT|Monte Carlo|Poisson|Pareto|correlaci[oó]n|Excedencia/i,
        );
        expect(jerga, `el comparador muestra jerga en Modo Simple: "${jerga ? jerga[0] : ''}"`).toBeNull();
    });
});
