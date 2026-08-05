'use strict';

// Pruebas de integración de las rutas HTTP — a diferencia de lib.test.js (que solo prueba el
// motor de cálculo puro), estas sí levantan la app Express real y verifican autenticación,
// validación, códigos de estado y contratos de request/response.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');

const TEST_API_KEY = 'test-key-for-http-integration-tests';
process.env.API_KEY = TEST_API_KEY;

// data/db.json es efímero (está en .gitignore) — se arranca cada corrida desde datos limpios,
// igual que se hace manualmente al probar en local.
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const app = require('../server'); // require.main !== module aquí, así que no llama a app.listen()

test.after(() => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
});

// --- Salud y autenticación ---

test('GET /api/health responde 200 sin necesitar API key', async () => {
    const res = await request(app).get('/api/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
});

test('GET /api/health expone el tipo de almacenamiento, nunca la cadena de conexión', async () => {
    const res = await request(app).get('/api/health');
    // Las pruebas nunca configuran DATABASE_URL a propósito (ver src/store/index.js) — JsonStore.
    assert.strictEqual(res.body.store, 'json');
    assert.strictEqual(JSON.stringify(res.body).includes('postgresql://'), false);
});

test('GET /api/config/criteria sin header X-API-Key responde 401', async () => {
    const res = await request(app).get('/api/config/criteria');
    assert.strictEqual(res.status, 401);
});

test('GET /api/config/criteria con API key incorrecta responde 401', async () => {
    const res = await request(app).get('/api/config/criteria').set('X-API-Key', 'key-equivocada');
    assert.strictEqual(res.status, 401);
});

test('GET /api/config/criteria con API key correcta responde 200 con los criterios por defecto', async () => {
    const res = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rrtBands.medio, 25);
});

// --- Config: perfiles (solo lectura) y Criterios de Riesgo ---

test('GET /api/config/profiles trae los 5 perfiles de atacante y 4 de defensa', async () => {
    const res = await request(app).get('/api/config/profiles').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(Object.keys(res.body.attackerProfiles).length, 5);
    assert.strictEqual(Object.keys(res.body.defenseProfiles).length, 4);
});

test('GET /api/config/profiles trae el Catálogo de Riesgos en 3 niveles (Dominio > Categoría > Amenaza), cada amenaza con key/name/standard', async () => {
    const res = await request(app).get('/api/config/profiles').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    const domains = Object.keys(res.body.riskCatalog);
    assert.deepStrictEqual(domains.sort(), [
        'cadena-suministro',
        'humano',
        'legal',
        'natural',
        'operacional',
        'operador-economico-autorizado',
        'tecnologico',
    ]);
    assert.strictEqual(Object.keys(res.body.riskCatalog.humano.categories).length, 10);
    for (const domain of Object.values(res.body.riskCatalog)) {
        assert.ok(typeof domain.label === 'string' && domain.label.length > 0);
        const categoryKeys = Object.keys(domain.categories);
        assert.ok(categoryKeys.length > 0);
        for (const category of Object.values(domain.categories)) {
            assert.ok(typeof category.label === 'string' && category.label.length > 0);
            assert.ok(Array.isArray(category.threats) && category.threats.length > 0);
            for (const threat of category.threats) {
                assert.ok(typeof threat.key === 'string' && threat.key.length > 0);
                assert.ok(typeof threat.name === 'string' && threat.name.length > 0);
                assert.ok(typeof threat.standard === 'string' && threat.standard.length > 0);
            }
        }
    }
});

