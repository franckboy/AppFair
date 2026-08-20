'use strict';

const express = require('express');
const {
    runMonteCarloSimulation,
    summarizeLosses,
    summarizeEventCounts,
    buildLossExceedanceCurve,
    FREQUENCY_MODELS,
} = require('../lib/simulation');
const { evaluateFairThreat, evaluateFairOpportunity } = require('../lib/evaluation');
const {
    sampleVulnerabilityFromProfiles,
    calculateInherentRiskFromSimulation,
    CALIBRATION_VERSION,
} = require('../lib/autocalc');
const { defaultRiskCriteria, lossFormsKeys, attackerProfiles, defenseProfiles } = require('../data/profiles');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../lib/riskCriteria');
const {
    validateTriangularRange,
    validateIterations,
    validateSeed,
    validateLossMagnitudes,
    validateFrequencyModel,
} = require('../lib/validate');
const { asyncHandler } = require('../middleware/asyncHandler');

// La app solo calcula en USD (ver la nota equivalente en register.js/assets.js) — no toma
// moneda del body, para no reabrir la puerta a mezclar monedas sin convertir en el Pareto/mapa
// de calor consolidado.
function makeCurrencyFormatter() {
    const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return (value) => fmt.format(value);
}

/**
 * Validación compartida de los inputs de una corrida Monte Carlo, más la resolución del muestreo
 * de Vulnerabilidad por perfiles. La usan POST /api/simulate y POST /api/simulate/frequency-models,
 * que reciben exactamente el mismo body (el segundo solo lo corre dos veces, una por modelo).
 * @returns {{error: string}|{sampleVuln: Function|undefined}}
 */
function validateSimulationInputs(body) {
    const {
        iterations = 10000,
        seed = 0,
        tef,
        vuln,
        attackerKey,
        defenseKey,
        confidence = 'medio',
        accessLevel,
        vulnManualOverride = false,
        lossMagnitudes = {},
        frequencyModel,
    } = body;

    const error =
        validateIterations(iterations) ||
        validateSeed(seed) ||
        validateTriangularRange(tef, 'tef') ||
        validateTriangularRange(vuln, 'vuln', { min: 0, max: 100 }) ||
        validateLossMagnitudes(lossMagnitudes, lossFormsKeys) ||
        validateFrequencyModel(frequencyModel, FREQUENCY_MODELS);
    if (error) return { error };

    // Si vienen attackerKey/defenseKey, deben ser válidos (400 si no) — a diferencia de
    // cuando faltan del todo (undefined), que es el caso normal de retrocompatibilidad y
    // simplemente cae al camino legado, esto es un error real del cliente.
    let sampleVuln;
    if (attackerKey !== undefined || defenseKey !== undefined) {
        const attackerProfile = attackerProfiles[attackerKey];
        const defenseProfile = defenseProfiles[defenseKey];
        if (!attackerProfile || !defenseProfile) {
            return { error: 'attackerKey o defenseKey inválido.' };
        }
        if (!vulnManualOverride) {
            sampleVuln = sampleVulnerabilityFromProfiles(attackerProfile, defenseProfile, confidence, accessLevel);
        }
    }
    return { sampleVuln };
}

