'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

// Regresión: si dos autocálculos para el MISMO cómputo se disparan seguidos (ej. el usuario
// cambia el Perfil de Atacante dos veces rápido), no hay garantía de que las respuestas HTTP
// lleguen en el orden en que se pidieron — la más vieja puede llegar DESPUÉS que la más nueva
// y pisar en silencio un resultado ya correcto. App.FairWizard.updateAttackerDefenseSummary
// (y updateVulnerabilityAuto, que corre encadenada al final) ahora descartan una respuesta
// vieja si ya no es la más reciente para ese cómputo — ver el comentario junto a
// _attackerDefenseRequestId en fair-wizard.js.
test.describe('Condición de carrera en autocálculos', () => {
    test('una respuesta de red vieja (atacante "oportunista") que llega TARDE no pisa la más nueva (atacante "estado-nacion")', async ({
        page,
    }) => {
        await connectAndBoot(page);
        await page.waitForSelector('#fair-riskName');
        await page.fill('#fair-riskName', 'E2E — Carrera de autocálculo');
        await page.click('#fair-step1-next');
        await page.waitForTimeout(300);

        // La primera petición (attackerKey=oportunista) se demora artificialmente 1.5s antes de
        // responder — tiempo de sobra para que la segunda (estado-nacion, sin demora) responda
        // primero. Sin el guardián, la respuesta demorada de "oportunista" llegaría al final y
        // pisaría los valores ya correctos de "estado-nacion".
        await page.route('**/api/autocalc/attacker-defense-summary', async (route) => {
            const body = route.request().postDataJSON();
            if (body.attackerKey === 'oportunista') {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            await route.continue();
        });

        await page.selectOption('#fair-attacker-profile', 'oportunista');
        await page.waitForTimeout(50); // la petición de "oportunista" ya salió (y quedó demorada)
        await page.selectOption('#fair-attacker-profile', 'estado-nacion');

        // Espera a que ambas respuestas hayan tenido tiempo de llegar (la demorada incluida).
        await page.waitForTimeout(2500);

        // "estado-nacion" (Terrorista o Espía) tiene sus 5 factores en 90% -> Factor de Amenaza
        // (el promedio) da exactamente 90.0%. "oportunista" (30/10/20/20/10) da 18.0%. Si el bug
        // siguiera presente, la respuesta demorada de "oportunista" llegaría al final y el
        // resumen se quedaría mostrando 18.0%, no 90.0%.
        const summaryText = await page.locator('#fair-attacker-defense-summary').textContent();
        expect(summaryText).toContain('90.0%');
        expect(summaryText).not.toContain('18.0%');

        // El % de Vulnerabilidad automático (Paso 2) se deriva del Factor de Amenaza recién
        // calculado — con "estado-nacion" (90%) siempre da un número alto; con "oportunista"
        // (18%) daría uno mucho menor. Umbral generoso a propósito: solo distingue "se quedó
        // con el atacante correcto" de "se quedó con el viejo", no fija el número exacto.
        const vulnMode = await page.inputValue('#vuln-mode');
        expect(Number(vulnMode)).toBeGreaterThan(20);
    });
});