test('PUT /api/config/criteria rechaza bandas no crecientes con 400', async () => {
    const res = await request(app)
        .put('/api/config/criteria')
        .set('X-API-Key', TEST_API_KEY)
        .send({ rrtBands: { medio: 50, alto: 25, critico: 75 }, aleAceptable: 1, aleCritico: 2 });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/config/criteria rechaza aleAceptable >= aleCritico con 400', async () => {
    const res = await request(app)
        .put('/api/config/criteria')
        .set('X-API-Key', TEST_API_KEY)
        .send({ rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptable: 5000, aleCritico: 1000 });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/config/criteria guarda y un GET posterior refleja el cambio', async () => {
    const body = {
        rrtBands: { medio: 20, alto: 40, critico: 60 },
        aleAceptable: 1000,
        aleCritico: 5000,
        aleUmbralExcedencia: 2000,
    };
    const putRes = await request(app).put('/api/config/criteria').set('X-API-Key', TEST_API_KEY).send(body);
    assert.strictEqual(putRes.status, 200);

    const getRes = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.rrtBands.alto, 40);
});

test('PUT /api/config/org-defaults guarda solo los campos enviados, conserva el resto', async () => {
    const putRes = await request(app)
        .put('/api/config/org-defaults')
        .set('X-API-Key', TEST_API_KEY)
        .send({ owner: 'QA HTTP' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.owner, 'QA HTTP');
    assert.strictEqual(putRes.body.defenseKey, 'estandar'); // valor por defecto, no se mandó pero se conserva
});

// --- Autocálculo ---

test('POST /api/autocalc/vulnerability con perfiles válidos responde con min <= mode <= max', async () => {
    const res = await request(app)
        .post('/api/autocalc/vulnerability')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'empleado-desleal', defenseKey: 'estandar', confidence: 'medio' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.min <= res.body.mode && res.body.mode <= res.body.max);
});

test('POST /api/autocalc/vulnerability con un perfil que no existe responde 400', async () => {
    const res = await request(app)
        .post('/api/autocalc/vulnerability')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'no-existe', defenseKey: 'estandar' });
    assert.strictEqual(res.status, 400);
});

test('POST /api/autocalc/loss-magnitude en batch devuelve un rango por cada item', async () => {
    const res = await request(app)
        .post('/api/autocalc/loss-magnitude')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            items: [
                { key: 'respuesta', mode: 50000 },
                { key: 'multas', mode: 20000 },
            ],
            confidence: 'bajo',
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.respuesta.mode, 50000);
    assert.ok(res.body.respuesta.min < 50000 && res.body.respuesta.max > 50000);
});

test('POST /api/autocalc/reduccion-ale: degradar la defensa da 0% (protección contra mal uso)', async () => {
    const res = await request(app)
        .post('/api/autocalc/reduccion-ale')
        .set('X-API-Key', TEST_API_KEY)
        .send({ currentDefenseKey: 'avanzada', targetDefenseKey: 'basica' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reductionPercent, 0);
});

// --- Simulación ---

test('POST /api/simulate con datos válidos responde con summary y annualLosses del tamaño pedido', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 500,
            seed: 42,
            tef: { min: 5, mode: 10, max: 20 },
            vuln: { min: 10, mode: 20, max: 30 },
            lossMagnitudes: { respuesta: { min: 1000, mode: 5000, max: 10000 } },
        });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body.summary.average, 'number');
    assert.strictEqual(res.body.annualLosses.length, 500);
});

test('POST /api/simulate con iterations por encima del tope responde 400', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ iterations: 999999, tef: { min: 1, mode: 2, max: 3 }, vuln: { min: 1, mode: 2, max: 3 } });
    assert.strictEqual(res.status, 400);
});

test('POST /api/simulate sin tef ni vuln responde 400', async () => {
    const res = await request(app).post('/api/simulate').set('X-API-Key', TEST_API_KEY).send({});
    assert.strictEqual(res.status, 400);
});

test('POST /api/simulate con vuln fuera de 0-100 responde 400', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ tef: { min: 1, mode: 2, max: 3 }, vuln: { min: 10, mode: 20, max: 150 } });
    assert.strictEqual(res.status, 400);
});

// --- Tratamiento ---

