'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// La flecha de migración es la lectura que un comité entiende sin explicación: los riesgos
// desplazándose fuera de la zona crítica. Lo que se prueba aquí no es el dibujo sino las
// COORDENADAS que lo alimentan, y sobre todo los casos donde NO debe haber punto verde.
test.describe('Matriz de Riesgos: migración Actual → Residual', () => {
    test('solo hay punto residual donde hay uno honesto que dibujar', async ({ page }) => {
        await connectAndBoot(page);

        // Se siembra por API en vez de correr cuatro wizards: hace falta la curva de excedencia
        // guardada (de ahí sale la Y residual) y cuatro estrategias distintas.
        await page.evaluate(
            async ({ API, KEY }) => {
                const base = {
                    riskType: 'amenaza',
                    vulnManualOverride: true,
                    tef: { min: 1, mode: 2, max: 4 },
                    vuln: { min: 20, mode: 40, max: 60 },
                    lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
                    ale: 60000,
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
                await put('MIGRA Sin tratar', {});
                await put('MIGRA Mitigado', {
                    treatmentDecision: { strategy: 'mitigar', residualALE: 15000, decidedAt },
                });
                await put('MIGRA Asegurado', {
                    treatmentDecision: { strategy: 'transferir', residualALE: 15000, decidedAt },
                });
                await put('MIGRA Aceptado', {
                    treatmentDecision: { strategy: 'aceptar', residualALE: 60000, decidedAt },
                });
            },
            { API, KEY },
        );

        const datos = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                const { risks } = await res.json();
                const p = (n) => {
                    const r = risks.find((x) => x.riskName === n);
                    return { punto: r.residualMatrixPoint, actual: { x: r.impactPercent, y: r.probabilityPercent } };
                };
                return {
                    sinTratar: p('MIGRA Sin tratar'),
                    mitigado: p('MIGRA Mitigado'),
                    asegurado: p('MIGRA Asegurado'),
                    aceptado: p('MIGRA Aceptado'),
                };
            },
            { API, KEY },
        );

        // Sin decisión adoptada no hay residual que mostrar.
        expect(datos.sinTratar.punto).toBeNull();
        // Transferir: hay X (residualALE) pero NO Y — una póliza recorta las pérdidas grandes en vez
        // de reducirlas de forma pareja. Mover solo X afirmaría que la probabilidad no cambió.
        expect(datos.asegurado.punto).toBeNull();

        // Mitigar (k = 15000/60000 = 0.25) migra en los DOS ejes.
        expect(datos.mitigado.punto.k).toBeCloseTo(0.25, 5);
        expect(datos.mitigado.punto.impactPercent).toBeLessThan(datos.mitigado.actual.x);
        expect(datos.mitigado.punto.probabilityPercent).toBeLessThan(datos.mitigado.actual.y);

        // Aceptar es una decisión documentada que NO mueve nada: cae EXACTAMENTE sobre su punto
        // actual, para que no parezca que aceptar redujo algo.
        expect(datos.aceptado.punto.k).toBe(1);
        expect(datos.aceptado.punto.probabilityPercent).toBe(datos.aceptado.actual.y);
        expect(datos.aceptado.punto.impactPercent).toBe(datos.aceptado.actual.x);

        // La nota debe decir cuántos tienen tratamiento: sin ella, un portafolio con pocos tratados
        // se ve casi idéntico con y sin flechas y parece que el tratamiento no sirvió.
        await page.click('#nav-dashboard');
        await page.waitForTimeout(2000);
        const nota = page.locator('#fair-matrix-migration-note');
        await expect(nota).toBeVisible();
        await expect(nota).toContainText('estrategia adoptada');
        await expect(nota).toContainText('con seguro no lleva flecha');

        for (const n of ['MIGRA Sin tratar', 'MIGRA Mitigado', 'MIGRA Asegurado', 'MIGRA Aceptado']) {
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
