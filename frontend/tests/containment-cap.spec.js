'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';
const RIESGO = 'CONTENCION Cola larga';

// Mitigar tiene dos palancas que no son lo mismo: PREVENIR (subir el Nivel de Defensa, que hace
// que pase menos veces) y CONTENER (un tope de daño por evento, que hace que duela menos cuando
// pasa). Prevenir escala toda la distribución y deja la razón cola/media congelada; contener
// trunca los peores escenarios y la aplana. Sin esta distinción, ningún control podía afectar la
// cola de forma distinta al promedio.
test.describe('Mitigar: tope de daño por evento (contención)', () => {
    test('añadir contención recorta la cola mucho más que subir la defensa sola', async ({ page }) => {
        await connectAndBoot(page);

        // Se siembra por API: el helper del wizard no llena Magnitud de Pérdida y deja el riesgo en
        // $0, donde no hay nada que reducir. Aquí hace falta una cola larga de verdad (el máximo es
        // 40x la moda), que es donde contener y prevenir se distinguen.
        await page.evaluate(
            async ({ API, KEY, RIESGO }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(RIESGO)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskType: 'amenaza',
                        attackerKey: 'organizado',
                        defenseKey: 'basica',
                        dataConfidence: 'medio',
                        vulnManualOverride: false,
                        tef: { min: 1, mode: 2, max: 4 },
                        vuln: { min: 20, mode: 40, max: 60 },
                        lossMagnitudes: { respuesta: { min: 5000, mode: 25000, max: 1000000 } },
                        ale: 130000,
                        cvar95: 780000,
                        evaluationLevel: 'Requiere Tratamiento',
                        severity: 'alto',
                    }),
                });
            },
            { API, KEY, RIESGO },
        );

        await connectAndBoot(page);
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', RIESGO);
        await page.waitForTimeout(800);
        await expect(page.locator('#fair-mitigar-tope-dano')).toBeVisible();

        const leer = () =>
            page.evaluate(() => ({
                reduccion: Number(document.getElementById('fair-reduccionALE').value),
                ale: document.getElementById('fair-roi-ale-despues').textContent,
                cvar: document.getElementById('fair-roi-cvar-despues').textContent,
            }));
        const aNumero = (txt) => Number(String(txt).replace(/[^0-9.]/g, ''));

        // Solo prevenir: subir el Nivel de Defensa Objetivo.
        await page.selectOption('#fair-mitigar-defensa-objetivo', 'avanzada');
        await page.waitForTimeout(2500);
        const prevenir = await leer();
        expect(prevenir.reduccion).toBeGreaterThan(0);

        // Añadir contención sobre la MISMA defensa objetivo.
        await page.fill('#fair-mitigar-tope-dano', '30000');
        await page.waitForTimeout(3000);
        const contener = await leer();

        // El campo no puede ser decorativo: tiene que mover el residual.
        expect(contener.reduccion).toBeGreaterThan(prevenir.reduccion);
        // Y lo que lo distingue de prevenir: la cola cae MÁS que la media.
        const caidaALE = 1 - aNumero(contener.ale) / aNumero(prevenir.ale);
        const caidaCVaR = 1 - aNumero(contener.cvar) / aNumero(prevenir.cvar);
        expect(caidaCVaR).toBeGreaterThan(caidaALE);

        // Persiste: es parte de la decisión, no un ajuste de sesión.
        await connectAndBoot(page);
        await page.click('#nav-treatment');
        await page.waitForTimeout(1000);
        await page.selectOption('#treatment-risk-select', RIESGO);
        await page.waitForTimeout(800);
        await expect(page.locator('#fair-mitigar-tope-dano')).toHaveValue('30000');

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
});
