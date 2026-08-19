'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// "De quién es el año malo": reparto del CVaR95 conjunto entre los riesgos que lo componen
// (asignación de Euler, ver allocateTailContributions en el backend).
//
// Lo que hace falta proteger aquí no es que el bloque pinte algo, sino las dos afirmaciones que
// hace: que el reparto SUMA el año malo del portafolio (si no, los porcentajes serían decorativos)
// y que distingue un riesgo de COLA de un costo recurrente (si no, no diría nada que el Pareto —
// que es sobre el promedio — no dijera ya).
test.describe('De quién es el año malo (contribución al CVaR95 del portafolio)', () => {
    // Un raro y severo contra tres frecuentes y menores: el raro debe dominar la cola aunque pese
    // poco en el promedio, que es justo la distinción que este bloque existe para mostrar.
    const RARO = 'E2E Año Malo — Asalto a bodega (raro y severo)';
    const FRECUENTES = [
        ['E2E Año Malo — Hurto hormiga', { min: 30, mode: 48, max: 70 }, { min: 300, mode: 900, max: 2500 }],
        ['E2E Año Malo — Daño a flota', { min: 3, mode: 6, max: 12 }, { min: 2000, mode: 8000, max: 25000 }],
        ['E2E Año Malo — Vandalismo perimetral', { min: 8, mode: 14, max: 22 }, { min: 500, mode: 1800, max: 6000 }],
    ];

    async function sembrar(page) {
        await page.evaluate(
            async ({ API, KEY, RARO, FRECUENTES }) => {
                const entrada = (riskName, tef, lm) => ({
                    riskName,
                    riskType: 'amenaza',
                    // Vulnerabilidad a mano: este spec mide el REPARTO, no la calibración — fijar
                    // el triángulo lo deja inmune a cualquier recalibración futura.
                    vulnManualOverride: true,
                    tef,
                    vuln: { min: 40, mode: 60, max: 80 },
                    lossMagnitudes: { respuesta: lm },
                    ale: 1000,
                    cvar95: 5000,
                    evaluationLevel: 'Aceptable',
                    severity: 'bajo',
                    chartLabels: ['x'],
                    chartData: [1],
                });
                const put = (body) =>
                    fetch(`${API}/api/register/${encodeURIComponent(body.riskName)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                        body: JSON.stringify(body),
                    });
                await put(
                    entrada(RARO, { min: 0.05, mode: 0.12, max: 0.3 }, { min: 200000, mode: 900000, max: 3000000 }),
                );
                for (const [nombre, tef, lm] of FRECUENTES) await put(entrada(nombre, tef, lm));
            },
            { API, KEY, RARO, FRECUENTES },
        );
    }

    test('el reparto suma el año malo del portafolio y separa la cola del costo recurrente', async ({ page }) => {
        await connectAndBoot(page);
        await sembrar(page);
        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(4000);

        const bloque = page.locator('#dashboard-tail-contrib');
        await expect(bloque).toBeVisible();
        await expect(bloque).toContainText('año malo');

        // La afirmación central, verificada contra el backend real: las contribuciones tienen que
        // sumar EXACTAMENTE el CVaR95 del portafolio. Es lo que permite leer los porcentajes como
        // un reparto y no como una estimación — y lo que se rompería en silencio si algún día la
        // cascada añadiera un término al total sin anotarlo en el aporte de ningún riesgo.
        const datos = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register/portfolio-simulation`, { headers: { 'X-API-Key': KEY } });
                return res.json();
            },
            { API, KEY },
        );
        const suma = datos.tailContributors.reduce((a, t) => a + t.contribution, 0);
        expect(Math.abs(suma - datos.summary.cvar95)).toBeLessThan(1e-6);
        const sumaCuotas = datos.tailContributors.reduce((a, t) => a + t.sharePercent, 0);
        expect(Math.abs(sumaCuotas - 100)).toBeLessThan(0.01);

        // Y la distinción que justifica el bloque: el raro y severo pesa MUCHO más en la cola que
        // en el promedio. Sin esta diferencia, el reparto no diría nada que el Pareto (que es
        // sobre el promedio) no dijera ya.
        const raro = datos.tailContributors.find((t) => t.riskName === RARO);
        expect(raro).toBeTruthy();
        expect(raro.sharePercent).toBeGreaterThan(raro.expectedSharePercent + 10);

        // Eso mismo, dicho en pantalla: el riesgo de cola sale etiquetado.
        const fila = bloque.locator('div', { hasText: RARO }).first();
        await expect(fila).toContainText('pesa más en los años malos');
    });

    test('el interruptor Actual/Residual reparte el año malo DESPUÉS de tratar', async ({ page }) => {
        await connectAndBoot(page);
        await sembrar(page);
        // Evitar el riesgo dominante: su residual es 0, así que el reparto del año malo residual
        // tiene que quedar en manos de los otros tres. Es el caso que más claramente demuestra que
        // el bloque no está mostrando el mismo reparto con otra etiqueta.
        await page.evaluate(
            async ({ API, KEY, RARO }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                const entrada = (await res.json()).risks.find((r) => r.riskName === RARO);
                await fetch(`${API}/api/register/${encodeURIComponent(RARO)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        ...entrada,
                        treatmentDecision: {
                            strategy: 'evitar',
                            residualALE: 0,
                            residualCVaR: 0,
                            decidedAt: new Date().toISOString(),
                        },
                    }),
                });
            },
            { API, KEY, RARO },
        );
        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(4000);

        const bloque = page.locator('#dashboard-tail-contrib');
        await expect(bloque).toContainText(RARO);
        const textoActual = await bloque.innerText();

        await page.click('#dashboard-view-residual');
        await page.waitForTimeout(600);
        const textoResidual = await bloque.innerText();
        expect(textoResidual).not.toBe(textoActual);

        // Evitado = no aporta NADA al año malo residual. Se comprueba contra el backend y no por
        // ausencia en el texto: el riesgo sigue listado a propósito, con $0 (0,0 %), porque ver
        // caer a cero al que dominaba la cola es justamente la evidencia de que el tratamiento
        // sirvió — esconderlo la borraría.
        const datos = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register/portfolio-simulation`, { headers: { 'X-API-Key': KEY } });
                return res.json();
            },
            { API, KEY },
        );
        const enActual = datos.tailContributors.find((t) => t.riskName === RARO);
        const enResidual = datos.residual.tailContributors.find((t) => t.riskName === RARO);
        expect(enActual.sharePercent).toBeGreaterThan(50);
        expect(enResidual.contribution).toBe(0);
        expect(enResidual.sharePercent).toBe(0);
        // Y el reparto residual sigue cerrando en el CVaR residual, no en el actual.
        const sumaResidual = datos.residual.tailContributors.reduce((a, t) => a + t.contribution, 0);
        expect(Math.abs(sumaResidual - datos.residual.summary.cvar95)).toBeLessThan(1e-6);

        await page.click('#dashboard-view-actual');
        await page.waitForTimeout(600);
        await expect(bloque).toContainText(RARO);
    });
});
