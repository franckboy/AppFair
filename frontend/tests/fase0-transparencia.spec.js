'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// Dos avisos que la app NO daba, y que salieron de una revisión externa del modelo. Los dos son de
// transparencia pura — no cambian ningún cálculo — pero cubren el mismo hueco: un número en
// pantalla se lee como una afirmación de la herramienta, y callar el contexto es afirmar de más.
test.describe('Transparencia: lo que la interfaz decía de menos', () => {
    const HEREDADO = 'E2E Heredado — Mitigación adoptada sin receta';

    test('una mitigación heredada avisa que su cola está SOBREESTIMADA, no solo que hay que recalcular', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // Decisión de Mitigar SIN `residualInputs`: exactamente la forma que tenían las decisiones
        // adoptadas antes de que se persistiera la receta. El portafolio la reconstruye escalando,
        // y eso infla su cola hasta el triple.
        await page.evaluate(
            async ({ API, KEY, HEREDADO }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(HEREDADO)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskName: HEREDADO,
                        riskType: 'amenaza',
                        vulnManualOverride: true,
                        tef: { min: 1, mode: 2, max: 4 },
                        vuln: { min: 20, mode: 40, max: 60 },
                        lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 60000 } },
                        ale: 20000,
                        cvar95: 90000,
                        evaluationLevel: 'Requiere Tratamiento',
                        severity: 'alto',
                        chartLabels: ['x'],
                        chartData: [1],
                        treatmentDecision: {
                            strategy: 'mitigar',
                            residualALE: 8000,
                            decidedAt: '2026-01-01T00:00:00Z',
                        },
                    }),
                });
            },
            { API, KEY, HEREDADO },
        );

        // El backend lo reporta...
        const datos = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/register/portfolio-simulation`, { headers: { 'X-API-Key': KEY } });
                return res.json();
            },
            { API, KEY },
        );
        expect(datos.residual.legacyResidualRiskNames).toContain(HEREDADO);

        // ...y la interfaz dice hacia QUÉ LADO está el error, que es lo que permite priorizar: una
        // cola inflada es conservadora, no peligrosa.
        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(4000);
        const bloque = page.locator('#dashboard-portfolio-mc');
        await expect(bloque).toContainText('sobreestimada por seguridad');
        await expect(bloque).toContainText(HEREDADO);
        await expect(bloque).toContainText('Vuelve a adoptar la estrategia');

        await page.evaluate(
            async ({ API, KEY, HEREDADO }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(HEREDADO)}`, {
                    method: 'DELETE',
                    headers: { 'X-API-Key': KEY },
                });
            },
            { API, KEY, HEREDADO },
        );
    });

    test('los resultados del Equilibrio de Nash llevan pegado su deslinde, no solo la introducción', async ({
        page,
    }) => {
        await connectAndBoot(page);
        // Modo Técnico: el panel de Nash es `advanced-only` y en Modo Simple no existe.
        const toggleText = await page.locator('#mode-toggle-btn').textContent();
        if (toggleText.includes('Modo Simple')) await page.click('#mode-toggle-btn');
        await page.waitForTimeout(300);

        await page.click('#nav-treatment');
        await page.waitForTimeout(500);
        // Lo que este test protege es la UBICACIÓN, no el texto: el deslinde tiene que ser
        // descendiente del bloque de resultados. Ahí está el punto de todo el cambio — quien baja a
        // leer los siete números no pasó por la introducción de arriba, así que un párrafo suelto
        // antes del botón no sirve. Estando dentro, aparece y desaparece con los resultados sin que
        // nadie tenga que acordarse de mostrarlo.
        await expect(page.locator('#nash-results #nash-caveat')).toHaveCount(1);
        const caveat = page.locator('#nash-caveat');
        await expect(caveat).toContainText('no una métrica de riesgo');
        await expect(caveat).toContainText('no se pueden observar');
        // Y arranca oculto junto con los resultados: el deslinde no es un banner permanente que se
        // aprenda a ignorar, aparece exactamente cuando hay cifras que deslindar.
        await expect(page.locator('#nash-results')).toHaveClass(/hidden/);
    });
});