test('POST /api/treatment/evaluate sin currentALE responde 400', async () => {
    const res = await request(app).post('/api/treatment/evaluate').set('X-API-Key', TEST_API_KEY).send({});
    assert.strictEqual(res.status, 400);
});

test('POST /api/treatment/evaluate con datos válidos responde con las 4 estrategias + recomendación', async () => {
    const res = await request(app)
        .post('/api/treatment/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ currentALE: 100000, mitigar: { cost: 5000, reductionPercent: 50 } });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.mitigar && res.body.transferir && res.body.evitar && res.body.aceptar);
    assert.ok(res.body.recommendation);
});

test('POST /api/treatment/evaluate con reductionPercent > 100 responde 400 (no se puede evitar más del 100% del riesgo)', async () => {
    const res = await request(app)
        .post('/api/treatment/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ currentALE: 100000, mitigar: { cost: 5000, reductionPercent: 150 } });
    assert.strictEqual(res.status, 400);
});

test('POST /api/treatment/evaluate con costo negativo responde 400', async () => {
    const res = await request(app)
        .post('/api/treatment/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ currentALE: 100000, evitar: { cost: -5000 } });
    assert.strictEqual(res.status, 400);
});

// --- Registro de Riesgos ---

test('flujo completo del Registro: PUT crea, GET lo lista, DELETE lo quita', async () => {
    const riskName = 'Riesgo de prueba HTTP';

    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 50000,
            cvar95: 90000,
            evaluationLevel: 'Aceptable',
            evaluationJustification: 'prueba automatizada',
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.riskName, riskName);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.risks.some((r) => r.riskName === riskName));
    assert.ok(getRes.body.pareto, 'con al menos un riesgo guardado, debe venir el análisis de Pareto');

    const delRes = await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.ok(!getRes2.body.risks.some((r) => r.riskName === riskName));
});

test('PUT /api/register/:riskName sin ale (número) responde 400', async () => {
    const res = await request(app).put('/api/register/Riesgo%20Incompleto').set('X-API-Key', TEST_API_KEY).send({});
    assert.strictEqual(res.status, 400);
});

test('PUT /api/register/:riskName siempre guarda currency USD, ignorando lo que mande el body', async () => {
    const riskName = 'Riesgo con moneda de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 15000, evaluationLevel: 'Riesgo Bajo', currency: 'EUR' });
    assert.strictEqual(putRes.body.entry.currency, 'USD');

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('POST /api/simulate y POST /api/treatment/evaluate siempre responden currency USD', async () => {
    const simRes = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 100,
            seed: 1,
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 10, mode: 20, max: 30 },
            lossMagnitudes: {},
            currency: 'MXN',
        });
    assert.strictEqual(simRes.body.currency, 'USD');

    const treatRes = await request(app)
        .post('/api/treatment/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            currentALE: 50000,
            currency: 'EUR',
            mitigar: { cost: 5000, reductionPercent: 40, reliability: 'media', delayDays: 0 },
        });
    assert.strictEqual(treatRes.status, 200);
    // treatment.js no devuelve "currency" en la respuesta — lo que importa es que los mensajes
    // (formatCurrency interno) no truenen con una moneda no reconocida y usen USD tal cual.
    assert.ok(treatRes.body.mitigar.verdict.message.includes('$'));
});

