'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// Procedencia por factor: de dónde salió cada uno de los tres números que se multiplican para dar
// la pérdida anual esperada.
//
// Lo que hay que proteger no es que la tabla se pinte, sino el VIAJE COMPLETO del dato: se declara
// en el Paso 4, se guarda, y vuelve idéntico al retomar el riesgo. Un campo que se pinta pero no
// se persiste (o que vuelve con otro valor) es peor que no tenerlo: deja constancia falsa.
test.describe('Procedencia por factor', () => {
    const RIESGO = 'E2E Procedencia — Robo con histórico propio';

    async function irAlPaso4(page, riskName) {
        await page.fill('#fair-riskName', riskName);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
    }

    async function modoTecnico(page) {
        // La tabla es `advanced-only`: en Modo Simple no existe, a propósito.
        const texto = await page.locator('#mode-toggle-btn').textContent();
        if (texto.includes('Modo Simple')) await page.click('#mode-toggle-btn');
        await page.waitForTimeout(300);
    }

    test('se declara, se guarda, y vuelve idéntica al retomar el riesgo', async ({ page }) => {
        await connectAndBoot(page);
        await modoTecnico(page);
        await irAlPaso4(page, RIESGO);

        // Los tres factores, siempre — que un factor no declarado no desaparezca es parte del punto.
        await expect(page.locator('#fair-provenance-body [data-provenance-row]')).toHaveCount(3);

        const campo = (factor, nombre) => `[data-provenance-row="${factor}"] [data-provenance-field="${nombre}"]`;
        await page.selectOption(campo('tef', 'origen'), 'historico-propio');
        await page.fill(campo('tef', 'observaciones'), '6');
        await page.fill(campo('tef', 'exposicion'), '4');
        await page.fill(campo('tef', 'fuente'), 'Bitácora de incidentes 2022-2025');
        await page.selectOption(campo('magnitud', 'origen'), 'benchmark-sector');

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 20000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(2000);

        // Persistida tal cual en el Registro.
        const guardado = await page.evaluate(
            async ({ API, KEY, RIESGO }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                return (await res.json()).risks.find((r) => r.riskName === RIESGO);
            },
            { API, KEY, RIESGO },
        );
        expect(guardado.factorProvenance.tef).toEqual({
            origen: 'historico-propio',
            observaciones: 6,
            exposicion: 4,
            fuente: 'Bitácora de incidentes 2022-2025',
        });
        expect(guardado.factorProvenance.magnitud.origen).toBe('benchmark-sector');
        // El factor que nadie tocó viene igual, normalizado — nunca ausente.
        expect(guardado.factorProvenance.vulnerabilidad.origen).toBe('juicio-experto');

        // Y vuelve IDÉNTICA al retomar el riesgo. Sin esto, un analista que reabre su propio
        // análisis vería la tabla en blanco y concluiría que nunca declaró nada.
        await connectAndBoot(page);
        await modoTecnico(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(2500);
        const fila = page.locator('#quick-concentrated-table-body tr', { hasText: RIESGO });
        await fila.locator('[data-analyze-fair]').click();
        await page.waitForTimeout(1200);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(400);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(400);
        await expect(page.locator(campo('tef', 'origen'))).toHaveValue('historico-propio');
        await expect(page.locator(campo('tef', 'observaciones'))).toHaveValue('6');
        await expect(page.locator(campo('tef', 'exposicion'))).toHaveValue('4');
        await expect(page.locator(campo('tef', 'fuente'))).toHaveValue('Bitácora de incidentes 2022-2025');
        await expect(page.locator(campo('magnitud', 'origen'))).toHaveValue('benchmark-sector');
    });

    test('el Dashboard cuenta por FACTOR, no por riesgo', async ({ page }) => {
        await connectAndBoot(page);
        await modoTecnico(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(3000);

        const bloque = page.locator('#dashboard-provenance');
        await expect(bloque).toBeVisible();
        // El riesgo del test anterior tiene 2 de sus 3 factores con algo observado, así que el
        // bloque tiene que hablar de factores y no de riesgos: si contara por riesgo, ese riesgo
        // sería "1 de N" en las tres filas por igual, y el desbalance —que es todo el punto—
        // desaparecería.
        await expect(bloque).toContainText('se apoya en algo observado');
        await expect(bloque).toContainText('Con qué frecuencia pasa');
        await expect(bloque).toContainText('Qué tan probable es que funcione');
        await expect(bloque).toContainText('Cuánto cuesta');

        const resumen = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                return (await res.json()).provenanceSummary;
            },
            { API, KEY },
        );
        expect(resumen.porFactor.tef.conDatos).toBeGreaterThan(0);
        expect(resumen.porFactor.tef.observaciones).toBeGreaterThanOrEqual(6);
        // La Vulnerabilidad no la respalda nada observado en ningún riesgo de esta suite — que es
        // exactamente el desbalance real del modelo hoy, y el motivo de que este bloque exista.
        expect(resumen.porFactor.vulnerabilidad.conDatos).toBe(0);

        await page.evaluate(
            async ({ API, KEY, RIESGO }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(RIESGO)}`, {
                    method: 'DELETE',
                    headers: { 'X-API-Key': KEY },
                });
            },
            { API, KEY, RIESGO },
        );
    });

    test('la procedencia llega al informe PDF — el entregable dice en qué se apoya cada cifra', async ({ page }) => {
        // El informe es lo ÚNICO que sale de la app y llega a un directorio, y presentaba un ALE al
        // dólar sin decir en qué se apoya. Los tres factores del ALE pesan igual, así que un TEF
        // que es una corazonada arrastra la respuesta entera — y eso no aparecía por ningún lado.
        await page.addInitScript(() => {
            window.print = () => {
                window.__printCalled = (window.__printCalled || 0) + 1;
            };
        });
        await connectAndBoot(page);

        // Un riesgo con procedencias MEZCLADAS: frecuencia medida, magnitud a ojo. Es el caso que
        // el informe tiene que saber contar — no el que está todo bien ni el que está todo mal.
        const riskName = 'E2E Procedencia — Informe';
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        ale: 90000,
                        cvar95: 260000,
                        evaluationLevel: 'Alto — Requiere Tratamiento',
                        severity: 'alto',
                        factorProvenance: {
                            tef: {
                                origen: 'historico-propio',
                                observaciones: 7,
                                exposicion: 3,
                                fuente: 'Bitácora de la planta 2023-2025',
                            },
                            vulnerabilidad: { origen: 'juicio-experto' },
                            magnitud: { origen: 'juicio-experto' },
                        },
                    }),
                });
            },
            { API, KEY, riskName },
        );

        // Recarga obligatoria: el riesgo se creó por API, y el informe se arma desde el Registro
        // que la app tiene EN MEMORIA. Sin esto la prueba pasaría o fallaría según qué dejaron
        // otros specs, no según lo que este acaba de crear.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1000);
        await page.click('#fair-export-consolidated-btn');
        await expect.poll(() => page.evaluate(() => window.__printCalled || 0), { timeout: 30000 }).toBeGreaterThan(0);

        const html = await page.locator('#fair-print-report').innerHTML();
        expect(html).toContain('Procedencia de los Datos');
        // El origen, el respaldo y la fuente declarada, no solo el título de la sección.
        expect(html).toContain('Histórico propio');
        expect(html).toContain('7 observaciones en 3');
        expect(html).toContain('Bitácora de la planta 2023-2025');
        // Y lo que NO está sostenido se marca, en vez de pasar como si fuera igual de sólido.
        expect(html).toContain('sin datos observados detrás');

        // La cifra consolidada: en qué se apoya el informe entero.
        expect(html).toContain('En qué se apoyan estas cifras');
        expect(html).toMatch(/de \d+ \(\d+ %\)/);
        // El encuadre que impide leer el informe como si todo pesara lo mismo.
        expect(html).toContain('la marca el más débil de los tres');
    });
});
