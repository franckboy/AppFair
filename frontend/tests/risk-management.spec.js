'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Gestión de Riesgos (página aparte)', () => {
    test('"Gestionar este riesgo" en el wizard lleva a Gestión de Riesgos, y los cambios se guardan en el Registro', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Robo en Bodega');

        // El wizard ya no tiene su propio bloque de Gobernanza/Plan de Seguridad — solo un CTA
        // hacia la página nueva. #fair-owner vive ahora en #riskMgmtPage, no dentro de #fair-step-4.
        await expect(page.locator('#fair-riskmgmt-cta')).toBeVisible();
        await expect(page.locator('#fair-step-4 #fair-owner')).toHaveCount(0);

        await page.click('#fair-manage-this-risk-btn');
        await page.waitForTimeout(500);

        await expect(page.locator('#riskMgmtPage')).toBeVisible();
        await expect(page.locator('#riskmgmt-risk-select')).toHaveValue('E2E Gestión — Robo en Bodega');

        // Editar "Dueño del Riesgo" — se guarda solo (debounced), sin botón "Guardar".
        await page.fill('#fair-owner', 'Gerente de Seguridad Patrimonial');
        await page.waitForTimeout(1000);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Gestión — Robo en Bodega');
        expect(entry.owner).toBe('Gerente de Seguridad Patrimonial');

        // Recargar la página de Gestión de Riesgos con otro riesgo y volver debe restaurar el
        // valor ya guardado (no un formulario en blanco) — confirma que el guardado es real.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(1000);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Robo en Bodega');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-owner')).toHaveValue('Gerente de Seguridad Patrimonial');
    });

    test('cambiar de riesgo justo después de editar (antes del debounce) no pierde la edición', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Riesgo A (carrera)');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Riesgo B (carrera)');

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Riesgo A (carrera)');
        await page.waitForTimeout(300);

        // Editar el dueño y, ANTES de que venza el debounce (500ms), cambiar de riesgo — sin el
        // flush en selectRisk() esta edición se perdía en silencio (ver App.RiskManagement).
        await page.fill('#fair-owner', 'Gerente de Riesgo A');
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Riesgo B (carrera)');
        await page.waitForTimeout(500);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entryA = register.risks.find((r) => r.riskName === 'E2E Gestión — Riesgo A (carrera)');
        expect(entryA.owner).toBe('Gerente de Riesgo A');
    });

    test('un riesgo tipo Oportunidad sí aparece en el selector de Gestión de Riesgos (a diferencia de Tratamiento)', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E Gestión — Oportunidad de Mercado');
        await page.selectOption('#fair-risk-type', 'oportunidad');
        await runFullFairAnalysis(page, 'E2E Gestión — Oportunidad de Mercado');

        // El CTA de Gestión de Riesgos sí aparece para una Oportunidad (a diferencia del de
        // Tratamiento, que se oculta).
        await expect(page.locator('#fair-riskmgmt-cta')).toBeVisible();
        await expect(page.locator('#fair-treatment-cta')).toBeHidden();

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        const options = await page.locator('#riskmgmt-risk-select option').allTextContents();
        expect(options).toContain('E2E Gestión — Oportunidad de Mercado');

        // Una Oportunidad no tiene Tratamiento (su "ale" es un beneficio, no una pérdida) — la
        // sección de Riesgo Residual (paso 2 del rediseño de Tratamiento) no debe aparecer.
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Oportunidad de Mercado');
        await page.waitForTimeout(300);
        await expect(page.locator('#riskmgmt-residual-section')).toBeHidden();
    });

    test('la sección de Riesgo Residual pasa del inherente al residual reclasificado al adoptar una estrategia en Tratamiento', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Gestión — Residual');

        // riskCriteriaOverride PROPIO del riesgo (no el global, que es estado compartido entre
        // specs sin aislamiento) — hace la reclasificación determinista sin importar qué haya
        // guardado otro test: aleAceptable = 1000*0.2 = 200.
        await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const entry = data.risks.find((r) => r.riskName === 'E2E Gestión — Residual');
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({
                    ...entry,
                    ale: 2000,
                    cvar95: 2000,
                    riskCriteriaOverride: { aleAceptablePercent: 20, aleCritico: 1000 },
                }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Residual');
        await page.waitForTimeout(500);

        // Sin decisión: el residual mostrado es igual al actual, con botón para ir a decidir.
        await expect(page.locator('#riskmgmt-residual-section')).toBeVisible();
        await expect(page.locator('#riskmgmt-residual-note')).toContainText('igual al actual');
        await expect(page.locator('#riskmgmt-residual-ale')).toHaveText('$2,000');
        await expect(page.locator('#riskmgmt-goto-treatment-btn')).toBeVisible();

        await page.click('#riskmgmt-goto-treatment-btn');
        await page.waitForTimeout(500);
        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Gestión — Residual');

        // ale=2000 > aleCritico(1000) del override → inherente Crítico. Mitigar al 95% deja
        // residual = 100, bien por debajo de aleAceptable(200) → debe reclasificar a Aceptable.
        await page.check('#fair-reduccionALE-manual-override');
        await page.fill('#fair-reduccionALE', '95');
        await page.waitForTimeout(1000);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(500);
        await page.selectOption('#riskmgmt-risk-select', 'E2E Gestión — Residual');
        await page.waitForTimeout(1500);

        await expect(page.locator('#riskmgmt-residual-note')).toContainText('Con tratamiento (Mitigar)');
        await expect(page.locator('#riskmgmt-residual-ale')).toHaveText('$100');
        await expect(page.locator('#riskmgmt-residual-cvar')).toHaveText('$100');
        await expect(page.locator('#riskmgmt-residual-badge')).toHaveText('Aceptable');
        await expect(page.locator('#riskmgmt-goto-treatment-btn')).toBeHidden();

        // La fecha de revisión sugerida se actualiza a la cadencia de "Aceptable" (12 meses) —
        // este riesgo nunca tuvo un reviewDate guardado, así que no hay regresión posible.
        const reviewDate = new Date(await page.locator('#fair-review-date').inputValue());
        const now = new Date();
        const monthsAhead =
            (reviewDate.getFullYear() - now.getFullYear()) * 12 + (reviewDate.getMonth() - now.getMonth());
        expect(monthsAhead).toBeGreaterThanOrEqual(11);
        expect(monthsAhead).toBeLessThanOrEqual(12);
    });

    test('el Riesgo Residual del Portafolio agrega el residual de un riesgo tratado con el inherente de uno sin tratar', async ({
        page,
    }) => {
        // El Registro es compartido por TODA la suite E2E, sin aislamiento (ver playwright.config.js)
        // — para cuando este test corre, ya puede haber otros riesgos guardados por specs
        // anteriores. Se toma el total ANTES de agregar los 2 propios y se verifica el DELTA que
        // deberían aportar, en vez de asumir que el total absoluto es solo el de este test.
        const before = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return (await res.json()).residualPortfolio;
        });
        const beforeALE = before ? before.totalResidualALE : 0;
        const beforeCVaR = before ? before.totalResidualCVaR || 0 : 0;
        const beforeTreated = before ? before.treatedCount : 0;
        const beforeTotal = before ? before.totalRiskCount : 0;

        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Portafolio — Riesgo Tratado');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Portafolio — Riesgo Sin Tratar');

        // ale/cvar95 deterministas en ambos (mismo patrón que el test de residual de arriba).
        await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const entry1 = data.risks.find((r) => r.riskName === 'E2E Portafolio — Riesgo Tratado');
            const entry2 = data.risks.find((r) => r.riskName === 'E2E Portafolio — Riesgo Sin Tratar');
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(entry1.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({ ...entry1, ale: 100000, cvar95: 200000 }),
            });
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(entry2.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({ ...entry2, ale: 50000, cvar95: 90000 }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });

        // Adoptar Mitigar en el primero (95% via override manual) — deja residualALE=5000,
        // residualCVaR=10000. El segundo se queda sin decisión (residual = inherente).
        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Portafolio — Riesgo Tratado');
        await page.waitForTimeout(500);
        await page.check('#fair-reduccionALE-manual-override');
        await page.fill('#fair-reduccionALE', '95');
        await page.waitForTimeout(1000);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        // ALE: 5000 (residual del tratado) + 50000 (inherente del sin tratar) = 55000 de aporte.
        // CVaR95: 10000 (residual) + 90000 (inherente) = 100000 de aporte — cota conservadora.
        const expectedALE = beforeALE + 55000;
        const expectedCVaR = beforeCVaR + 100000;
        const formatCurrency = (value) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value);

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(1000);

        await expect(page.locator('#riskmgmt-portfolio-section')).toBeVisible();
        await expect(page.locator('#riskmgmt-portfolio-ale')).toHaveText(formatCurrency(expectedALE));
        await expect(page.locator('#riskmgmt-portfolio-cvar')).toHaveText(formatCurrency(expectedCVaR));
        await expect(page.locator('#riskmgmt-portfolio-detail')).toContainText(
            `${beforeTreated + 1} de ${beforeTotal + 2} amenazas con tratamiento adoptado`,
        );
    });

    test('la Concentración del Riesgo Residual (Pareto) rankea un riesgo grande pero ya mitigado DEBAJO de uno mediano sin tratar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Pareto Residual — Grande Mitigado');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Pareto Residual — Mediano Sin Tratar');

        // ale/cvar95 deterministas — el "grande" (900,000) vale casi 10x el "mediano" (100,000)
        // en términos INHERENTES, así que el Pareto de Registro de Riesgos lo pondría primero.
        await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const big = data.risks.find((r) => r.riskName === 'E2E Pareto Residual — Grande Mitigado');
            const medium = data.risks.find((r) => r.riskName === 'E2E Pareto Residual — Mediano Sin Tratar');
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(big.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({ ...big, ale: 900000, cvar95: 1500000 }),
            });
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(medium.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({ ...medium, ale: 100000, cvar95: 180000 }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });

        // Adoptar Mitigar en el "grande" (95% via override manual) — deja residualALE=45000,
        // muy por debajo del residual del "mediano" (100,000, sin tratar) — el Pareto RESIDUAL
        // debe invertir el orden que tendría el Pareto INHERENTE.
        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Pareto Residual — Grande Mitigado');
        await page.waitForTimeout(500);
        await page.check('#fair-reduccionALE-manual-override');
        await page.waitForTimeout(200);
        await page.fill('#fair-reduccionALE', '95');
        await page.waitForTimeout(1000);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        // El Registro es compartido por toda la suite (ver el test de arriba) — comparar por
        // ÍNDICE relativo entre estas dos entradas dentro de residualPareto.risks, no por
        // posición absoluta, es válido sin importar cuántos otros riesgos ya existan.
        const residualPareto = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return (await res.json()).residualPareto;
        });
        const idxBig = residualPareto.risks.findIndex((r) => r.riskName === 'E2E Pareto Residual — Grande Mitigado');
        const idxMedium = residualPareto.risks.findIndex(
            (r) => r.riskName === 'E2E Pareto Residual — Mediano Sin Tratar',
        );
        expect(idxBig).toBeGreaterThanOrEqual(0);
        expect(idxMedium).toBeGreaterThanOrEqual(0);
        expect(residualPareto.risks[idxBig].residualALE).toBeCloseTo(45000, 0);
        expect(residualPareto.risks[idxBig].treated).toBe(true);
        expect(residualPareto.risks[idxMedium].residualALE).toBe(100000);
        expect(residualPareto.risks[idxMedium].treated).toBe(false);
        expect(idxMedium).toBeLessThan(idxBig);

        // El resumen del panel de Gestión de Riesgos se deriva 1:1 de residualPareto, ya
        // recalculado — se compara contra ese mismo dato en vez de un número fijo.
        const expectedSummary = `${residualPareto.riskCountFor80Percent} de ${residualPareto.totalRiskCount} riesgo(s) concentran el 80% de tu exposición residual (${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(residualPareto.totalExposure)}/año).`;

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(1000);

        await expect(page.locator('#riskmgmt-residual-pareto-section')).toBeVisible();
        await expect(page.locator('#riskmgmt-residual-pareto-summary')).toHaveText(expectedSummary);
    });

    test('el Riesgo Inherente real (sin controles) se calcula, persiste, y arma el waterfall Inherente → Actual → Residual en Gestión de Riesgos', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // runFullFairAnalysis no llena Magnitud de Pérdida (queda en 0) — se arma el flujo a mano
        // acá para tener un ALE > 0 real y así poder comparar inherentALE contra él.
        await page.fill('#fair-riskName', 'E2E Riesgo Inherente — Waterfall');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.fill('#lm-respuesta-mode', '50000');
        await page.waitForTimeout(300);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        // Las métricas viven en el modal de detalle del riesgo: la línea de Riesgo Inherente debe
        // verse ahí, con un monto mayor al ALE actual.
        await page.click('#fair-goto-dashboard-btn');
        await page.waitForTimeout(600);
        await expect(page.locator('#fair-inherente-line')).toBeVisible();
        await page.click('#risk-card-close-btn'); // el detalle vive dentro de la ficha del riesgo
        await page.waitForTimeout(400);

        const entry = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            return data.risks.find((r) => r.riskName === 'E2E Riesgo Inherente — Waterfall');
        });
        expect(typeof entry.inherentALE).toBe('number');
        expect(typeof entry.inherentCVaR).toBe('number');
        // Sin ningún control es, por construcción, el peor caso posible — nunca puede dar un ALE
        // menor que con la defensa "básica" que sí se eligió.
        expect(entry.inherentALE).toBeGreaterThanOrEqual(entry.ale);
        expect(entry.inherentCVaR).toBeGreaterThanOrEqual(entry.inherentALE);

        // El waterfall del panel es un AGREGADO de TODO el Registro (compartido por la suite, sin
        // aislamiento) — se compara contra inherentPortfolio.totalInherentALE (el mismo total que
        // ya incluye esta entrada), no contra el inherentALE de un solo riesgo.
        const inherentPortfolio = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return (await res.json()).inherentPortfolio;
        });

        await page.click('#nav-risk-mgmt');
        await page.waitForTimeout(1000);

        await expect(page.locator('#riskmgmt-portfolio-waterfall')).toBeVisible();
        const formatCurrency = (value) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value);
        await expect(page.locator('#riskmgmt-portfolio-waterfall')).toContainText(
            `Riesgo Inherente: ${formatCurrency(inherentPortfolio.totalInherentALE)}`,
        );
        await expect(page.locator('#riskmgmt-portfolio-effectiveness')).toBeVisible();

        // El Actual que el waterfall compara contra el Inherente debe ser comparableActualALE
        // (solo los riesgos que además tienen Inherente calculado), NUNCA totalActualALE (todas
        // las amenazas) — restar dos canastas distintas daba Efectividades de Controles negativas
        // y un Riesgo Inherente menor que el Actual. Ver la regresión con números controlados en
        // backend/test/lib.test.js ("la Efectividad de Controles usa la MISMA canasta").
        //
        // Acá se verifica el CABLEADO (que el panel pinte el total correcto), no la aritmética:
        // el Registro es compartido por toda la suite y varios tests escriben `ale` por PUT
        // directo sin recalcular `inherentALE` (ej. `{...entry, ale: 900000}` más arriba en este
        // mismo archivo), así que la relación inherente ≥ actual no se sostiene sobre ESOS datos
        // sintéticos. Sobre datos reales de la app sí se sostiene siempre — los dos campos
        // siempre se escriben juntos, desde la misma simulación (ver saveToRiskRegister) — y eso
        // es justo lo que verifica la aserción por riesgo unas líneas más arriba.
        await expect(page.locator('#riskmgmt-portfolio-waterfall')).toContainText(
            `Riesgo Actual: ${formatCurrency(inherentPortfolio.comparableActualALE)}`,
        );
    });
});