test('PUT /api/register/:riskName con riskType "oportunidad" se guarda y se excluye del Pareto', async () => {
    // Bug real: riskType no se guardaba nunca (undefined para siempre), así que una
    // "oportunidad" (riesgo positivo) quedaba indistinguible de una amenaza en el Registro —
    // su beneficio esperado se sumaba a la "exposición total" y se graficaba en la esquina
    // "Crítico" del mapa de calor como si fuera el peor riesgo del portafolio.
    const riskName = 'Oportunidad de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 900000, cvar95: 1200000, evaluationLevel: 'Oportunidad Significativa', riskType: 'oportunidad' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.riskType, 'oportunidad');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const saved = getRes.body.risks.find((r) => r.riskName === riskName);
    assert.strictEqual(saved.riskType, 'oportunidad');
    assert.ok(
        !getRes.body.pareto.risks.some((r) => r.riskName === riskName),
        'la oportunidad no debe aparecer en el Pareto (su "ale" es un beneficio, no una pérdida)',
    );

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName guarda sourceRiskId para vincularlo con /api/risks (tabla concentrada)', async () => {
    const riskName = 'Riesgo vinculado de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 50000, cvar95: 80000, evaluationLevel: 'Riesgo Medio', sourceRiskId: 'abc-123' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.sourceRiskId, 'abc-123');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.risks.find((r) => r.riskName === riskName).sourceRiskId, 'abc-123');

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName guarda triggeredByRiskName (riesgo en cascada)', async () => {
    const parentName = 'Incendio en bodega (padre de prueba)';
    const childName = 'Interrupción operativa (hijo de prueba)';
    await request(app)
        .put(`/api/register/${encodeURIComponent(parentName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 100000, cvar95: 150000, evaluationLevel: 'Riesgo Alto' });

    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(childName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 40000, cvar95: 60000, evaluationLevel: 'Riesgo Medio', triggeredByRiskName: parentName });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.triggeredByRiskName, parentName);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.risks.find((r) => r.riskName === childName).triggeredByRiskName, parentName);
    assert.strictEqual(
        getRes.body.risks.find((r) => r.riskName === parentName).triggeredByRiskName,
        null,
        'un riesgo sin desencadenante debe guardarse como null, no undefined ni una cadena vacía',
    );

    await request(app)
        .delete(`/api/register/${encodeURIComponent(parentName)}`)
        .set('X-API-Key', TEST_API_KEY);
    await request(app)
        .delete(`/api/register/${encodeURIComponent(childName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName guarda description', async () => {
    const riskName = 'Riesgo con descripción de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 30000,
            cvar95: 45000,
            evaluationLevel: 'Riesgo Medio',
            description: 'Robo de mercancía durante la noche.',
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.description, 'Robo de mercancía durante la noche.');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(
        getRes.body.risks.find((r) => r.riskName === riskName).description,
        'Robo de mercancía durante la noche.',
    );

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName: dos riesgos DISTINTOS con el mismo nombre no se pisan entre sí (identificados por sourceRiskId, no por nombre)', async () => {
    const sharedName = 'Incendio en instalación';
    const putA = await request(app)
        .put(`/api/register/${encodeURIComponent(sharedName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 15000, evaluationLevel: 'Riesgo Bajo', sourceRiskId: 'risk-a' });
    const putB = await request(app)
        .put(`/api/register/${encodeURIComponent(sharedName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 90000, cvar95: 150000, evaluationLevel: 'Riesgo Alto', sourceRiskId: 'risk-b' });

    assert.notStrictEqual(
        putA.body.entry.id,
        putB.body.entry.id,
        'cada riesgo de origen distinto debe generar su propia entrada del Registro, aunque compartan nombre',
    );

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const entries = getRes.body.risks.filter((r) => r.riskName === sharedName);
    assert.strictEqual(entries.length, 2, 'ambas entradas deben coexistir, no pisarse');
    assert.ok(entries.some((r) => r.sourceRiskId === 'risk-a' && r.ale === 10000));
    assert.ok(entries.some((r) => r.sourceRiskId === 'risk-b' && r.ale === 90000));

    // Borrar una por sourceRiskId debe dejar intacta la otra.
    await request(app)
        .delete(`/api/register/${encodeURIComponent(sharedName)}?sourceRiskId=risk-a`)
        .set('X-API-Key', TEST_API_KEY);
    const afterDelete = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const remaining = afterDelete.body.risks.filter((r) => r.riskName === sharedName);
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].sourceRiskId, 'risk-b');

    await request(app)
        .delete(`/api/register/${encodeURIComponent(sharedName)}?sourceRiskId=risk-b`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName: re-simular con el mismo sourceRiskId actualiza la misma entrada aunque cambie el nombre', async () => {
    const putFirst = await request(app)
        .put('/api/register/Robo%20Bodega%20A')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 20000, cvar95: 30000, evaluationLevel: 'Riesgo Medio', sourceRiskId: 'risk-c' });
    const entryId = putFirst.body.entry.id;

    // El usuario renombra el riesgo y vuelve a simular — mismo sourceRiskId, nombre distinto.
    const putRenamed = await request(app)
        .put('/api/register/Robo%20Bodega%20A%20(renombrado)')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 25000, cvar95: 35000, evaluationLevel: 'Riesgo Medio', sourceRiskId: 'risk-c', id: entryId });

    assert.strictEqual(putRenamed.body.entry.id, entryId, 'debe conservar el mismo id, no generar uno nuevo');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const matches = getRes.body.risks.filter((r) => r.sourceRiskId === 'risk-c');
    assert.strictEqual(matches.length, 1, 'no debe quedar una entrada huérfana con el nombre viejo');
    assert.strictEqual(matches[0].riskName, 'Robo Bodega A (renombrado)');
    assert.strictEqual(matches[0].ale, 25000);

    await request(app)
        .delete(`/api/register/${encodeURIComponent('Robo Bodega A (renombrado)')}?sourceRiskId=risk-c`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName: dos riesgos nuevos SIN sourceRiskId (armados directo en FAIR, sin Vista Rápida) y el mismo nombre no se pisan entre sí, si cada uno manda su propio id generado por el cliente', async () => {
    const sharedName = 'Robo en Bodega Principal';
    const clientIdA = 'client-uuid-aaaa';
    const clientIdB = 'client-uuid-bbbb';

    const putA = await request(app)
        .put(`/api/register/${encodeURIComponent(sharedName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 15000, cvar95: 20000, evaluationLevel: 'Riesgo Bajo', id: clientIdA });
    const putB = await request(app)
        .put(`/api/register/${encodeURIComponent(sharedName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 500000, cvar95: 800000, evaluationLevel: 'Riesgo Crítico', id: clientIdB });

    assert.strictEqual(putA.body.entry.id, clientIdA);
    assert.strictEqual(putB.body.entry.id, clientIdB);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const entries = getRes.body.risks.filter((r) => r.riskName === sharedName);
    assert.strictEqual(
        entries.length,
        2,
        'ambos deben coexistir — el segundo NO debe pisar al primero solo por compartir nombre',
    );
    assert.ok(entries.some((r) => r.id === clientIdA && r.ale === 15000));
    assert.ok(entries.some((r) => r.id === clientIdB && r.ale === 500000));

    await request(app)
        .delete(`/api/register/${encodeURIComponent(sharedName)}?id=${clientIdA}`)
        .set('X-API-Key', TEST_API_KEY);
    await request(app)
        .delete(`/api/register/${encodeURIComponent(sharedName)}?id=${clientIdB}`)
        .set('X-API-Key', TEST_API_KEY);
});

