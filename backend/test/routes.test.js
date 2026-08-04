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
        'cadena-suministro', 'humano', 'natural', 'operacional', 'tecnologico',
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
    const body = { rrtBands: { medio: 20, alto: 40, critico: 60 }, aleAceptable: 1000, aleCritico: 5000, aleUmbralExcedencia: 2000 };
    const putRes = await request(app).put('/api/config/criteria').set('X-API-Key', TEST_API_KEY).send(body);
    assert.strictEqual(putRes.status, 200);

    const getRes = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.rrtBands.alto, 40);
});

test('PUT /api/config/org-defaults guarda solo los campos enviados, conserva el resto', async () => {
    const putRes = await request(app).put('/api/config/org-defaults').set('X-API-Key', TEST_API_KEY).send({ owner: 'QA HTTP' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.owner, 'QA HTTP');
    assert.strictEqual(putRes.body.currency, 'USD'); // valor por defecto, no se mandó pero se conserva
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
        .send({ items: [{ key: 'respuesta', mode: 50000 }, { key: 'multas', mode: 20000 }], confidence: 'bajo' });
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
        .send({ ale: 50000, cvar95: 90000, evaluationLevel: 'Aceptable', evaluationJustification: 'prueba automatizada' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.riskName, riskName);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.status, 200);
    assert.ok(getRes.body.risks.some((r) => r.riskName === riskName));
    assert.ok(getRes.body.pareto, 'con al menos un riesgo guardado, debe venir el análisis de Pareto');

    const delRes = await request(app).delete(`/api/register/${encodeURIComponent(riskName)}`).set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    const getRes2 = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.ok(!getRes2.body.risks.some((r) => r.riskName === riskName));
});

test('PUT /api/register/:riskName sin ale (número) responde 400', async () => {
    const res = await request(app).put('/api/register/Riesgo%20Incompleto').set('X-API-Key', TEST_API_KEY).send({});
    assert.strictEqual(res.status, 400);
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
    assert.ok(!getRes.body.pareto.risks.some((r) => r.riskName === riskName),
        'la oportunidad no debe aparecer en el Pareto (su "ale" es un beneficio, no una pérdida)');

    await request(app).delete(`/api/register/${encodeURIComponent(riskName)}`).set('X-API-Key', TEST_API_KEY);
});
