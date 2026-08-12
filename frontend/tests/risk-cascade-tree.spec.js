'use strict';
const { test, expect, connectAndBoot, runFullFairAnalysis } = require('./helpers');

test.describe('Árbol de Riesgos en Cascada', () => {
    test('un riesgo con "Riesgo Desencadenante" aparece anidado bajo su padre, y la rama se puede colapsar', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await runFullFairAnalysis(page, 'E2E Árbol — Riesgo Padre');

        // Riesgo hijo: página fresca (evita el modal de confirmación de "Nuevo Análisis") y
        // esta vez sí se elige "Riesgo Desencadenante" en el Paso 1 antes de avanzar.
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');
        await page.fill('#fair-riskName', 'E2E Árbol — Riesgo Hijo');
        await page.selectOption('#fair-triggered-by', 'E2E Árbol — Riesgo Padre');
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

        await page.click('#nav-risk-tree');
        await page.waitForSelector('#risk-cascade-tree-container');
        await page.waitForTimeout(300);

        const parentCard = page.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Padre' });
        await expect(parentCard).toBeVisible();

        // El hijo debe estar DENTRO del <li> del padre (anidado en su <ul> de hijos), no solo
        // presente en algún lugar de la página — así se confirma la relación, no solo que
        // ambos nombres aparecen.
        const parentLi = page.locator('li', { has: parentCard });
        const childCard = parentLi.locator('.risk-tree-card', { hasText: 'E2E Árbol — Riesgo Hijo' });
        await expect(childCard).toBeVisible();

        // Colapsar la rama del padre oculta al hijo sin quitarlo del DOM.
        await parentLi.locator('[data-tree-toggle]').first().click();
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

    test('Simular Familia: un hijo creado con "+" conserva su triggeredByProbability al completar su FAIR, y la simulación combinada incluye a ambos', async ({
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

        // Regresión: antes de esta tarea, saveToRiskRegister() nunca reenviaba
        // triggeredByProbability — completar el FAIR de un hijo creado con "+" lo borraba en
        // silencio (quedaba null) justo cuando runFamilyCascadeSimulation empieza a necesitarlo.
        const [putRes] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/api/register/') && r.request().method() === 'PUT', {
                timeout: 15000,
            }),
            runFullFairAnalysis(page, 'E2E Familia — Hijo'),
        ]);
        const putBody = await putRes.json();
        expect(putBody.entry.triggeredByProbability).toBe(90);

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
});