function createSimulateRouter(store) {
    const router = express.Router();

    /**
     * POST /api/simulate
     * Body:
     *  - iterations: number (default 10000)
     *  - seed: number (0 = aleatoria)
     *  - tef: { min, mode, max }
     *  - vuln: { min, mode, max }  (en %, 0-100) — sigue siendo obligatorio (ver sampleVuln en
     *    runMonteCarloSimulation) aunque no se use para muestrear cuando aplica el camino nuevo
     *    de abajo, para no tener que tocar esta validación.
     *  - attackerKey, defenseKey, confidence, vulnManualOverride: (opcionales) si vienen los
     *    tres primeros Y vulnManualOverride no es true, la Vulnerabilidad se SIMULA por
     *    iteración (Capacidad de Amenaza vs. Fuerza de Resistencia, ver
     *    sampleVulnerabilityFromProfiles en lib/autocalc.js) en vez de muestrear del `vuln` fijo
     *    de arriba. Sin ellos (riesgos guardados antes de este cambio, o con Vulnerabilidad
     *    editada a mano), cae al camino de siempre — retrocompatible al 100%.
     *  - lossMagnitudes: { [key]: { min, mode, max } }  — claves de lossFormsKeys
     *  - riskType: 'amenaza' | 'oportunidad'
     *  - riskCriteria: (opcional) sobreescribe los criterios guardados para esta corrida
     *
     * La respuesta incluye `summary.inherentALE`/`summary.inherentCVaR` — el Riesgo Inherente
     * REAL (Vulnerabilidad 100%, sin ningún control), re-simulado con
     * calculateInherentRiskFromSimulation (lib/autocalc.js), NO una aproximación algebraica.
     * `null` para riskType 'oportunidad' (una Oportunidad es un beneficio esperado, no una
     * pérdida — no tiene un "Riesgo Inherente" con el mismo sentido, mismo criterio que ya
     * excluye 'oportunidad' de calculateParetoAnalysis/calculateResidualPortfolio).
     */
    router.post(
        '/',
        asyncHandler(async (req, res) => {
            const {
                iterations = 10000,
                seed = 0,
                tef,
                vuln,
                lossMagnitudes = {},
                riskType = 'amenaza',
                riskCriteria,
                frequencyModel,
            } = req.body;

            const validated = validateSimulationInputs(req.body);
            if (validated.error) return res.status(400).json({ error: validated.error });
            const { sampleVuln } = validated;

            // El global se resuelve SIEMPRE (haya o no override) porque validateRiskCriteriaOverride
            // necesita el ALE Crítico global real para exigir que un override individual nunca lo
            // supere ("mi máximo global es $1M, pero para este riesgo mi máximo es $2M" se
            // contradice a sí mismo — el override solo puede ser igual o más restrictivo).
            // normalizeRiskCriteria migra cualquier criterio guardado ANTES de que existiera
            // aleAceptablePercent (formato viejo, en dólares) — sin eso, aleAceptable sale NaN y
            // todo se clasifica como "Aceptable" en silencio, sin importar la severidad real.
            const globalCriteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);

            // riskCriteria (si viene) es un override explícito para ESTA corrida — se valida
            // antes de usarlo porque, a diferencia de PUT /api/config/criteria, nada más lo
            // revisa (ver validateRiskCriteriaOverride).
            const overrideError = validateRiskCriteriaOverride(riskCriteria, globalCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            const criteria = normalizeRiskCriteria(riskCriteria || globalCriteria);
            const formatCurrency = makeCurrencyFormatter();

            const {
                annualLosses,
                usedSeed,
                sensitivity,
                eventCounts,
                frequencyModel: usedFrequencyModel,
            } = runMonteCarloSimulation({
                iterations,
                seed,
                tef,
                vuln,
                lossMagnitudes,
                sampleVuln,
                frequencyModel,
            });

            const summary = summarizeLosses(annualLosses, criteria.aleUmbralExcedencia);

            const evaluation =
                riskType === 'oportunidad'
                    ? evaluateFairOpportunity(summary.average, criteria, formatCurrency)
                    : evaluateFairThreat(summary.average, summary.cvar95, criteria, formatCurrency);

            // Riesgo Inherente REAL (sin ningún control) — solo tiene sentido para Amenaza, mismo
            // criterio que evaluateFairOpportunity/evaluateFairThreat de arriba.
            const inherent =
                riskType === 'oportunidad'
                    ? { inherentALE: null, inherentCVaR: null }
                    : calculateInherentRiskFromSimulation(tef, lossMagnitudes);

            // Clasifica el Riesgo Inherente contra los MISMOS Criterios de Riesgo que ya
            // clasifican el actual (evaluateFairThreat) — bug real corregido: antes esto se
            // reimplementaba en el frontend (App.FairRegister.classifyAleAgainstCriteria), una
            // copia que solo miraba `ale` y nunca `cvar95` — así que el caso de "Crítico por cola
            // de riesgo" (cvar95 > aleCritico aunque ale no lo supere, ver evaluateFairThreat más
            // arriba) podía clasificar el Inherente de forma más optimista de lo real. Se calcula
            // una sola vez aquí y se persiste (ver PUT /api/register), para que el frontend nunca
            // tenga que reimplementar el banding — misma filosofía que POST /api/simulate/evaluate.
            const inherentEvaluation =
                riskType === 'oportunidad'
                    ? null
                    : evaluateFairThreat(inherent.inherentALE, inherent.inherentCVaR, criteria, formatCurrency);

            res.json({
                usedSeed,
                iterations,
                currency: 'USD',
                riskType,
                // Modelo de frecuencia que produjo estas cifras (ver frequencyModel en
                // lib/simulation.js) — se devuelve siempre, también cuando el cliente no pidió
                // ninguno, para que nunca haya que adivinar con qué modelo se calculó un número.
                frequencyModel: usedFrequencyModel,
                // Sello del modelo de Vulnerabilidad que produjo estos números (ver
                // CALIBRATION_VERSION en lib/autocalc.js). El frontend lo reenvía
                // tal cual al Registro, así cada riesgo guardado sabe con qué calibración se
                // calculó y la app puede avisar cuáles quedaron desactualizados.
                calibrationVersion: CALIBRATION_VERSION,
                summary: {
                    average: summary.average,
                    median: summary.median,
                    min: summary.min,
                    max: summary.max,
                    p90: summary.p90,
                    cvar95: summary.cvar95,
                    probExceedance: summary.probExceedance,
                    // Qué porcentaje de los años simulados no costó nada — ver summarizeLosses. Sin
                    // esto, un P90 de $0 (normal en un riesgo raro con el modelo compuesto) se ve
                    // como un error de la app en vez de como la respuesta que es.
                    zeroLossYearsPercent: summary.zeroLossYearsPercent,
                    // Cuánto ruido de MUESTREO le queda a cada cifra por haber corrido N escenarios
                    // en vez de infinitos (ver summarizeLosses). El motor los calculaba desde hacía
                    // tiempo y no salían de la librería: dos corridas del mismo riesgo con semillas
                    // distintas podían mover el CVaR un 5 % y eso se leía como un bug de la app en
                    // vez de como lo que es. El del CVaR va aparte porque no es el mismo número: en
                    // un riesgo raro casi todos los años valen 0 y no aportan, así que la muestra
                    // útil es n·(1−e^−LEF) y no n.
                    standardError: summary.standardError,
                    standardErrorPercent: summary.standardErrorPercent,
                    cvar95StandardError: summary.cvar95StandardError,
                    cvar95StandardErrorPercent: summary.cvar95StandardErrorPercent,
                    exceedanceThreshold: criteria.aleUmbralExcedencia,
                    inherentALE: inherent.inherentALE,
                    inherentCVaR: inherent.inherentCVaR,
                },
                evaluation,
                // Clasificación del Riesgo Inherente (ver el comentario junto a inherentEvaluation
                // arriba) — null para Oportunidad, igual que inherentALE/inherentCVaR.
                inherentEvaluation,
                sensitivity: sensitivity.slice(0, 10),
                // Cuántos ataques prosperaron, no cuánto costaron (ver summarizeEventCounts). El
                // motor ya sorteaba este conteo y lo tiraba: todo lo que la app mostraba estaba en
                // dinero. `null` con el modelo 'expected', donde la pregunta no tiene respuesta.
                events: summarizeEventCounts(eventCounts),
                // Curva de Excedencia de Pérdidas (ver buildLossExceedanceCurve): ~34 puntos, lo
                // bastante compacta para guardarse en el Registro y volver a dibujarse sin
                // re-simular — a diferencia de annualLosses, que se manda pero no se persiste.
                lossExceedanceCurve: buildLossExceedanceCurve(annualLosses),
                // La del Riesgo Inherente (sin ningún control) para poder superponerlas. null en
                // Oportunidad, igual que el resto de los campos inherentes.
                inherentLossExceedanceCurve: inherent.inherentLossExceedanceCurve || null,
                // El arreglo completo de pérdidas se regresa aparte (puede ser grande) para que el
                // cliente decida si lo necesita, ej. para la estrategia de Transferir/Seguro.
                annualLosses,
            });
        }),
    );

    /**
     * POST /api/simulate/evaluate — clasifica un ALE/CVaR95 YA CONOCIDO contra los Criterios de
     * Riesgo, sin volver a correr Monte Carlo. Pensado para reclasificar el Residual Canónico de
     * un riesgo ya tratado (ver App.RiskManagement.renderResidualStatus, Gestión de Riesgos) —
     * misma lógica de evaluateFairThreat que ya usa POST /api/simulate para el riesgo inherente,
     * nunca reimplementada en el frontend (una sola fuente de verdad para los umbrales).
     * Body: { ale: number, cvar95: number, riskCriteriaOverride: (opcional) }
     */
    router.post(
        '/evaluate',
        asyncHandler(async (req, res) => {
            const { ale, cvar95, riskCriteriaOverride } = req.body;

            if (typeof ale !== 'number' || typeof cvar95 !== 'number') {
                return res.status(400).json({ error: 'ale y cvar95 (números) son requeridos.' });
            }

            const globalCriteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);
            const overrideError = validateRiskCriteriaOverride(riskCriteriaOverride, globalCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            // riskCriteriaOverride es PARCIAL (solo aleAceptablePercent/aleCritico propios de
            // este riesgo, ver entry.riskCriteriaOverride en register.js) — se combina con el
            // global igual que ya hace PUT /api/register, nunca se reemplaza entero.
            const criteria = riskCriteriaOverride ? { ...globalCriteria, ...riskCriteriaOverride } : globalCriteria;
            const formatCurrency = makeCurrencyFormatter();

            res.json({ evaluation: evaluateFairThreat(ale, cvar95, criteria, formatCurrency) });
        }),
    );

    /**
     * POST /api/simulate/frequency-models — corre el MISMO riesgo con los dos modelos de
     * frecuencia (ver frequencyModel en lib/simulation.js) y devuelve ambos resultados lado a lado.
     * Mismo body que POST /api/simulate (se ignora `frequencyModel` si viene: acá se usan los dos).
     *
     * Las dos corridas comparten la semilla a propósito. Así la diferencia que se ve es el MODELO y
     * no el ruido de muestreo — el mismo criterio pareado que ya usa simulateResidualPortfolio para
     * comparar el portafolio actual contra el residual.
     *
     * Es una herramienta de DIAGNÓSTICO: no guarda nada, no cambia ninguna cifra del Registro. Está
     * para poder mirar los dos modelos sobre datos reales antes de decidir cuál debe ser el default.
     */
    router.post(
        '/frequency-models',
        asyncHandler(async (req, res) => {
            const { iterations = 10000, seed = 0, tef, vuln, lossMagnitudes = {}, riskCriteria } = req.body;

            // El modelo compuesto es el caro de los dos, así que su tope de TEF manda para la
            // comparación entera — se valida como si se hubiera pedido explícitamente.
            const validated = validateSimulationInputs({ ...req.body, frequencyModel: 'compound' });
            if (validated.error) return res.status(400).json({ error: validated.error });
            const { sampleVuln } = validated;

            const globalCriteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);
            const overrideError = validateRiskCriteriaOverride(riskCriteria, globalCriteria);
            if (overrideError) return res.status(400).json({ error: overrideError });
            const criteria = normalizeRiskCriteria(riskCriteria || globalCriteria);

            // La semilla se fija ANTES de las dos corridas (0 = "elige una" solo se resuelve una
            // vez) — es lo que hace que la comparación sea pareada y no dos corridas distintas.
            const sharedSeed = seed && seed > 0 ? seed : Math.floor(Math.random() * 2147483647);
            const base = { iterations, seed: sharedSeed, tef, vuln, lossMagnitudes, sampleVuln };

            const expected = runMonteCarloSimulation({ ...base, frequencyModel: 'expected' });
            const compound = runMonteCarloSimulation({ ...base, frequencyModel: 'compound' });

            const expectedSummary = summarizeLosses(expected.annualLosses, criteria.aleUmbralExcedencia);
            const compoundSummary = summarizeLosses(compound.annualLosses, criteria.aleUmbralExcedencia);

            // Cuántos años trajeron 0, 1, 2... eventos. Es la lectura que el modelo actual no puede
            // dar (ahí todos los años traen "LEF eventos", con decimales) y la que hace evidente por
            // qué la cola cambia: la pérdida no llega repartida, llega junta o no llega.
            const maxEventsInAYear = compound.eventCounts.reduce((a, b) => Math.max(a, b), 0);
            const yearsByEventCount = new Array(maxEventsInAYear + 1).fill(0);
            compound.eventCounts.forEach((n) => yearsByEventCount[n]++);

            const relativo = (nuevo, viejo) => (viejo > 0 ? (nuevo / viejo - 1) * 100 : null);

            res.json({
                usedSeed: sharedSeed,
                iterations,
                currency: 'USD',
                exceedanceThreshold: criteria.aleUmbralExcedencia,
                models: {
                    expected: {
                        summary: expectedSummary,
                        lossExceedanceCurve: buildLossExceedanceCurve(expected.annualLosses),
                    },
                    compound: {
                        summary: compoundSummary,
                        lossExceedanceCurve: buildLossExceedanceCurve(compound.annualLosses),
                        zeroLossYearsPercent: (yearsByEventCount[0] / iterations) * 100,
                        maxEventsInAYear,
                        eventCountDistribution: yearsByEventCount.map((years, events) => ({ events, years })),
                    },
                },
                // El compuesto menos el actual, en %. El ALE debe salir cerca de 0 (los dos modelos
                // tienen la MISMA media por construcción, E[N]×E[M] = LEF×E[M]) — lo que se mira acá
                // es cuánto se mueven la cola y el P90, que es lo único que el modelo cambia.
                delta: {
                    alePercent: relativo(compoundSummary.average, expectedSummary.average),
                    cvar95Percent: relativo(compoundSummary.cvar95, expectedSummary.cvar95),
                    p90Percent: relativo(compoundSummary.p90, expectedSummary.p90),
                },
            });
        }),
    );

    return router;
}

module.exports = createSimulateRouter;
