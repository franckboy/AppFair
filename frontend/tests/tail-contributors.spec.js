'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// "De quién es el año malo": reparto del CVaR95 conjunto entre los riesgos que lo componen
// (asignación de Euler, ver allocateTailContributions en el backend).
//
// ALCANCE, y por qué está partido en dos lugares: toda la suite E2E comparte un único backend, así
// que para cuando este spec corre el Registro ya acumuló decenas de riesgos de otros archivos —
// algunos con magnitudes enormes que se quedan con la cola entera. En ese portafolio la distinción
// "riesgo de cola vs. costo recurrente" DESAPARECE de verdad (si la cola la fija un riesgo ajeno,
// los demás aportan ahí más o menos su media), y afirmarla aquí sería medir la contaminación en
// vez del modelo. Por eso:
//
//   - la afirmación ESTADÍSTICA (la cuota de la cola no es la del promedio) se prueba donde sí se
//     controla el portafolio: backend/test/lib.test.js y, para la clasificación de la interfaz,
//     tailContributorKind en src/modules/utils.test.js;
//   - aquí se prueba lo que solo un E2E puede probar y es inmune a riesgos ajenos: que el reparto
//     SUMA el año malo del portafolio (sin eso los porcentajes serían decorativos), que el
//     interruptor Actual/Residual reparte de verdad otro total, y que un riesgo tratado cae a cero.
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

    test('el reparto suma EXACTAMENTE el año malo del portafolio y cierra en 100 %', async ({ page }) => {
        await connectAndBoot(page);
        await sembrar(page);
        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(4000);

        const bloque = page.locator('#dashboard-tail-contrib');
        await expect(bloque).toBeVisible();
        await expect(bloque).toContainText('año malo');
        // El titular: "N de M riesgos explica(n) el X %". Se comprueba su forma, no sus cifras —
        // dependen de cuántos riesgos dejaron los demás specs.
        await expect(bloque).toContainText(/\d+ de \d+ riesgos? explican?/);

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
        expect(datos.tailContributors.length).toBeGreaterThan(0);
        const suma = datos.tailContributors.reduce((a, t) => a + t.contribution, 0);
        expect(Math.abs(suma - datos.summary.cvar95)).toBeLessThan(1e-6);
        const sumaCuotas = datos.tailContributors.reduce((a, t) => a + t.sharePercent, 0);
        expect(Math.abs(sumaCuotas - 100)).toBeLessThan(0.01);

        // Lo mismo para el estado residual, que es otra corrida con otro total: si el reparto se
        // calculara una sola vez y se reetiquetara, esto lo delataría.
        const sumaResidual = datos.residual.tailContributors.reduce((a, t) => a + t.contribution, 0);
        expect(Math.abs(sumaResidual - datos.residual.summary.cvar95)).toBeLessThan(1e-6);

        // Los riesgos sembrados aquí tienen que aparecer en el reparto (con la cuota que sea).
        const nombres = datos.tailContributors.map((t) => t.riskName);
        expect(nombres).toContain(RARO);
        for (const [nombre] of FRECUENTES) expect(nombres).toContain(nombre);
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
        expect(enActual.contribution).toBeGreaterThan(0);
        expect(enResidual.contribution).toBe(0);
        expect(enResidual.sharePercent).toBe(0);
        // Y el reparto residual sigue cerrando en el CVaR residual, no en el actual.
        const sumaResidual = datos.residual.tailContributors.reduce((a, t) => a + t.contribution, 0);
        expect(Math.abs(sumaResidual - datos.residual.summary.cvar95)).toBeLessThan(1e-6);

        await page.click('#dashboard-view-actual');
        await page.waitForTimeout(600);
        expect(await bloque.innerText()).toBe(textoActual);

        // Limpieza: este spec siembra cuatro riesgos en el Registro que comparte toda la suite, y
        // uno de ellos es deliberadamente enorme — dejarlo ahí se quedaría con la cola de
        // cualquier otro spec que mire el portafolio después.
        await page.evaluate(
            async ({ API, KEY, nombres }) => {
                for (const n of nombres) {
                    await fetch(`${API}/api/register/${encodeURIComponent(n)}`, {
                        method: 'DELETE',
                        headers: { 'X-API-Key': KEY },
                    });
                }
            },
            { API, KEY, nombres: [RARO, ...FRECUENTES.map(([n]) => n)] },
        );
    });
});
