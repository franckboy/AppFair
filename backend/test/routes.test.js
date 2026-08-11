'use strict';

// Pruebas de integración de las rutas HTTP — a diferencia de lib.test.js (que solo prueba el
// motor de cálculo puro), estas sí levantan la app Express real y verifican autenticación,
// validación, códigos de estado y contratos de request/response.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const request = require('supertest');
const { timingSafeEqualStrings } = require('../src/middleware/apiKeyAuth');

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

test('timingSafeEqualStrings: la key correcta coincide consigo misma', () => {
    assert.strictEqual(timingSafeEqualStrings(TEST_API_KEY, TEST_API_KEY), true);
});

test('timingSafeEqualStrings: mismo largo, contenido distinto -> false', () => {
    assert.strictEqual(timingSafeEqualStrings('aaaaaaaaaa', 'aaaaaaaaab'), false);
});

test('timingSafeEqualStrings: largos distintos -> false (sin tronar por el RangeError de crypto.timingSafeEqual)', () => {
    assert.strictEqual(timingSafeEqualStrings('corta', 'una-key-mucho-mas-larga-que-la-otra'), false);
    assert.strictEqual(timingSafeEqualStrings('', TEST_API_KEY), false);
});

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

test('GET /api/config/profiles trae el catálogo de normas/marcos (hazardStandards/isoProcessClauses/rimsClauses)', async () => {
    const res = await request(app).get('/api/config/profiles').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.hazardStandards['ISO 31000'].description.length > 0);
    assert.ok(res.body.isoProcessClauses['6.5'].title.length > 0);
    assert.ok(res.body.rimsClauses['5.2'].title.length > 0);
});

test('PUT /api/config/criteria rechaza bandas no crecientes con 400', async () => {
    const res = await request(app)
        .put('/api/config/criteria')
        .set('X-API-Key', TEST_API_KEY)
        .send({ rrtBands: { medio: 50, alto: 25, critico: 75 }, aleAceptablePercent: 20, aleCritico: 2 });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/config/criteria rechaza aleAceptablePercent fuera de 0-100 con 400', async () => {
    const res = await request(app)
        .put('/api/config/criteria')
        .set('X-API-Key', TEST_API_KEY)
        .send({ rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptablePercent: 150, aleCritico: 1000 });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/config/criteria guarda y un GET posterior refleja el cambio', async () => {
    const body = {
        rrtBands: { medio: 20, alto: 40, critico: 60 },
        aleAceptablePercent: 20,
        aleCritico: 5000,
        aleUmbralExcedencia: 2000,
    };
    const putRes = await request(app).put('/api/config/criteria').set('X-API-Key', TEST_API_KEY).send(body);
    assert.strictEqual(putRes.status, 200);

    const getRes = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.rrtBands.alto, 40);
    // declared:true lo usa el candado obligatorio de primer uso (App.Criteria.isComplete()) para
    // saber que esto ya no es el default heredado del código — ver la prueba de abajo para el
    // caso contrario (nada guardado todavía).
    assert.strictEqual(putRes.body.declared, true);
    assert.strictEqual(getRes.body.declared, true);
});

// Candado obligatorio de primer uso (ver App.Criteria.showGate en el frontend): mientras nadie
// haya guardado sus propios criterios, GET debe avisar declared:false — de lo contrario el gate
// no sabría que todavía está corriendo sobre defaultRiskCriteria ($250,000/20%, un número que
// nadie eligió). Manipula el store directo para simular una instalación recién arrancada.
test('GET /api/config/criteria responde declared:false cuando nadie ha guardado sus propios criterios', async () => {
    const { JsonStore } = require('../src/store/jsonStore');
    const rawStore = new JsonStore();
    await rawStore.set('riskCriteria', null);

    const res = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.declared, false);

    await rawStore.set('riskCriteria', {
        rrtBands: { medio: 20, alto: 40, critico: 60 },
        aleAceptablePercent: 20,
        aleCritico: 5000,
        aleUmbralExcedencia: 2000,
    });
});