// El CVaR95 del portafolio que se muestra arriba es la SUMA de los individuales: una cota
// conservadora que sobrestima la cola porque supone que todos los riesgos ocurren el mismo año.
// Esta línea trae el valor REAL, simulando el portafolio completo a la vez.
test('el portafolio muestra el CVaR95 simulado en conjunto, menor que la suma de los individuales', async ({
    page,
}) => {
    await connectAndBoot(page);

    // Se siembran por API en vez de con runFullFairAnalysis: ese helper no captura Magnitud de
    // Pérdida, así que sus riesgos valen $0 y el portafolio no tendría cola que comparar.
    const mc = await page.evaluate(async () => {
        const headers = { 'X-API-Key': 'test-e2e-key', 'Content-Type': 'application/json' };
        const base = {
            riskType: 'amenaza',
            vulnManualOverride: true,
            tef: { min: 1, mode: 2, max: 4 },
            vuln: { min: 20, mode: 40, max: 60 },
            lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
            ale: 20000,
            cvar95: 50000,
        };
        for (const riskName of ['E2E MC Portafolio A', 'E2E MC Portafolio B', 'E2E MC Portafolio C']) {
            await fetch('http://localhost:3000/api/register/' + encodeURIComponent(riskName), {
                method: 'PUT',
                headers,
                body: JSON.stringify(base),
            });
        }
        const res = await fetch('http://localhost:3000/api/register/portfolio-simulation', {
            headers: { 'X-API-Key': 'test-e2e-key' },
        });
        return res.json();
    });

    expect(mc.includedCount).toBeGreaterThanOrEqual(3);
    expect(mc.summary.cvar95).toBeGreaterThan(0);
    // La comprobación que da sentido a todo: la cola conjunta no es la suma de las colas.
    expect(mc.summary.cvar95).toBeLessThan(mc.sumOfIndividualCVaR);
    expect(mc.diversificationBenefit).toBeGreaterThan(0);

    // connectAndBoot en vez de page.reload: recargar deja la pantalla de conexión y la navegación
    // inhabilitada. Hace falta volver a arrancar para que el Registro traiga los riesgos sembrados.
    await connectAndBoot(page);
    // El Monte Carlo del portafolio se mudó a su propio bloque del Dashboard: en Gestión de
    // Riesgos era un <p> de una línea, sin espacio para separar el beneficio de diversificación
    // de la penalización por correlación, que van en direcciones opuestas.
    await page.click('#nav-dashboard');
    await page.waitForTimeout(3000);
    const bloque = page.locator('#dashboard-portfolio-mc');
    await expect(bloque).toBeVisible();
    // Ni el número de amenazas ni las etiquetas: el número depende de cuántos riesgos dejaron
    // otros archivos en el backend compartido, y las etiquetas cambian entre Modo Simple y
    // Técnico. Lo invariante es que el bloque diga que simuló el portafolio junto, y con cifras.
    await expect(bloque).toContainText(/Simulando \d+ amenazas? a la vez/);
    await expect(bloque).toContainText(/\$[\d,]+/);
});
