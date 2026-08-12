'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Tratamiento del Riesgo (página aparte)', () => {
    test('"Tratar este riesgo" en el wizard lleva a Tratamiento, y los cambios se guardan en el Registro', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Robo en Bodega');

        // El wizard ya no tiene su propio bloque de Tratamiento — solo un CTA hacia la página
        // nueva. #fair-mitigar-title vive ahora en #treatmentPage, no dentro de #fair-step-4.
        await expect(page.locator('#fair-treatment-cta')).toBeVisible();
        await expect(page.locator('#fair-step-4 #fair-mitigar-title')).toHaveCount(0);

        await page.click('#fair-treat-this-risk-btn');
        await page.waitForTimeout(500);

        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Tratamiento — Robo en Bodega');

        // Editar "Costo Anual del Control" — se guarda solo (debounced), sin botón "Guardar".
        await page.fill('#fair-costoControlAnual', '5000');
        await page.waitForTimeout(1000);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Robo en Bodega');
        expect(entry.mitigar.cost).toBe(5000);

        // Recargar la página de Tratamiento con otro riesgo y volver debe restaurar el 5000 ya
        // guardado (no un formulario en blanco) — confirma que el guardado es real, no solo local.
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Robo en Bodega');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('5000');
    });

    test('cambiar de riesgo justo después de editar (antes del debounce) no pierde la edición', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Riesgo A (carrera)');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Riesgo B (carrera)');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Riesgo A (carrera)');
        await page.waitForTimeout(300);

        // Editar el costo y, ANTES de que venza el debounce (400ms), cambiar de riesgo — sin el
        // flush en selectRisk() esta edición se perdía en silencio (ver App.Treatment).
        await page.fill('#fair-costoControlAnual', '7500');
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Riesgo B (carrera)');
        await page.waitForTimeout(500);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entryA = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Riesgo A (carrera)');
        expect(entryA.mitigar.cost).toBe(7500);
    });

    test('un riesgo tipo Oportunidad no aparece en el selector de Tratamiento ni tiene botón "Tratar" en la tabla', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.fill('#fair-riskName', 'E2E Tratamiento — Oportunidad de Mercado');
        await page.selectOption('#fair-risk-type', 'oportunidad');
        await runFullFairAnalysis(page, 'E2E Tratamiento — Oportunidad de Mercado');

        // Una Oportunidad no aplica a Tratamiento — el CTA del wizard tampoco debe aparecer.
        await expect(page.locator('#fair-treatment-cta')).toBeHidden();

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E Tratamiento — Oportunidad de Mercado',
        });
        await expect(row.locator('[data-treat-fair]')).toHaveCount(0);

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        const options = await page.locator('#treatment-risk-select option').allTextContents();
        expect(options).not.toContain('E2E Tratamiento — Oportunidad de Mercado');
    });

    test('el botón "Tratar" de la tabla de riesgos abre Tratamiento con ese riesgo elegido', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Vía Tabla');

        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E Tratamiento — Vía Tabla' });
        await row.locator('[data-treat-fair]').click();
        await page.waitForTimeout(500);

        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Tratamiento — Vía Tabla');
    });

    test('"Gestionar Controles" agrega controles nombrados, deriva Costo/Fiabilidad/Retraso, persiste y revierte a manual al vaciarse', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Controles');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Controles');
        await page.waitForTimeout(500);

        // Sin controles: los 3 campos siguen editables a mano (comportamiento manual de siempre).
        await expect(page.locator('#fair-costoControlAnual')).not.toHaveAttribute('readonly', '');
        await expect(page.locator('#treatment-controls-note')).toBeHidden();

        await page.click('#treatment-manage-controls-btn');
        await page.waitForSelector('#treatment-controls-add-btn');

        await page.click('#treatment-controls-add-btn');
        await page.fill('[data-control-row][data-index="0"] [data-field="name"]', 'Cámaras CCTV');
        await page.fill('[data-control-row][data-index="0"] [data-field="cost"]', '5000');
        await page.selectOption('[data-control-row][data-index="0"] [data-field="reliability"]', 'alta');
        await page.fill('[data-control-row][data-index="0"] [data-field="delayDays"]', '10');

        // Agregar una SEGUNDA fila no debe perder lo ya escrito en la primera.
        await page.click('#treatment-controls-add-btn');
        await page.fill('[data-control-row][data-index="1"] [data-field="name"]', 'Rondines Nocturnos');
        await page.fill('[data-control-row][data-index="1"] [data-field="cost"]', '8000');
        await page.selectOption('[data-control-row][data-index="1"] [data-field="reliability"]', 'baja');
        await page.fill('[data-control-row][data-index="1"] [data-field="delayDays"]', '30');

        await page.click('#treatment-controls-save-btn');
        await page.waitForTimeout(1000);

        // Costo = suma (5000+8000), Fiabilidad = la más débil ("baja"), Retraso = el más largo (30).
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('13000');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toHaveValue('baja');
        await expect(page.locator('#fair-mitigar-retraso')).toHaveValue('30');
        await expect(page.locator('#fair-costoControlAnual')).toHaveAttribute('readonly', '');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toBeDisabled();
        await expect(page.locator('#treatment-controls-note')).toContainText('2 controles nombrados');

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Controles');
        expect(entry.mitigar.controls).toEqual([
            { name: 'Cámaras CCTV', cost: 5000, reliability: 'alta', delayDays: 10 },
            { name: 'Rondines Nocturnos', cost: 8000, reliability: 'baja', delayDays: 30 },
        ]);
        expect(entry.mitigar.cost).toBe(13000);
        expect(entry.mitigar.reliability).toBe('baja');
        expect(entry.mitigar.delayDays).toBe(30);

        // Recargar y volver a este riesgo debe restaurar el estado derivado (no un formulario en
        // blanco ni los controles perdidos).
        await page.reload({ waitUntil: 'networkidle' });
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Controles');
        await page.waitForTimeout(500);
        await expect(page.locator('#fair-costoControlAnual')).toHaveValue('13000');
        await expect(page.locator('#fair-costoControlAnual')).toHaveAttribute('readonly', '');

        // Quitar ambos controles debe devolver los 3 campos a editables a mano.
        await page.click('#treatment-manage-controls-btn');
        await page.waitForSelector('[data-control-row][data-index="1"] [data-remove-control]');
        await page.click('[data-control-row][data-index="1"] [data-remove-control]');
        await page.click('[data-control-row][data-index="0"] [data-remove-control]');
        await page.click('#treatment-controls-save-btn');
        await page.waitForTimeout(1000);

        await expect(page.locator('#fair-costoControlAnual')).not.toHaveAttribute('readonly', '');
        await expect(page.locator('#fair-mitigar-fiabilidad')).toBeEnabled();
        await expect(page.locator('#treatment-controls-note')).toBeHidden();

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Controles');
        expect(entry.mitigar.controls).toEqual([]);
    });

    test('Transferir con deducible/cobertura ilimitada muestra "No calculable" en vez de un $0.00 falso (bug real corregido)', async ({
        page,
    }) => {
        // La página de Tratamiento (standalone) nunca manda los 10,000 escenarios crudos de la
        // simulación (el Registro solo persiste un histograma de 20 barras) — antes, capturar un
        // deducible bajo + cobertura ilimitada mostraba "Pérdida Evitada: $0.00" como si esa
        // póliza de verdad no ahorrara nada, un resultado matemáticamente imposible. Ahora debe
        // mostrar explícitamente que no se puede calcular, en vez de fingir un cálculo real.
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Seguro Ilimitado');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Seguro Ilimitado');
        await page.waitForTimeout(500);

        await page.fill('#fair-seguro-prima', '5000');
        await page.fill('#fair-seguro-deducible', '1000');
        await page.check('#fair-seguro-sin-limite');
        await page.waitForTimeout(1000);

        await expect(page.locator('#fair-seguro-residual')).toHaveText('No calculable');
        await expect(page.locator('#fair-seguro-evitada')).toHaveText('No calculable');
        await expect(page.locator('#fair-seguro-beneficio')).toHaveText('No calculable');
        await expect(page.locator('#fair-seguro-verdict')).toContainText('no se puede calcular');
        await expect(page.locator('#fair-seguro-verdict')).not.toContainText('NO conviene');

        // Sin ningún término de seguro capturado (deducible/límite/sin-límite en 0/false), la
        // Pérdida Evitada de $0.00 SÍ es una respuesta real (no se modeló ningún seguro) — no
        // debe mostrar "No calculable" en ese caso.
        await page.uncheck('#fair-seguro-sin-limite');
        await page.fill('#fair-seguro-deducible', '0');
        await page.waitForTimeout(1000);
        await expect(page.locator('#fair-seguro-evitada')).toHaveText('$0.00');
        await expect(page.locator('#fair-seguro-verdict')).toContainText('NO conviene');
    });

    test('"Adoptar esta estrategia" persiste la Decisión de Tratamiento y sobrevive a re-simular el mismo riesgo', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — Decisión');

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Decisión');
        await page.waitForTimeout(500);

        // Sin decisión: los 4 botones "Adoptar" visibles, ningún badge, sin banner.
        await expect(page.locator('#treatment-adopt-mitigar-btn')).toBeVisible();
        await expect(page.locator('#treatment-decision-summary')).toBeHidden();

        await page.fill('#fair-costoControlAnual', '2000');
        await page.waitForTimeout(600);
        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        await expect(page.locator('#treatment-adopted-mitigar-badge')).toBeVisible();
        await expect(page.locator('#treatment-adopt-mitigar-btn')).toBeHidden();
        await expect(page.locator('#treatment-decision-summary')).toBeVisible();
        await expect(page.locator('#treatment-decision-summary-text')).toContainText('Mitigar');
        // CVaR residual es válido para Mitigar (ver evaluateTreatmentStrategies) — debe verse en
        // el banner y persistirse, no solo el ALE residual. El banner solo agrega el separador
        // " / " cuando SÍ hay un segundo monto (CVaR) que mostrar (ver renderTreatmentDecision)
        // — se verifica así, en vez de la palabra "CVaR95" literal, porque en Modo Simple (el
        // default de la app) esa etiqueta se traduce a lenguaje llano.
        await expect(page.locator('#treatment-decision-summary-text')).toContainText(' / ');

        let register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        let entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Decisión');
        expect(entry.treatmentDecision.strategy).toBe('mitigar');
        expect(typeof entry.treatmentDecision.residualALE).toBe('number');
        expect(typeof entry.treatmentDecision.residualCVaR).toBe('number');
        const originalId = entry.id;

        // La tabla de Riesgos Guardados debe mostrar la señal "✔ Tratado" junto a Etapa en
        // cuanto se adopta una decisión — antes esa tabla se quedaba en 2 pisos (Inherente/
        // Actual), sin ninguna señal de que este riesgo ya tiene un 3er piso (Residual real).
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const row = page.locator('#quick-concentrated-table-body tr', { hasText: 'E2E Tratamiento — Decisión' });
        const treatedBadge = row.locator('span', { hasText: 'Tratado' });
        await expect(treatedBadge).toBeVisible();
        await expect(treatedBadge).toHaveAttribute('title', /Mitigar/);

        // Regresión del fix crítico en fair-register.js: re-simular el MISMO riesgo (vía el
        // banner de "Reanudar", igual que draft-and-resume.spec.js) no debe borrar la decisión
        // de tratamiento ya adoptada — antes de agregar treatmentDecision a la lista de campos
        // que saveToRiskRegister conserva de existingEntry, esto se perdía en silencio.
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1200);
        await page.click('#fair-resume-banner-btn');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Decisión');
        expect(entry.id).toBe(originalId);
        expect(entry.treatmentDecision).not.toBe(null);
        expect(entry.treatmentDecision.strategy).toBe('mitigar');

        // Recargar Tratamiento y volver a este riesgo debe restaurar el badge/banner.
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Decisión');
        await page.waitForTimeout(500);
        await expect(page.locator('#treatment-adopted-mitigar-badge')).toBeVisible();
        await expect(page.locator('#treatment-decision-summary')).toBeVisible();

        // "Quitar decisión" borra la decisión y vuelve a estado sin decidir.
        await page.click('#treatment-decision-clear-btn');
        await page.waitForTimeout(800);
        await expect(page.locator('#treatment-decision-summary')).toBeHidden();
        await expect(page.locator('#treatment-adopted-mitigar-badge')).toBeHidden();

        register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Decisión');
        expect(entry.treatmentDecision).toBe(null);

        // La señal "✔ Tratado" también debe desaparecer de Riesgos Guardados al quitar la decisión.
        await page.click('#nav-fair');
        await page.waitForTimeout(500);
        const rowAfterClear = page.locator('#quick-concentrated-table-body tr', {
            hasText: 'E2E Tratamiento — Decisión',
        });
        await expect(rowAfterClear.locator('span', { hasText: 'Tratado' })).toHaveCount(0);
    });

    test('CVaR residual escala igual que el ALE residual para Mitigar/Evitar/Aceptar (proporcional a la Vulnerabilidad reducida)', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Tratamiento — CVaR Residual');

        // Fuerza ALE/CVaR95 conocidos para poder verificar la fórmula exacta (el wizard con
        // perfiles default puede dar $0 si no se tocan Magnitudes de Pérdida en Paso 3).
        await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            const data = await res.json();
            const entry = data.risks.find((r) => r.riskName === 'E2E Tratamiento — CVaR Residual');
            await fetch(`http://localhost:3000/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-e2e-key' },
                body: JSON.stringify({ ...entry, ale: 100000, cvar95: 250000 }),
            });
        });
        await page.reload({ waitUntil: 'networkidle' });

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — CVaR Residual');
        await page.waitForTimeout(500);

        await page.check('#fair-reduccionALE-manual-override');
        await page.fill('#fair-reduccionALE', '60');
        await page.waitForTimeout(1000);

        // Mitigar: residualALE = 100000*(1-0.6) = 40000, residualCVaR = 250000*(1-0.6) = 100000.
        await expect(page.locator('#fair-roi-ale-despues')).toHaveText('$40,000.00');
        await expect(page.locator('#fair-roi-cvar-despues')).toHaveText('$100,000.00');
        // Aceptar: sin cambios — residual = el ALE/CVaR actual.
        await expect(page.locator('#fair-aceptar-residual-cvar')).toContainText('$250,000.00');

        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — CVaR Residual');
        expect(entry.treatmentDecision.residualALE).toBe(40000);
        expect(entry.treatmentDecision.residualCVaR).toBe(100000);
    });

    // Regresión: elegir un Nivel de Defensa Objetivo real (el camino AUTOMÁTICO, no manual)
    // llamaba a POST /api/autocalc/reduccion-ale sin mandar attackerKey — la ruta lo exige desde
    // el modelo TCap/RS y 400eaba en silencio, dejando el autocálculo roto para cualquier riesgo
    // normal. Ningún test existente lo detectaba porque todos usan
    // #fair-reduccionALE-manual-override en vez de este <select> — este test cierra ese hueco.
    test('elegir un Nivel de Defensa Objetivo real (no manual) calcula la Reducción de ALE sin error, y el residual persiste al adoptar Mitigar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // No usa runFullFairAnalysis (deja Magnitud de Pérdida en $0 por defecto) — hace falta un
        // ALE > 0 para poder afirmar que el residual baja respecto al actual.
        await page.fill('#fair-riskName', 'E2E Tratamiento — Reducción ALE automática');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.fill('#lm-respuesta-mode', '50000');
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        await page.selectOption('#treatment-risk-select', 'E2E Tratamiento — Reducción ALE automática');
        await page.waitForTimeout(800);

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/autocalc/reduccion-ale'), { timeout: 15000 }),
            page.selectOption('#fair-mitigar-defensa-objetivo', 'elite'),
        ]);
        await page.waitForTimeout(1000);

        const explanation = await page.locator('#fair-reduccionALE-explanation').textContent();
        expect(explanation).not.toContain('No se pudo calcular');
        expect(explanation).toContain('Calculado como');

        await page.fill('#fair-costoControlAnual', '15000');
        await page.waitForTimeout(600);

        await page.click('#treatment-adopt-mitigar-btn');
        await page.waitForTimeout(800);

        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const entry = register.risks.find((r) => r.riskName === 'E2E Tratamiento — Reducción ALE automática');
        expect(typeof entry.treatmentDecision.residualALE).toBe('number');
        expect(entry.treatmentDecision.residualALE).toBeLessThan(entry.ale);
    });
});