// Un criterio guardado ANTES de que existiera "Pérdida Anual Aceptable (%)" (formato viejo, con
// aleAceptable en dólares) sigue en Postgres si el despliegue ya lo había guardado — sin migrar,
// aleAceptablePercent llega undefined y evaluateFairThreat clasifica TODO como "Aceptable" en
// silencio (comparar contra NaN siempre da false en JS). Manipula el store directo (no hay forma
// de crear ese formato viejo a través de PUT, que ya exige aleAceptablePercent) para simular una
// instalación que se actualizó con datos previos.
test('GET /api/config/criteria migra un criterio guardado en formato viejo (aleAceptable en dólares) a aleAceptablePercent', async () => {
    const { JsonStore } = require('../src/store/jsonStore');
    const rawStore = new JsonStore();
    await rawStore.set('riskCriteria', {
        rrtBands: { medio: 25, alto: 50, critico: 75 },
        aleAceptable: 50000,
        aleCritico: 250000,
        aleUmbralExcedencia: 100000,
    });

    const res = await request(app).get('/api/config/criteria').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.aleAceptablePercent, 20); // 50000/250000*100

    // Restaura un estado válido (formato nuevo) para no dejar el store en un estado raro para
    // las pruebas que corren después de esta.
    await rawStore.set('riskCriteria', {
        rrtBands: { medio: 20, alto: 40, critico: 60 },
        aleAceptablePercent: 20,
        aleCritico: 5000,
        aleUmbralExcedencia: 2000,
    });
});

test('POST /api/simulate con criterios guardados en formato viejo NO clasifica todo como Aceptable (regresión NaN)', async () => {
    const { JsonStore } = require('../src/store/jsonStore');
    const rawStore = new JsonStore();
    await rawStore.set('riskCriteria', {
        rrtBands: { medio: 25, alto: 50, critico: 75 },
        aleAceptable: 50000,
        aleCritico: 250000,
        aleUmbralExcedencia: 100000,
    });

    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 200,
            seed: 1,
            tef: { min: 10, mode: 15, max: 20 },
            vuln: { min: 80, mode: 90, max: 100 },
            lossMagnitudes: { respuesta: { min: 900000, mode: 1000000, max: 1100000 } },
        });
    assert.strictEqual(res.status, 200);
    assert.notStrictEqual(res.body.evaluation.level, 'Aceptable');
    assert.notStrictEqual(res.body.evaluation.severity, 'bajo');

    await rawStore.set('riskCriteria', {
        rrtBands: { medio: 20, alto: 40, critico: 60 },
        aleAceptablePercent: 20,
        aleCritico: 5000,
        aleUmbralExcedencia: 2000,
    });
});

test('POST /api/simulate rechaza un riskCriteria override con aleAceptablePercent fuera de rango con 400', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 50,
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 1, mode: 2, max: 3 },
            riskCriteria: {
                rrtBands: { medio: 25, alto: 50, critico: 75 },
                aleAceptablePercent: 200,
                aleCritico: 1000,
            },
        });
    assert.strictEqual(res.status, 400);
});

test('POST /api/simulate rechaza un riskCriteria override con aleCritico <= 0 con 400', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 50,
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 1, mode: 2, max: 3 },
            riskCriteria: { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptablePercent: 20, aleCritico: -10 },
        });
    assert.strictEqual(res.status, 400);
});

// El global vigente en el store, en este punto de la corrida, quedó en aleCritico: 5000 (ver la
// prueba de migración más arriba, que restaura ese valor al terminar). Un override individual
// nunca puede pedir un techo más alto que el global — "mi máximo global es $5,000, pero para
// este riesgo mi máximo es $6,000" se contradice a sí mismo.
test('POST /api/simulate rechaza un riskCriteria override con aleCritico MAYOR al global con 400', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 50,
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 1, mode: 2, max: 3 },
            riskCriteria: { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptablePercent: 20, aleCritico: 6000 },
        });
    assert.strictEqual(res.status, 400);
});

test('POST /api/simulate acepta un riskCriteria override con aleCritico igual o menor al global', async () => {
    const res = await request(app)
        .post('/api/simulate')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            iterations: 50,
            seed: 1,
            tef: { min: 1, mode: 2, max: 3 },
            vuln: { min: 1, mode: 2, max: 3 },
            riskCriteria: { rrtBands: { medio: 25, alto: 50, critico: 75 }, aleAceptablePercent: 20, aleCritico: 5000 },
        });
    assert.strictEqual(res.status, 200);
});

