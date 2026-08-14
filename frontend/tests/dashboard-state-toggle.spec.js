'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// El interruptor gobierna el Pareto y la columna resaltada de la tabla; la Matriz y el Monte Carlo
// muestran SIEMPRE los dos estados y solo atenúan el que no se mira. El Pareto cambia entero — no
// barras dobles — porque el residual responde otra pregunta y sale en OTRO ORDEN: superponerlos
// obligaría a ordenar por uno y distorsionaría el otro.
test.describe('Dashboard: interruptor Actual / Residual', () => {
    test('cambiar de estado reordena el Pareto y atenúa la mitad que no se mira', async ({ page }) => {
        await connectAndBoot(page);

        await page.evaluate(
            async ({ API, KEY }) => {
                const base = {
                    riskType: 'amenaza',
                    vulnManualOverride: true,
                    tef: { min: 1, mode: 2, max: 4 },
                    vuln: { min: 20, mode: 40, max: 60 },
                    lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
                    cvar95: 150000,
                    probExceedance: 40,
                    evaluationLevel: 'Requiere Tratamiento',
                    severity: 'alto',
                    lossExceedanceCurve: [
                        { loss: 5000, probability: 90 },
                        { loss: 50000, probability: 40 },
                        { loss: 150000, probability: 10 },
                        { loss: 400000, probability: 1 },
                    ],
                };
                const put = (riskName, extra) =>
                    fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                        body: JSON.stringify({ ...base, ...extra }),
                    });
                const decidedAt = new Date().toISOString();
                // El grande se trata a fondo, el mediano no: después de tratar, el mediano pasa a
                // ser el que más pesa. Ése es el hallazgo que el interruptor debe dejar ver.
                await put('TOGGLE Grande tratado', {
                    ale: 100000,
                    treatmentDecision: { strategy: 'mitigar', residualALE: 5000, decidedAt },
                });
                await put('TOGGLE Mediano sin tratar', { ale: 50000 });
            },
            { API, KEY },
        );

        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(3000);

        const leer = () =>
            page.evaluate(() => ({
                nota: document.getElementById('fair-pareto-state-note').textContent.trim(),
                // Posición RELATIVA de los dos riesgos sembrados, no el primer puesto absoluto: la
                // suite comparte un solo backend y para cuando este spec corre el Registro ya
                // acumuló riesgos de otros archivos, algunos más grandes que éstos.
                orden: [...document.querySelectorAll('#fair-pareto-legend ol li')].map((li) => li.textContent),
                atenuadasActual: document.querySelectorAll('[data-portfolio-state="actual"].opacity-40').length,
                atenuadasResidual: document.querySelectorAll('[data-portfolio-state="residual"].opacity-40').length,
                mc: document.getElementById('dashboard-portfolio-mc').textContent.replace(/\s+/g, ' '),
            }));

        const posicion = (orden, nombre) => orden.findIndex((t) => t.includes(nombre));

        const actual = await leer();
        expect(actual.nota).toContain('antes de tratar');
        // Antes de tratar, el grande pesa el doble que el mediano y va delante.
        expect(posicion(actual.orden, 'TOGGLE Grande tratado')).toBeGreaterThanOrEqual(0);
        expect(posicion(actual.orden, 'TOGGLE Grande tratado')).toBeLessThan(
            posicion(actual.orden, 'TOGGLE Mediano sin tratar'),
        );
        // En la vista Actual se atenúan las filas residuales, no al revés.
        expect(actual.atenuadasResidual).toBeGreaterThan(0);
        expect(actual.atenuadasActual).toBe(0);

        await page.click('#dashboard-view-residual');
        await page.waitForTimeout(800);
        const residual = await leer();
        expect(residual.nota).toContain('ya adoptados');
        // El ORDEN se invierte: el grande ya tratado cae por debajo del mediano sin tratar. Esto es
        // lo que unas barras dobles no podrían mostrar sin distorsionar uno de los dos
        // ordenamientos.
        expect(posicion(residual.orden, 'TOGGLE Mediano sin tratar')).toBeLessThan(
            posicion(residual.orden, 'TOGGLE Grande tratado'),
        );
        expect(residual.atenuadasActual).toBeGreaterThan(0);
        expect(residual.atenuadasResidual).toBe(0);

        // Las dos cifras conviven: el interruptor no esconde ninguna, comparar es el punto.
        expect(residual.mc).toContain('después de tratar');

        for (const n of ['TOGGLE Grande tratado', 'TOGGLE Mediano sin tratar']) {
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
