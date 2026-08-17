'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// El TEF capturado es la frecuencia PROPIA del riesgo, estimada de datos que ya incluyen las veces
// que ocurrió porque ocurrió el padre. La cascada EXPLICA una parte de esas ocurrencias en vez de
// añadirlas encima: el ALE no se mueve, la cola sí. Y cuando los padres declarados inducen más
// eventos de los que el hijo dice tener, los datos se contradicen y hay que decirlo.
test.describe('Cascada: doble conteo y contradicción de datos', () => {
    test('avisa cuando las causas declaradas provocan el riesgo más veces de las que ocurre', async ({ page }) => {
        await connectAndBoot(page);

        const padre = 'DOBLE Padre frecuente';
        const hijo = 'DOBLE Hijo rarisimo';
        await page.evaluate(
            async ({ API, KEY, padre, hijo }) => {
                const base = {
                    riskType: 'amenaza',
                    vulnManualOverride: true,
                    vuln: { min: 40, mode: 60, max: 80 },
                    lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
                    ale: 20000,
                    cvar95: 50000,
                };
                const put = (riskName, extra) =>
                    fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                        body: JSON.stringify({ ...base, ...extra }),
                    });
                await put(padre, { tef: { min: 8, mode: 10, max: 12 } });
                // Dice ocurrir 0,02 veces al año, pero declara un padre frecuente que lo causa el
                // 90% de las veces: los dos datos no pueden ser ciertos a la vez.
                await put(hijo, {
                    tef: { min: 0.01, mode: 0.02, max: 0.03 },
                    triggeredBy: [{ riskName: padre, probability: 90 }],
                });
            },
            { API, KEY, padre, hijo },
        );

        // El motor lo acota para no inflar el portafolio, y lo reporta.
        const mc = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register/portfolio-simulation`, { headers: { 'X-API-Key': KEY } });
                return res.json();
            },
            { API, KEY },
        );
        expect(mc.overCoupledRiskNames).toContain(hijo);

        // Y el Dashboard lo dice: es un dato que solo el usuario puede corregir.
        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(3000);
        const bloque = page.locator('#dashboard-portfolio-mc');
        await expect(bloque).toContainText('Revisa este riesgo');
        await expect(bloque).toContainText(hijo);

        for (const n of [padre, hijo]) {
            await page.evaluate(
                async ({ API, KEY, n }) => {
                    await fetch(`${API}/api/register/${encodeURIComponent(n)}`, {
                        method: 'DELETE',
                        headers: { 'X-API-Key': KEY },
                    });
                },
                { API, KEY, n },
            );
        }
    });
});