// --- POST /api/simulate/evaluate (reclasifica un ALE/CVaR95 ya conocido, sin Monte Carlo —
// usado por Gestión de Riesgos para reclasificar el Residual Canónico de un riesgo tratado) ---

test('POST /api/simulate/evaluate clasifica contra los Criterios de Riesgo (Crítico vs. Aceptable)', async () => {
    // Los Criterios globales son estado compartido entre tests de este archivo (sin
    // aislamiento, ver la nota al inicio del archivo) — se fuerza un riskCriteriaOverride
    // propio en vez de asumir el default, para que este test sea determinista sin importar qué
    // haya guardado un test anterior.
    const override = { aleAceptablePercent: 20, aleCritico: 1000 }; // aleAceptable=200
    const critico = await request(app)
        .post('/api/simulate/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 2000, cvar95: 2000, riskCriteriaOverride: override });
    assert.strictEqual(critico.status, 200);
    assert.strictEqual(critico.body.evaluation.severity, 'critico');

    const aceptable = await request(app)
        .post('/api/simulate/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 100, cvar95: 100, riskCriteriaOverride: override });
    assert.strictEqual(aceptable.status, 200);
    assert.strictEqual(aceptable.body.evaluation.level, 'Aceptable');
});

test('POST /api/simulate/evaluate combina un riskCriteriaOverride PARCIAL con el global, no lo reemplaza entero', async () => {
    // Override solo trae aleCritico (1000) — aleAceptablePercent debe seguir siendo el global
    // (20%): aleAceptable=200, aleMedio=600. ale=800 cae en la banda Alta.
    const res = await request(app)
        .post('/api/simulate/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 800, cvar95: 800, riskCriteriaOverride: { aleCritico: 1000 } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.evaluation.severity, 'alto');
});

test('POST /api/simulate/evaluate rechaza un riskCriteriaOverride.aleCritico mayor al global con 400', async () => {
    const res = await request(app)
        .post('/api/simulate/evaluate')
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 800, cvar95: 800, riskCriteriaOverride: { aleCritico: 999999999 } });
    assert.strictEqual(res.status, 400);
});

test('POST /api/simulate/evaluate sin ale/cvar95 numéricos responde 400', async () => {
    const res = await request(app).post('/api/simulate/evaluate').set('X-API-Key', TEST_API_KEY).send({ ale: 100 });
    assert.strictEqual(res.status, 400);
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
        .send({ attackerKey: 'organizado', currentDefenseKey: 'avanzada', targetDefenseKey: 'basica' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.reductionPercent, 0);
});

test('POST /api/autocalc/reduccion-ale: mejorar la defensa (mismo atacante) da reducción positiva', async () => {
    const res = await request(app)
        .post('/api/autocalc/reduccion-ale')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'organizado', currentDefenseKey: 'basica', targetDefenseKey: 'elite' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.reductionPercent > 0, `esperaba reducción positiva, dio ${res.body.reductionPercent}`);
});

test('POST /api/autocalc/reduccion-ale: sin attackerKey responde 400 (antes era opcional, ahora es obligatorio)', async () => {
    const res = await request(app)
        .post('/api/autocalc/reduccion-ale')
        .set('X-API-Key', TEST_API_KEY)
        .send({ currentDefenseKey: 'avanzada', targetDefenseKey: 'basica' });
    assert.strictEqual(res.status, 400);
});

test('POST /api/autocalc/nash-equilibrium con datos válidos responde 200 con esfuerzos y vulnerabilidad en rango', async () => {
    const res = await request(app)
        .post('/api/autocalc/nash-equilibrium')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            attackerKey: 'organizado',
            defenseKey: 'estandar',
            m: 1,
            costAttacker: 500,
            costDefense: 500,
            lossMagnitudes: { respuesta: { min: 5000, mode: 20000, max: 50000 } },
        });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.attackerEffort >= 0 && res.body.attackerEffort <= 100);
    assert.ok(res.body.defenseEffort >= 0 && res.body.defenseEffort <= 100);
    assert.ok(res.body.equilibriumVulnerability >= 0 && res.body.equilibriumVulnerability <= 100);
    assert.ok(res.body.fixedEffortVulnerability >= 0 && res.body.fixedEffortVulnerability <= 100);
    assert.strictEqual(res.body.valueAtStake, 20000);
    assert.strictEqual(res.body.converged, true);
});

