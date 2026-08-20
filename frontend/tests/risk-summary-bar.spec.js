'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

// La barra persistente de riesgo (App.RiskSummaryBar, ver #risk-summary-bar en app_fair.html)
// vive fuera de #fair-wizard-wrapper, entre el header y el contenido de cada página. Sin datos
// que mostrar quedaría oculta por completo (sin mostrar 3 mosaicos vacíos) — pero eso NO se
// verifica aquí con connectAndBoot recién hecho: toda la suite E2E comparte un único backend
// (ver playwright.config.js), así que para cuando este spec corre el Registro casi siempre ya
// tiene riesgos de OTROS archivos de test y la barra ya está visible desde antes. Lo que sí es
// determinista, sin importar el orden de la suite: que el tile "en curso" nace oculto para UN
// riesgo nuevo específico y aparece justo después de simularlo.
test.describe('Barra persistente de riesgo (Actual/Residual del portafolio + riesgo en curso)', () => {
    test('aparece con la primera simulación, refleja el portafolio y navega al hacer clic', async ({ page }) => {
        await connectAndBoot(page);

        const riskName = 'E2E Barra — Robo en Bodega';
        await page.fill('#fair-riskName', riskName);
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);

        // Antes de simular, la app está en el Paso 4 pero todavía no hay un riesgo "en curso"
        // con evaluación — el tile permanece oculto hasta que la simulación resuelva.
        await expect(page.locator('#risk-summary-current')).toBeHidden();

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1000);

        await expect(page.locator('#risk-summary-bar')).toBeVisible();
        await expect(page.locator('#risk-summary-current')).toBeVisible();
        await expect(page.locator('#risk-summary-current-detail')).toHaveText(riskName);
        await expect(page.locator('#risk-summary-current-value')).toContainText('$');
        // El portafolio ya incluye este riesgo recién guardado — ninguno de los 2 mosaicos
        // del portafolio debe quedarse en el placeholder "—".
        await expect(page.locator('#risk-summary-actual-value')).toContainText('$');
        await expect(page.locator('#risk-summary-residual-value')).toContainText('$');

        // Clic en "Estás analizando ahora" navega directo al Paso 4 del wizard, desde otra página.
        await page.click('#nav-dashboard');
        await page.waitForTimeout(300);
        await page.click('#risk-summary-current');
        await page.waitForTimeout(300);
        await expect(page.locator('#fairAnalysisPage')).not.toHaveClass(/hidden/);
        await expect(page.locator('#fair-step-4')).not.toHaveClass(/hidden/);

        // Clic en el mosaico Residual navega a Gestión de Riesgos.
        await page.click('#risk-summary-residual');
        await page.waitForTimeout(300);
        await expect(page.locator('#riskMgmtPage')).not.toHaveClass(/hidden/);

        // "Borrar todo" (reset del wizard) oculta el tile "en curso" — ya no hay análisis
        // activo — pero los mosaicos del portafolio siguen mostrando el riesgo ya guardado.
        await page.click('#nav-fair');
        await page.waitForTimeout(300);
        await page.click('#fair-reset-btn');
        await page.waitForTimeout(300);
        await page.click('#modal-confirm-btn');
        await page.waitForTimeout(500);
        await expect(page.locator('#risk-summary-current')).toBeHidden();
        await expect(page.locator('#risk-summary-bar')).toBeVisible();
    });

    test('el promedio y la cola son mosaicos SEPARADOS: cada color describe su propia cifra', async ({ page }) => {
        // Lo que esto corrige: un promedio residual DENTRO del apetito se pintaba de rojo por una
        // cola que no estaba en pantalla. Peor, ese rojo era ambiguo — no se distinguía de "tu
        // promedio se pasó", que pide reducir frecuencia en vez de contener el daño.
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Barra — Promedio y cola separados');
        await page.click('#nav-dashboard');
        await page.waitForTimeout(800);

        const backend = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return (await res.json()).residualPortfolio;
        });
        expect(typeof backend.tailAmount).toBe('number');
        expect(backend.tailSeverity).toBeTruthy();

        // El mosaico nuevo existe y muestra la cola.
        await expect(page.locator('#risk-summary-tail')).toBeVisible();
        const clases = { critico: 'bg-red-50', alto: 'bg-orange-50', medio: 'bg-yellow-50', bajo: 'bg-green-50' };
        await expect(page.locator('#risk-summary-tail')).toHaveClass(new RegExp(clases[backend.tailSeverity]));

        // Y el del promedio se colorea por SU cifra, no por la del riesgo entero.
        const claseEsperadaPromedio = await page.evaluate(async (totalALE) => {
            const res = await fetch('http://localhost:3000/api/config/criteria', {
                headers: { 'X-API-Key': 'test-e2e-key' },
            });
            const c = await res.json();
            const aceptable = c.aleCritico * (c.aleAceptablePercent / 100);
            const medio = aceptable + (c.aleCritico - aceptable) / 2;
            if (totalALE > c.aleCritico) return 'bg-red-50';
            if (totalALE > medio) return 'bg-orange-50';
            if (totalALE > aceptable) return 'bg-yellow-50';
            return 'bg-green-50';
        }, backend.totalResidualALE);
        await expect(page.locator('#risk-summary-residual')).toHaveClass(new RegExp(claseEsperadaPromedio));

        // El aviso: cuando la cola es PEOR que el promedio, el mosaico del promedio lo dice. Un
        // verde no puede ser un "todo bien" silencioso — la cola es lo que quiebra empresas.
        const orden = { bajo: 0, medio: 1, alto: 2, critico: 3 };
        const severidadDelPromedio = {
            'bg-green-50': 'bajo',
            'bg-yellow-50': 'medio',
            'bg-orange-50': 'alto',
            'bg-red-50': 'critico',
        }[claseEsperadaPromedio];
        const aviso = page.locator('#risk-summary-residual-tail-warning');
        if (orden[backend.tailSeverity] > orden[severidadDelPromedio]) {
            await expect(aviso).toBeVisible();
            await expect(aviso).toContainText('Año Malo');
        } else {
            await expect(aviso).toBeHidden();
        }
    });

    test('el color del tile "Riesgo Actual" viene del backend, no de un clasificador propio ciego a la cola', async ({
        page,
    }) => {
        // Bug real: las tres tarjetas de la barra usaban DOS escalas distintas. Residual y "en
        // curso" toman la evaluación del backend, que mira promedio Y cola; "Riesgo Actual" la
        // fabricaba con classifyAleAgainstCriteria, que solo mira el promedio. Dos tarjetas
        // pegadas podían contradecirse sobre el mismo portafolio.
        //
        // La aserción es de COHERENCIA, no de un color fijo: el Registro es compartido por toda la
        // suite, así que la severidad concreta depende de qué otros specs corrieron antes — pero
        // el tile y el backend tienen que decir lo mismo pase lo que pase.
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Barra — Coherencia de color');
        await page.click('#nav-dashboard');
        await page.waitForTimeout(800);

        const backend = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            return data.inherentPortfolio;
        });
        expect(backend.actualEvaluation).toBeTruthy();
        // El piso de cola cubre siempre las mismas amenazas que el promedio (ver residualPair).
        expect(backend.totalActualCVaRFloor).toBeGreaterThanOrEqual(backend.totalActualALE);

        const clases = {
            critico: 'bg-red-50',
            alto: 'bg-orange-50',
            medio: 'bg-yellow-50',
            bajo: 'bg-green-50',
        }[backend.actualEvaluation.severity];
        await expect(page.locator('#risk-summary-actual')).toHaveClass(new RegExp(clases));
    });
});