// --- Catálogo de Activos ---

test('GET /api/assets sin header X-API-Key responde 401', async () => {
    const res = await request(app).get('/api/assets');
    assert.strictEqual(res.status, 401);
});

test('POST /api/assets sin nombre responde 400', async () => {
    const res = await request(app).post('/api/assets').set('X-API-Key', TEST_API_KEY).send({ valorEstimado: 1000 });
    assert.strictEqual(res.status, 400);
});

test('POST /api/assets con valorEstimado negativo responde 400', async () => {
    const res = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega 1', valorEstimado: -5 });
    assert.strictEqual(res.status, 400);
});

test('flujo completo del Catálogo de Activos: POST crea, GET lo lista, PUT lo actualiza, DELETE lo quita', async () => {
    const postRes = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega Central', valorEstimado: 500000, categoria: 'Inventario', ubicacion: 'Planta 1' });
    assert.strictEqual(postRes.status, 201);
    assert.ok(postRes.body.entry.id, 'debe generar un id único, no depender del nombre');
    const id = postRes.body.entry.id;

    const getRes = await request(app).get('/api/assets').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.assets.some((a) => a.id === id && a.nombre === 'Bodega Central'));

    const putRes = await request(app)
        .put(`/api/assets/${id}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega Central Renombrada', valorEstimado: 750000 });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.valorEstimado, 750000);

    const delRes = await request(app).delete(`/api/assets/${id}`).set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await request(app).get('/api/assets').set('X-API-Key', TEST_API_KEY);
    assert.ok(!getRes2.body.assets.some((a) => a.id === id));
});

test('PUT /api/assets/:id con id inexistente responde 404', async () => {
    const res = await request(app)
        .put('/api/assets/id-que-no-existe')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'X', valorEstimado: 1 });
    assert.strictEqual(res.status, 404);
});

test('POST/PUT /api/assets siempre guarda currency USD, ignorando lo que mande el body', async () => {
    // La app solo calcula en USD — mandar otra moneda no debe tener efecto (ver la nota en
    // routes/assets.js): eliminar la variable evita por construcción mezclar monedas.
    const postRes = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Equipo Importado', valorEstimado: 20000, currency: 'EUR' });
    assert.strictEqual(postRes.body.entry.currency, 'USD');

    const postDefaultRes = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega Local', valorEstimado: 10000 });
    assert.strictEqual(postDefaultRes.body.entry.currency, 'USD');

    const putRes = await request(app)
        .put(`/api/assets/${postRes.body.entry.id}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Equipo Importado', valorEstimado: 25000, currency: 'MXN' });
    assert.strictEqual(putRes.body.entry.currency, 'USD');

    await request(app).delete(`/api/assets/${postRes.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
    await request(app).delete(`/api/assets/${postDefaultRes.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
});

test('dos activos pueden compartir el mismo nombre sin pisarse (identificados por id, no por nombre)', async () => {
    const a = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega 3', valorEstimado: 100 });
    const b = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega 3', valorEstimado: 200 });
    assert.notStrictEqual(a.body.entry.id, b.body.entry.id);

    const getRes = await request(app).get('/api/assets').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.assets.filter((x) => x.nombre === 'Bodega 3').length, 2);

    await request(app).delete(`/api/assets/${a.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
    await request(app).delete(`/api/assets/${b.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
});

// --- Historial unificado de riesgos (nace en Análisis Rápido) ---

test('GET /api/risks sin header X-API-Key responde 401', async () => {
    const res = await request(app).get('/api/risks');
    assert.strictEqual(res.status, 401);
});

test('POST /api/risks sin name responde 400', async () => {
    const res = await request(app).post('/api/risks').set('X-API-Key', TEST_API_KEY).send({ ri: '10%' });
    assert.strictEqual(res.status, 400);
});

test('flujo completo del Historial unificado: POST crea, GET lo lista, PUT lo actualiza, DELETE lo quita', async () => {
    const postRes = await request(app)
        .post('/api/risks')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            name: 'Robo armado en bodega',
            ri: '42.75%',
            rrt: '10.20%',
            ale: '$505.00',
            date: '5/8/2026',
            fullData: { riskName: 'Robo armado en bodega', RRt: 0.102, rrMax: 25 },
        });
    assert.strictEqual(postRes.status, 201);
    assert.ok(postRes.body.entry.id, 'debe generar un id único, no depender del nombre');
    const id = postRes.body.entry.id;

    const getRes = await request(app).get('/api/risks').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.risks.some((r) => r.id === id && r.name === 'Robo armado en bodega'));
    assert.strictEqual(
        getRes.body.risks.find((r) => r.id === id).fullData.RRt,
        0.102,
        'el body flexible (fullData) debe pasar tal cual',
    );

    const putRes = await request(app)
        .put(`/api/risks/${id}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            name: 'Robo armado en bodega (actualizado)',
            ri: '50.00%',
            rrt: '15.00%',
            ale: '$700.00',
            date: '5/8/2026',
            fullData: { riskName: 'Robo armado en bodega (actualizado)', RRt: 0.15, rrMax: 25 },
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.name, 'Robo armado en bodega (actualizado)');
    assert.strictEqual(putRes.body.entry.id, id, 'actualizar no debe cambiar el id (misma identidad)');

    const delRes = await request(app).delete(`/api/risks/${id}`).set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await request(app).get('/api/risks').set('X-API-Key', TEST_API_KEY);
    assert.ok(!getRes2.body.risks.some((r) => r.id === id));
});

test('PUT /api/risks/:id con id inexistente responde 404', async () => {
    const res = await request(app)
        .put('/api/risks/id-que-no-existe')
        .set('X-API-Key', TEST_API_KEY)
        .send({ name: 'X' });
    assert.strictEqual(res.status, 404);
});

test('dos riesgos pueden compartir el mismo nombre sin pisarse (identificados por id, no por nombre)', async () => {
    const a = await request(app).post('/api/risks').set('X-API-Key', TEST_API_KEY).send({ name: 'Robo en bodega' });
    const b = await request(app).post('/api/risks').set('X-API-Key', TEST_API_KEY).send({ name: 'Robo en bodega' });
    assert.notStrictEqual(a.body.entry.id, b.body.entry.id);

    const getRes = await request(app).get('/api/risks').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.risks.filter((x) => x.name === 'Robo en bodega').length, 2);

    await request(app).delete(`/api/risks/${a.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
    await request(app).delete(`/api/risks/${b.body.entry.id}`).set('X-API-Key', TEST_API_KEY);
});

test('DELETE /api/risks/:id borra en cascada la entrada del Registro vinculada, sin dejarla huérfana', async () => {
    const risk = await request(app)
        .post('/api/risks')
        .set('X-API-Key', TEST_API_KEY)
        .send({ name: 'Incendio en planta (cascada HTTP)' });
    const riskId = risk.body.entry.id;

    const riskName = 'Análisis FAIR vinculado (cascada HTTP)';
    await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 40000, cvar95: 60000, evaluationLevel: 'Riesgo Medio', sourceRiskId: riskId });

    let registerRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.ok(
        registerRes.body.risks.some((r) => r.sourceRiskId === riskId),
        'la entrada debe existir antes de borrar el riesgo de origen',
    );

    // Borrar SOLO /api/risks/:id — sin ninguna llamada explícita a /api/register — debe bastar
    // para que la entrada vinculada desaparezca también (antes esto dependía por completo de
    // que el frontend hiciera las dos llamadas por separado; ver App.FairRegister.
    // deleteConcentratedRisk, y la nota en store.deleteRisk).
    const delRes = await request(app).delete(`/api/risks/${riskId}`).set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    registerRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.ok(
        !registerRes.body.risks.some((r) => r.sourceRiskId === riskId),
        'no debe quedar una entrada huérfana en el Registro',
    );

    // Un riesgo del Registro SIN sourceRiskId (ej. "Duplicar como Plantilla") no debe verse
    // afectado por borrar un riesgo de /api/risks distinto — la cascada es por sourceRiskId
    // exacto, no un borrado general.
    const standaloneName = 'Análisis FAIR sin vínculo (cascada HTTP)';
    await request(app)
        .put(`/api/register/${encodeURIComponent(standaloneName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 15000, evaluationLevel: 'Riesgo Bajo' });
    registerRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.ok(
        registerRes.body.risks.some((r) => r.riskName === standaloneName),
        'la entrada sin sourceRiskId debe sobrevivir intacta',
    );

    await request(app)
        .delete(`/api/register/${encodeURIComponent(standaloneName)}`)
        .set('X-API-Key', TEST_API_KEY);
});
