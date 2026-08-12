'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Árbol de Riesgos en Cascada', () => {
    test('un riesgo con "Riesgo Desencadenante" aparece anidado bajo su padre, y la rama se puede colapsar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Árbol — Riesgo Padre');

        // Riesgo hijo: página fresca (evita el modal de confirmación de "Nuevo Análisis") y
        // esta vez sí se agrega "E2E Árbol — Riesgo Padre" como causa en el Paso 1 antes de
        // avanzar (fila multi-causa, ver App.FairWizard.renderTriggeredByRows).
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');
        await page.fill('#fair-riskName', 'E2E Árbol — Riesgo Hijo');
        await page.click('#fair-triggered-by-add-btn');
        await page.selectOption(
            '#fair-triggered-by-body [data-trigger-row] [data-field="riskName"]',
            'E2E Árbol — Riesgo Padre',
        );
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);
        await page.selectOption('#fair-attacker-profile', 'organizado');
        await page.selectOption('#fair-defense-profile', 'basica');
        await page.waitForTimeout(800);
        await page.click('#fair-step2-next');
        await page.waitForTimeout(500);
        await page.click('#fair-step3-next');
        await page.waitForTimeout(500);
        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/simulate'), { timeout: 15000 }),
            page.click('#run-simulation-btn'),
        ]);
        await page.waitForTimeout(1500);

        // El vínculo real se verifica contra el backend (no existe window.App expuesto
        // globalmente, mismo patrón que el resto de la suite E2E).
        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const childEntry = register.risks.find((r) => r.riskName === 'E2E Árbol — Riesgo Hijo');
        expect(childEntry.triggeredBy).toEqual([{ riskName: 'E2E Árbol — Riesgo Padre', probability: null }]);

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        const parentCard = page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Padre' });
        await expect(parentCard).toBeVisible();
        const childCard = page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Hijo' });
        await expect(childCard).toBeVisible();

        // Colapsar la rama del padre oculta al hijo sin quitarlo del DOM — el botón vive en la
        // misma tarjeta del padre, sin necesidad de buscar un <li> envolvente.
        await parentCard.locator('[data-tree-toggle]').first().click();
        await page.waitForTimeout(200);
        await expect(childCard).toBeHidden();
    });

    test('clic en una tarjeta abre su detalle, y "Tratar" lo carga en la página de Tratamiento', async ({ page }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Árbol — Detalle');

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        await page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Detalle' }).click();
        await expect(page.locator('#modalTitle')).toHaveText('E2E Árbol — Detalle');
        await expect(page.locator('#modalBody')).toContainText('Pérdida Anual Esperada');

        await page.click('#risktree-detail-tratar-btn');
        await page.waitForTimeout(500);

        // Tratamiento (Mitigar/Transferir/Evitar/Aceptar) vive en su propia página — "Tratar"
        // aterriza ahí con este riesgo ya elegido, sin pasar por el wizard.
        await expect(page.locator('#treatmentPage')).toBeVisible();
        await expect(page.locator('#treatment-risk-select')).toHaveValue('E2E Árbol — Detalle');
    });

    test('Simular Familia: un hijo creado con "+" conserva su causa (triggeredBy) al completar su FAIR, y la simulación combinada incluye a ambos', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Familia — Padre');

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        const parentCard = page.locator('.risk-tree-card', { hasText: 'E2E Familia — Padre' });
        await parentCard.locator('[data-tree-add-child]').click();
        await page.waitForSelector('#tree-child-name');
        await page.fill('#tree-child-name', 'E2E Familia — Hijo');
        await page.fill('#tree-child-probability', '90');
        await page.click('#tree-create-child-save-btn');
        await page.waitForTimeout(300);

        // El hijo nace "Sin analizar" — se completa su FAIR desde su propia tarjeta.
        await page.locator('.risk-tree-card', { hasText: 'E2E Familia — Hijo' }).click();
        await page.waitForSelector('#risktree-detail-continue-btn');
        await page.click('#risktree-detail-continue-btn');
        await page.waitForSelector('#fair-riskName');

        // Regresión: antes de la tarea de multi-causa, saveToRiskRegister() nunca reenviaba la
        // probabilidad del vínculo — completar el FAIR de un hijo creado con "+" la borraba en
        // silencio justo cuando runFamilyCascadeSimulation empieza a necesitarla. Ahora la fila
        // de "Riesgos Desencadenantes" del Paso 1 la trae precargada desde el Registro (ver
        // loadRegisteredRiskIntoForm) y la reenvía tal cual.
        const [putRes] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/register/') && r.request().method() === 'PUT', {
                timeout: 15000,
            }),
            runFullFairAnalysis(page, 'E2E Familia — Hijo'),
        ]);
        const putBody = await putRes.json();
        expect(putBody.entry.triggeredBy).toEqual([{ riskName: 'E2E Familia — Padre', probability: 90 }]);

        await page.click('#nav-risk-tree');
        await page.waitForTimeout(300);
        await page.locator('.risk-tree-card', { hasText: 'E2E Familia — Padre' }).click();
        await page.waitForSelector('#risktree-detail-simulate-family-btn');

        await Promise.all([
            page.waitForResponse((r) => r.url().includes('/simulate-family'), { timeout: 15000 }),
            page.click('#risktree-detail-simulate-family-btn'),
        ]);
        await expect(page.locator('#risk-tree-family-sim-body')).toBeVisible({ timeout: 15000 });

        const membersText = await page.locator('#risk-tree-family-sim-members').textContent();
        expect(membersText).toContain('E2E Familia — Padre');
        expect(membersText).toContain('E2E Familia — Hijo');
        await expect(page.locator('#risk-tree-family-sim-ale')).not.toHaveText('');
    });

    test('Simular Familia: una respuesta de red vieja de OTRO riesgo que llega TARDE no pisa el resultado del riesgo recién pedido (condición de carrera)', async ({
        page,
    }) => {
        // Regresión: si el usuario pide "Simular Familia" para un riesgo, y ANTES de que llegue
        // la respuesta abre el detalle de OTRO riesgo y también pide "Simular Familia", no hay
        // garantía de que las respuestas HTTP lleguen en el orden en que se pidieron — mismo
        // patrón que autocalc-race-condition.spec.js, aplicado a simulateFamily
        // (risk-cascade-tree.js).
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Familia — Carrera A');
        await connectAndBoot(page); // página fresca, evita el modal de "Nuevo Análisis"
        await runFullFairAnalysis(page, 'E2E Familia — Carrera B');

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        // La petición de "Carrera A" se demora artificialmente 1.5s — tiempo de sobra para que la
        // de "Carrera B" (pedida después, sin demora) responda primero.
        await page.route('**/simulate-family', async (route) => {
            if (route.request().url().includes(encodeURIComponent('E2E Familia — Carrera A'))) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            await route.continue();
        });

        await page.locator('.risk-tree-card', { hasText: 'E2E Familia — Carrera A' }).click();
        await page.waitForSelector('#risktree-detail-simulate-family-btn');
        await page.click('#risktree-detail-simulate-family-btn'); // dispara la petición demorada de A, sin esperar
        await page.waitForTimeout(50); // la petición de A ya salió (y quedó demorada)

        await page.locator('.risk-tree-card', { hasText: 'E2E Familia — Carrera B' }).click();
        await page.waitForSelector('#risktree-detail-simulate-family-btn');
        await Promise.all([
            page.waitForResponse(
                (r) =>
                    r.url().includes('/simulate-family') &&
                    r.url().includes(encodeURIComponent('E2E Familia — Carrera B')),
                { timeout: 15000 },
            ),
            page.click('#risktree-detail-simulate-family-btn'),
        ]);
        await expect(page.locator('#risk-tree-family-sim-body')).toBeVisible({ timeout: 15000 });

        // Espera a que la respuesta demorada de A también haya tenido tiempo de llegar — sin el
        // guardián, pisaría en silencio los datos de B que ya se mostraron correctamente.
        await page.waitForTimeout(2000);

        const membersText = await page.locator('#risk-tree-family-sim-members').textContent();
        expect(membersText).toContain('E2E Familia — Carrera B');
        expect(membersText).not.toContain('E2E Familia — Carrera A');
    });

    test('"Cambiar quién causó este riesgo" vincula un huérfano existente sin pasar por el wizard, y excluye a sus propios descendientes para evitar un ciclo', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Vínculo — Abuelo');
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Vínculo — Nieto Huérfano');

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        // "Nieto Huérfano" nace como raíz (sin ninguna causa) — se vincula retroactivamente
        // como hijo de "Abuelo", sin volver a pasar por el wizard de FAIR. El modal multi-causa
        // arranca sin filas cuando el riesgo no tiene ninguna causa todavía — hay que agregar
        // una antes de poder elegir.
        const orphanCard = page.locator('.risk-tree-card', { hasText: 'E2E Vínculo — Nieto Huérfano' });
        await orphanCard.locator('[data-tree-change-trigger]').click();
        await page.waitForSelector('#tree-change-trigger-add-btn');
        await page.click('#tree-change-trigger-add-btn');
        await page.waitForSelector('#tree-change-trigger-body [data-cause-row]');

        const options = await page
            .locator('#tree-change-trigger-body [data-cause-row] [data-field="riskName"] option')
            .allTextContents();
        expect(options).toContain('E2E Vínculo — Abuelo');

        await page.selectOption(
            '#tree-change-trigger-body [data-cause-row] [data-field="riskName"]',
            'E2E Vínculo — Abuelo',
        );
        await page.fill('#tree-change-trigger-body [data-cause-row] [data-field="probability"]', '70');
        const [putRes] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/register/') && r.request().method() === 'PUT', {
                timeout: 10000,
            }),
            page.click('#tree-change-trigger-save-btn'),
        ]);
        const putBody = await putRes.json();
        expect(putBody.entry.triggeredBy).toEqual([{ riskName: 'E2E Vínculo — Abuelo', probability: 70 }]);
        await page.waitForTimeout(300);

        const grandparentCard = page.locator('.risk-tree-card', { hasText: 'E2E Vínculo — Abuelo' });
        await expect(grandparentCard).toBeVisible();
        await expect(orphanCard).toBeVisible();

        // Ahora "Abuelo" tiene un hijo real — su propio modal de "Cambiar quién lo causó" NO debe
        // ofrecer a "Nieto Huérfano" como opción (crearía un ciclo directo).
        await grandparentCard.locator('[data-tree-change-trigger]').click();
        await page.waitForSelector('#tree-change-trigger-add-btn');
        await page.click('#tree-change-trigger-add-btn');
        await page.waitForSelector('#tree-change-trigger-body [data-cause-row]');
        const grandparentOptions = await page
            .locator('#tree-change-trigger-body [data-cause-row] [data-field="riskName"] option')
            .allTextContents();
        expect(grandparentOptions).not.toContain('E2E Vínculo — Nieto Huérfano');
        await page.click('#tree-change-trigger-cancel-btn');

        // Quitar el vínculo (eliminar la fila con "✕") deja al riesgo como raíz otra vez.
        await orphanCard.locator('[data-tree-change-trigger]').click();
        await page.waitForSelector('#tree-change-trigger-body [data-cause-row]');
        const [clearRes] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/register/') && r.request().method() === 'PUT', {
                timeout: 10000,
            }),
            (async () => {
                await page.click('#tree-change-trigger-body [data-cause-row] [data-remove-cause]');
                await page.click('#tree-change-trigger-save-btn');
            })(),
        ]);
        const clearBody = await clearRes.json();
        expect(clearBody.entry.triggeredBy).toEqual([]);
        await page.waitForTimeout(300);

        // Sigue existiendo, pero ya no como hijo de "Abuelo".
        const register = await page.evaluate(async () => {
            const res = await fetch('http://localhost:3000/api/register', { headers: { 'X-API-Key': 'test-e2e-key' } });
            return res.json();
        });
        const orphanEntry = register.risks.find((r) => r.riskName === 'E2E Vínculo — Nieto Huérfano');
        expect(orphanEntry.triggeredBy).toEqual([]);
    });
});