test('POST /api/autocalc/nash-equilibrium con attackerKey/defenseKey inválido responde 400', async () => {
    const res = await request(app)
        .post('/api/autocalc/nash-equilibrium')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'no-existe', defenseKey: 'estandar', costAttacker: 500, costDefense: 500 });
    assert.strictEqual(res.status, 400);
});

test('POST /api/autocalc/nash-equilibrium con m <= 0 responde 400', async () => {
    const res = await request(app)
        .post('/api/autocalc/nash-equilibrium')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'organizado', defenseKey: 'estandar', m: 0, costAttacker: 500, costDefense: 500 });
    assert.strictEqual(res.status, 400);
});

test('POST /api/autocalc/nash-equilibrium sin costAttacker/costDefense responde 400', async () => {
    const res = await request(app)
        .post('/api/autocalc/nash-equilibrium')
        .set('X-API-Key', TEST_API_KEY)
        .send({ attackerKey: 'organizado', defenseKey: 'estandar' });
    assert.strictEqual(res.status, 400);
});

test('POST /api/autocalc/nash-equilibrium con una categoría de Magnitud de Pérdida no reconocida responde 400', async () => {
    const res = await request(app)
        .post('/api/autocalc/nash-equilibrium')
        .set('X-API-Key', TEST_API_KEY)
        .send({
            attackerKey: 'organizado',
            defenseKey: 'estandar',
            costAttacker: 500,
            costDefense: 500,
            lossMagnitudes: { noExiste: { min: 1, mode: 2, max: 3 } },
        });
    assert.strictEqual(res.status, 400);
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

test('PUT /api/register/:riskName con riskCriteriaOverride lo persiste y lo usa para impactPercent', async () => {
    const riskName = 'Riesgo con criterio propio HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 500,
            cvar95: 800,
            evaluationLevel: 'Aceptable',
            riskCriteriaOverride: { aleAceptablePercent: 5, aleCritico: 1000 },
        });
    assert.strictEqual(putRes.status, 200);
    assert.deepStrictEqual(putRes.body.entry.riskCriteriaOverride, { aleAceptablePercent: 5, aleCritico: 1000 });
    assert.strictEqual(putRes.body.entry.impactPercent, 50); // 500/1000*100, no contra el aleCritico global

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

// Riesgo desencadenado creado desde el botón "+" del Árbol de Riesgos en Cascada (ver
// App.RiskCascadeTree.openCreateChildModal) — nace como stub (ale: 0, sin tef/vuln) hasta que
// alguien lo lleve al wizard y lo simule. triggeredByProbability es el dato que le falta a
// walkMarkovChain (lib/markov.js) para simular la cascada correlacionada más adelante.
test('PUT /api/register/:riskName persiste triggeredByRiskName y triggeredByProbability (riesgo en cascada)', async () => {
    const riskName = 'Daño reputacional HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 0,
            cvar95: 0,
            triggeredByRiskName: 'Incendio en bodega HTTP',
            triggeredByProbability: 40,
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.triggeredByRiskName, 'Incendio en bodega HTTP');
    assert.strictEqual(putRes.body.entry.triggeredByProbability, 40);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName persiste catalogStandard/catalogCode y reviewHistory (Marco Normativo)', async () => {
    const riskName = 'Sismo HTTP';
    const reviewHistory = [
        { date: '1 ene 2026', ale: '$10,000', evaluationLevel: 'Aceptable' },
        { date: '15 ene 2026', ale: '$12,000', evaluationLevel: 'Aceptable' },
    ];
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 10000,
            cvar95: 15000,
            catalogStandard: 'ISO 22301, NFPA 1600',
            catalogCode: 'NAT-GEO-001',
            reviewHistory,
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.catalogStandard, 'ISO 22301, NFPA 1600');
    assert.strictEqual(putRes.body.entry.catalogCode, 'NAT-GEO-001');
    assert.deepStrictEqual(putRes.body.entry.reviewHistory, reviewHistory);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const saved = getRes.body.risks.find((r) => r.riskName === riskName);
    assert.strictEqual(saved.catalogStandard, 'ISO 22301, NFPA 1600');
    assert.deepStrictEqual(saved.reviewHistory, reviewHistory);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName sin catalogStandard/reviewHistory guarda null/[] por defecto', async () => {
    const riskName = 'Riesgo sin catalogo HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 5000, cvar95: 8000 });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.catalogStandard, null);
    assert.strictEqual(putRes.body.entry.catalogCode, null);
    assert.deepStrictEqual(putRes.body.entry.reviewHistory, []);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName persiste vulnManualOverride (true por defecto false, no se infiere)', async () => {
    const riskName = 'Robo con Vulnerabilidad editada a mano HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 15000, vulnManualOverride: true });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.vulnManualOverride, true);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const saved = getRes.body.risks.find((r) => r.riskName === riskName);
    assert.strictEqual(saved.vulnManualOverride, true);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName sin vulnManualOverride guarda false por defecto (autocalculado, no evidencia)', async () => {
    const riskName = 'Robo con Vulnerabilidad autocalculada HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 5000, cvar95: 8000 });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.vulnManualOverride, false);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName rechaza triggeredByProbability fuera de 0-100 con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo probabilidad inválida HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 0, triggeredByProbability: 150 });
    assert.strictEqual(res.status, 400);
});

