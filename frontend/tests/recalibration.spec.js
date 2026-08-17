'use strict';
const { test, expect, connectAndBoot } = require('./helpers');

const API = 'http://localhost:3000';
const KEY = 'test-e2e-key';

// La app nunca recalcula sola un riesgo guardado: sobrescribir en silencio la evaluación de un
// analista destruye la trazabilidad de por qué se decidió lo que se decidió. La recalibración
// masiva es la salida EXPLÍCITA a esa regla — la dispara una persona, y en vez de borrar la
// evaluación anterior la empuja al Historial de Revisiones (ISO 31000, cláusula 6.6).
test.describe('Recalibración masiva', () => {
    const riskName = 'RECAL Riesgo desactualizado';

    test.afterEach(async ({ page }) => {
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'DELETE',
                    headers: { 'X-API-Key': KEY },
                });
            },
            { API, KEY, riskName },
        );
    });

    test('recalibra con los datos ya guardados, conserva la evaluación anterior en el historial y no toca el tratamiento', async ({
        page,
    }) => {
        await connectAndBoot(page);

        // Un riesgo tal como quedaría guardado con el modelo ANTERIOR: sello de calibración viejo,
        // cifras de entonces, y una decisión de tratamiento ya adoptada que no debe tocarse.
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({
                        riskType: 'amenaza',
                        vulnManualOverride: true,
                        // Raro y severo: el régimen donde el modelo nuevo más mueve la cola.
                        tef: { min: 0.05, mode: 0.1, max: 0.3 },
                        vuln: { min: 20, mode: 40, max: 70 },
                        lossMagnitudes: { respuesta: { min: 5000, mode: 50000, max: 400000 } },
                        seed: 42,
                        ale: 5000,
                        cvar95: 20000,
                        evaluationLevel: 'Aceptable',
                        severity: 'bajo',
                        calibrationVersion: 3,
                        chartLabels: ['viejo'],
                        chartData: [1],
                        assessor: 'Analista original',
                        treatmentDecision: {
                            strategy: 'aceptar',
                            residualALE: 5000,
                            decidedAt: '2026-01-01T00:00:00Z',
                        },
                    }),
                });
            },
            { API, KEY, riskName },
        );

        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);

        // El botón solo aparece cuando hay algo que recalibrar, y dice cuántos.
        const boton = page.locator('#fair-recalibrate-all-btn');
        await expect(boton).toBeVisible();
        await expect(boton).toContainText('Recalibrar');

        await boton.click();
        // Antes de tocar nada, dice qué va a cambiar y qué no.
        await expect(page.locator('#modalBody')).toContainText('Historial de Revisiones');
        await page.click('#recal-go-btn');

        await expect(page.locator('#modalTitle')).toHaveText('Recalibración terminada', { timeout: 120000 });

        const entry = await page.evaluate(
            async ({ API, KEY, riskName }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                const data = await res.json();
                return data.risks.find((r) => r.riskName === riskName);
            },
            { API, KEY, riskName },
        );

        // Quedó sellado con la calibración vigente y con cifras nuevas. La versión se lee del
        // backend, no se escribe a mano: subir CALIBRATION_VERSION no debe romper este test.
        const vigente = await page.evaluate(
            async ({ API, KEY }) => {
                const res = await fetch(`${API}/api/config/profiles`, { headers: { 'X-API-Key': KEY } });
                return (await res.json()).calibrationVersion;
            },
            { API, KEY },
        );
        expect(entry.calibrationVersion).toBe(vigente);
        expect(entry.ale).not.toBe(5000);
        expect(entry.cvar95).not.toBe(20000);

        // La garantía que hace esto aceptable: la evaluación ANTERIOR no se perdió.
        const previa = entry.reviewHistory.find((h) => h.evaluationLevel === 'Aceptable');
        expect(previa).toBeTruthy();
        expect(previa.ale).toBe('$5,000');

        // Lo que NO se toca: decisión de tratamiento, dueño, y el resto de lo descriptivo.
        expect(entry.treatmentDecision.strategy).toBe('aceptar');
        expect(entry.treatmentDecision.decidedAt).toBe('2026-01-01T00:00:00Z');
        expect(entry.assessor).toBe('Analista original');
        expect(entry.tef.mode).toBe(0.1);

        // El histograma guardado era de la corrida vieja: se limpia en vez de dejar un dibujo del
        // modelo anterior junto a cifras del nuevo.
        expect(entry.chartLabels).toBeNull();

        await page.click('#recal-close-btn');
        // Ya sin nada desactualizado con datos simulables, el botón se retira solo.
        await page.waitForTimeout(500);
    });

    test('un riesgo "Sin analizar" no se recalibra: no hay nada que volver a simular', async ({ page }) => {
        await connectAndBoot(page);
        // Un stub creado desde el Árbol con "+" no tiene tef/vuln/lossMagnitudes. Marcarlo como
        // pendiente sería prometer un recálculo imposible.
        await page.evaluate(
            async ({ API, KEY, riskName }) => {
                await fetch(`${API}/api/register/${encodeURIComponent(riskName)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
                    body: JSON.stringify({ riskType: 'amenaza', ale: 12345, cvar95: 20000 }),
                });
            },
            { API, KEY, riskName },
        );

        await connectAndBoot(page);
        await page.click('#nav-dashboard');
        await page.waitForTimeout(1500);

        // El stub sigue marcado "Recalibrar" en la tabla — es información honesta para el usuario,
        // que puede completarle el análisis. Lo que se verifica aquí es que la recalibración masiva
        // NO lo toque: sus cifras y su (falta de) sello quedan igual después de correrla.
        const fila = page.locator('#quick-concentrated-table-body tr', { hasText: riskName });
        await expect(fila.getByText('Recalibrar')).toBeVisible();

        // El botón puede estar o no visible según lo que hayan dejado otras specs en el Registro
        // compartido; si está, se ejecuta, y la aserción de abajo es la que de verdad manda.
        const boton = page.locator('#fair-recalibrate-all-btn');
        if (await boton.isVisible()) {
            await boton.click();
            await page.click('#recal-go-btn');
            await expect(page.locator('#modalTitle')).toHaveText('Recalibración terminada', { timeout: 120000 });
            await page.click('#recal-close-btn');
        }

        const entry = await page.evaluate(
            async ({ API, KEY, riskName }) => {
                const res = await fetch(`${API}/api/register`, { headers: { 'X-API-Key': KEY } });
                const data = await res.json();
                return data.risks.find((r) => r.riskName === riskName);
            },
            { API, KEY, riskName },
        );
        expect(entry.ale).toBe(12345);
        expect(entry.calibrationVersion ?? null).toBeNull();
    });
});