// treatmentDecision: cuál de las 4 estrategias de Tratamiento se ADOPTÓ de verdad (a diferencia
// de mitigar/transferir/evitar/aceptarJustificacion, que son solo los insumos de las 4
// hipótesis comparadas en paralelo) + el ALE residual que de ahí resulta — ver
// App.Treatment.adoptStrategy.
test('PUT /api/register/:riskName persiste treatmentDecision y se lee de vuelta vía GET', async () => {
    const riskName = 'Robo en bodega HTTP (decisión)';
    const treatmentDecision = { strategy: 'mitigar', residualALE: 4200, decidedAt: '2026-01-15T00:00:00.000Z' };
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 15000, treatmentDecision });
    assert.strictEqual(putRes.status, 200);
    assert.deepStrictEqual(putRes.body.entry.treatmentDecision, treatmentDecision);

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const saved = getRes.body.risks.find((r) => r.riskName === riskName);
    assert.deepStrictEqual(saved.treatmentDecision, treatmentDecision);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName sin treatmentDecision guarda null por defecto', async () => {
    const riskName = 'Riesgo sin decisión de tratamiento HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 5000, cvar95: 8000 });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.treatmentDecision, null);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName rechaza treatmentDecision.strategy inválido con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo decisión inválida HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 0, treatmentDecision: { strategy: 'mitigarTransferir', residualALE: 100 } });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/register/:riskName rechaza treatmentDecision.residualALE negativo con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo residual negativo HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 0, treatmentDecision: { strategy: 'aceptar', residualALE: -1 } });
    assert.strictEqual(res.status, 400);
});

test('PUT /api/register/:riskName acepta treatmentDecision.residualCVaR (opcional) y lo persiste', async () => {
    const riskName = 'Robo en bodega HTTP (decisión con CVaR)';
    const treatmentDecision = {
        strategy: 'mitigar',
        residualALE: 4200,
        residualCVaR: 9800,
        decidedAt: '2026-01-15T00:00:00.000Z',
    };
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 25000, treatmentDecision });
    assert.strictEqual(putRes.status, 200);
    assert.deepStrictEqual(putRes.body.entry.treatmentDecision, treatmentDecision);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName acepta treatmentDecision sin residualCVaR (Transferir, o decisiones previas a este campo)', async () => {
    const riskName = 'Robo en bodega HTTP (decisión sin CVaR)';
    const treatmentDecision = { strategy: 'transferir', residualALE: 6000, decidedAt: '2026-01-15T00:00:00.000Z' };
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 10000, cvar95: 25000, treatmentDecision });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.treatmentDecision.residualCVaR, undefined);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName rechaza treatmentDecision.residualCVaR negativo con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo residual CVaR negativo HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 0, treatmentDecision: { strategy: 'aceptar', residualALE: 0, residualCVaR: -1 } });
    assert.strictEqual(res.status, 400);
});

// --- POST /api/cascade/:riskName/simulate-family ("Simular Familia" — conecta markov.js) ---

async function putAnalyzedRisk(riskName, overrides = {}) {
    return request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 1000,
            cvar95: 2000,
            riskType: 'amenaza',
            tef: { min: 5, mode: 8, max: 12 },
            vuln: { min: 40, mode: 50, max: 60 },
            lossMagnitudes: { productividad: { min: 20000, mode: 30000, max: 50000 } },
            ...overrides,
        });
}

test('POST /api/cascade/:riskName/simulate-family simula la familia correlacionada (raíz + hijo forzado)', async () => {
    const rootName = 'Incendio Cascada HTTP';
    const childName = 'Interrupcion Cascada HTTP';
    await putAnalyzedRisk(rootName);
    await putAnalyzedRisk(childName, {
        triggeredByRiskName: rootName,
        triggeredByProbability: 100, // se activa siempre, para que la prueba sea determinista
        lossMagnitudes: { productividad: { min: 10000, mode: 15000, max: 25000 } },
    });

    const res = await request(app)
        .post(`/api/cascade/${encodeURIComponent(rootName)}/simulate-family`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ iterations: 500, seed: 123 });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.familySize, 2);
    assert.deepStrictEqual([...res.body.includedRiskNames].sort(), [childName, rootName].sort());
    assert.strictEqual(res.body.activationRates[rootName], 100);
    assert.strictEqual(res.body.activationRates[childName], 100);
    assert.ok(res.body.summary.average > 0);
    assert.ok(res.body.evaluation && res.body.evaluation.level);
    assert.strictEqual(res.body.annualLosses.length, 500);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(rootName)}`)
        .set('X-API-Key', TEST_API_KEY);
    await request(app)
        .delete(`/api/register/${encodeURIComponent(childName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('POST /api/cascade/:riskName/simulate-family excluye un hijo "Sin analizar" pero no rompe la simulación', async () => {
    const rootName = 'Incendio Cascada Stub HTTP';
    const stubChildName = 'Dano Sin Analizar HTTP';
    await putAnalyzedRisk(rootName);
    await request(app)
        .put(`/api/register/${encodeURIComponent(stubChildName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 0, cvar95: 0, triggeredByRiskName: rootName, triggeredByProbability: 50 });

    const res = await request(app)
        .post(`/api/cascade/${encodeURIComponent(rootName)}/simulate-family`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ iterations: 200, seed: 5 });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.includedRiskNames, [rootName]);
    assert.strictEqual(res.body.excludedRiskNames.length, 1);
    assert.strictEqual(res.body.excludedRiskNames[0].riskName, stubChildName);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(rootName)}`)
        .set('X-API-Key', TEST_API_KEY);
    await request(app)
        .delete(`/api/register/${encodeURIComponent(stubChildName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('POST /api/cascade/:riskName/simulate-family responde 404 si la raíz no existe en el Registro', async () => {
    const res = await request(app)
        .post(`/api/cascade/${encodeURIComponent('Riesgo Que No Existe HTTP')}/simulate-family`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ iterations: 100 });
    assert.strictEqual(res.status, 404);
});

test('POST /api/cascade/:riskName/simulate-family rechaza iterations inválidas con 400', async () => {
    const rootName = 'Incendio Cascada Validacion HTTP';
    await putAnalyzedRisk(rootName);

    const res = await request(app)
        .post(`/api/cascade/${encodeURIComponent(rootName)}/simulate-family`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ iterations: -5 });
    assert.strictEqual(res.status, 400);

    await request(app)
        .delete(`/api/register/${encodeURIComponent(rootName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName rechaza un riskCriteriaOverride fuera de rango con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo override inválido HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 500, cvar95: 800, riskCriteriaOverride: { aleAceptablePercent: 20, aleCritico: -5 } });
    assert.strictEqual(res.status, 400);
});

// Global vigente en este punto: aleCritico 5000 (ver la prueba de migración de criterios más
// arriba). Un override cuyo ALE Crítico supera al global se contradice a sí mismo (ver la nota
// de validateRiskCriteriaOverride) y debe rechazarse, no guardarse en silencio.
test('PUT /api/register/:riskName rechaza un riskCriteriaOverride con aleCritico MAYOR al global con 400', async () => {
    const res = await request(app)
        .put(`/api/register/${encodeURIComponent('Riesgo override mayor al global HTTP')}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 500, cvar95: 800, riskCriteriaOverride: { aleAceptablePercent: 20, aleCritico: 6000 } });
    assert.strictEqual(res.status, 400);
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

test('PUT /api/register/:riskName guarda assetId (vínculo real con el Catálogo de Activos, no solo el nombre copiado en "asset")', async () => {
    const riskName = 'Riesgo con activo vinculado de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 50000, cvar95: 80000, evaluationLevel: 'Riesgo Medio', asset: 'Bodega 3', assetId: 'asset-xyz' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.assetId, 'asset-xyz');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(getRes.body.risks.find((r) => r.riskName === riskName).assetId, 'asset-xyz');

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName guarda attackerKey/defenseKey (identificadores internos para Tratamiento)', async () => {
    const riskName = 'Riesgo con attackerKey/defenseKey de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 50000,
            cvar95: 80000,
            evaluationLevel: 'Riesgo Medio',
            attackerKey: 'organizado',
            defenseKey: 'estandar',
        });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.attackerKey, 'organizado');
    assert.strictEqual(putRes.body.entry.defenseKey, 'estandar');

    const getRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const saved = getRes.body.risks.find((r) => r.riskName === riskName);
    assert.strictEqual(saved.attackerKey, 'organizado');
    assert.strictEqual(saved.defenseKey, 'estandar');

    await request(app)
        .delete(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY);
});

test('PUT /api/register/:riskName sin assetId lo guarda como null (riesgo sin activo del catálogo vinculado)', async () => {
    const riskName = 'Riesgo sin activo vinculado de prueba HTTP';
    const putRes = await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({ ale: 50000, cvar95: 80000, evaluationLevel: 'Riesgo Medio' });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.entry.assetId, null);

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

test('DELETE /api/assets/:id limpia el vínculo assetId de lo que lo referencie, sin borrar el riesgo', async () => {
    // Bug real: a diferencia de borrar un riesgo (que sí borra en cascada su entrada del
    // Registro vinculada), borrar un activo no limpiaba nada — una entrada del Registro (o un
    // borrador de Análisis Rápido todavía sin simular) se quedaba apuntando para siempre a un
    // activo que ya no existe (ver assetCascade.js).
    const assetRes = await request(app)
        .post('/api/assets')
        .set('X-API-Key', TEST_API_KEY)
        .send({ nombre: 'Bodega a Eliminar', valorEstimado: 100000 });
    const assetId = assetRes.body.entry.id;

    const riskName = 'Riesgo vinculado a activo eliminado';
    await request(app)
        .put(`/api/register/${encodeURIComponent(riskName)}`)
        .set('X-API-Key', TEST_API_KEY)
        .send({
            ale: 20000,
            cvar95: 30000,
            evaluationLevel: 'Aceptable',
            evaluationJustification: 'prueba automatizada',
            asset: 'Bodega a Eliminar',
            assetId,
        });

    const draftRes = await request(app)
        .post('/api/risks')
        .set('X-API-Key', TEST_API_KEY)
        .send({ name: 'Borrador vinculado a activo eliminado', fullData: { assetId } });
    const draftId = draftRes.body.entry.id;

    const delRes = await request(app).delete(`/api/assets/${assetId}`).set('X-API-Key', TEST_API_KEY);
    assert.strictEqual(delRes.status, 200);

    const registerRes = await request(app).get('/api/register').set('X-API-Key', TEST_API_KEY);
    const entry = registerRes.body.risks.find((r) => r.riskName === riskName);
    assert.ok(entry, 'la entrada del Registro NO debe borrarse, solo perder el vínculo');
    assert.strictEqual(entry.assetId, null);
    assert.strictEqual(entry.asset, 'Bodega a Eliminar', 'el nombre copiado (foto del momento) se conserva');

    const risksRes = await request(app).get('/api/risks').set('X-API-Key', TEST_API_KEY);
    const draft = risksRes.body.risks.find((r) => r.id === draftId);
    assert.ok(draft, 'el borrador NO debe borrarse, solo perder el vínculo');
    assert.strictEqual(draft.fullData.assetId, null);
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
