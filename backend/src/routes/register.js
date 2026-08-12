'use strict';

const express = require('express');
const {
    normalizeTriggeredBy,
    getRiskMatrixZones,
    calculateParetoAnalysis,
    calculateConsolidatedSensitivity,
    calculateResidualPortfolio,
    calculateResidualParetoAnalysis,
    calculateInherentPortfolio,
} = require('../lib/register');
const { evaluateFairThreat } = require('../lib/evaluation');
const { defaultRiskCriteria } = require('../data/profiles');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../lib/riskCriteria');
const { asyncHandler } = require('../middleware/asyncHandler');

// La app solo calcula en USD (ver la nota equivalente en simulate.js/assets.js).
function makeCurrencyFormatter() {
    const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
    return (value) => fmt.format(value);
}

function createRegisterRouter(store) {
    const router = express.Router();

    // GET /api/register — lista todos los riesgos guardados + análisis consolidado
    router.get(
        '/',
        asyncHandler(async (req, res) => {
            // normalizeTriggeredBy migra cualquier riesgo guardado ANTES de que triggeredBy
            // fuera un array (ver lib/register.js) — necesario acá porque la app tiene
            // despliegue real con riesgos ya guardados en la forma vieja.
            const risks = normalizeTriggeredBy((await store.get('riskRegister')) || []);
            // normalizeRiskCriteria migra cualquier criterio guardado ANTES de que existiera
            // aleAceptablePercent (ver PUT abajo) — hace falta acá también para poder llamar
            // evaluateFairThreat sobre el residual del portafolio con aleAceptablePercent/
            // aleCritico garantizados.
            const criteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);

            if (risks.length === 0) {
                return res.json({
                    risks: [],
                    pareto: null,
                    consolidatedSensitivity: [],
                    heatmapZones: getRiskMatrixZones(criteria.rrtBands),
                    residualPortfolio: null,
                    residualPareto: null,
                    inherentPortfolio: null,
                });
            }

            const pareto = calculateParetoAnalysis(risks);
            const consolidatedSensitivity = calculateConsolidatedSensitivity(risks);
            const residualPortfolio = calculateResidualPortfolio(risks);
            if (residualPortfolio.cvarRiskCount > 0) {
                residualPortfolio.evaluation = evaluateFairThreat(
                    residualPortfolio.totalResidualALE,
                    residualPortfolio.totalResidualCVaR,
                    criteria,
                    makeCurrencyFormatter(),
                );
            } else {
                residualPortfolio.evaluation = null;
            }
            const residualPareto = calculateResidualParetoAnalysis(risks);

            const inherentPortfolio = calculateInherentPortfolio(risks);
            if (inherentPortfolio.inherentRiskCount > 0 && inherentPortfolio.totalInherentCVaR !== null) {
                inherentPortfolio.evaluation = evaluateFairThreat(
                    inherentPortfolio.totalInherentALE,
                    inherentPortfolio.totalInherentCVaR,
                    criteria,
                    makeCurrencyFormatter(),
                );
            } else {
                inherentPortfolio.evaluation = null;
            }

            res.json({
                risks,
                pareto,
                consolidatedSensitivity,
                heatmapZones: getRiskMatrixZones(criteria.rrtBands),
                residualPortfolio,
                residualPareto,
                inherentPortfolio,
            });
        }),
    );

    /**
     * PUT /api/register/:riskName — guarda o actualiza un riesgo en el registro.
     * Se llama normalmente justo después de un /api/simulate exitoso, con su
     * resultado. Body esperado: { asset, owner, ale, cvar95, evaluationLevel,
     * evaluationJustification, probExceedance, sensitivity, securityPlan,
     * tef, vuln, lossMagnitudes, seed, riskType }
     */
    router.put(
        '/:riskName',
        asyncHandler(async (req, res) => {
            const riskName = req.params.riskName;
            // normalizeRiskCriteria migra cualquier criterio guardado ANTES de que existiera
            // aleAceptablePercent (formato viejo, en dólares) — ver backend/src/lib/riskCriteria.js.
            const criteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);
            const {
                asset = '—',
                // Vínculo real hacia el Catálogo de Activos (/api/assets), a diferencia de
                // `asset` (arriba), que es solo el nombre copiado en el momento de guardar —
                // permite reconocer qué riesgos referencian a un activo aunque el activo
                // cambie de nombre después. null si el riesgo no se armó desde el catálogo.
                assetId = null,
                owner = '—',
                ale,
                cvar95,
                evaluationLevel,
                evaluationClasses,
                severity = null,
                evaluationJustification,
                probExceedance = 0,
                sensitivity = [],
                // Resto del resumen de la simulación (antes solo se leía del DOM en el momento del
                // reporte individual) — necesarios para reconstruir la tabla de resultados completa
                // de cualquier riesgo del Registro, no solo ale/cvar95.
                median = null,
                min = null,
                max = null,
                p90 = null,
                // Riesgo Inherente REAL (sin ningún control, Vulnerabilidad 100%) — ver
                // calculateInherentRiskFromSimulation (lib/autocalc.js) y POST /api/simulate,
                // que ya lo calcula y manda dentro de `summary`. null para Oportunidad, o para
                // riesgos guardados ANTES de que existiera esto (se recalculan solos la próxima
                // vez que se vuelvan a simular — sin migración/backfill, mismo criterio que
                // vulnManualOverride).
                inherentALE = null,
                inherentCVaR = null,
                // Clasificación (Bajo/Medio/Alto/Crítico) del Riesgo Inherente — ver
                // POST /api/simulate, que ya la calcula (evaluateFairThreat) y manda dentro de
                // inherentEvaluation. Mismo criterio que inherentALE/inherentCVaR arriba: null
                // para Oportunidad, o para riesgos guardados antes de que existiera esto. Antes
                // el frontend reimplementaba este banding a mano (solo mirando inherentALE, nunca
                // inherentCVaR) — se persiste aquí para que nunca tenga que volver a hacerlo.
                inherentEvaluationLevel = null,
                inherentEvaluationClasses = null,
                inherentSeverity = null,
                securityPlan = '—',
                // tef/vuln/lossMagnitudes/seed son opcionales (un riesgo guardado antes de que
                // existiera esto no los trae) — se guardan tal cual para poder re-simular este
                // riesgo después desde el botón "Simular" del Registro, sin volver a pedirle los
                // datos al usuario. La reproducibilidad exacta la da la semilla (ver /api/simulate).
                tef = null,
                vuln = null,
                // Si `vuln` fue de verdad editado a mano (checkbox "Ajustar manualmente") o es
                // el resultado sin tocar de calculateVulnerability (autocalc.js) — antes solo
                // vivía en el borrador de localStorage (persistFairAnalysis), nunca llegaba
                // aquí. Sin esto no hay forma de distinguir, desde el Registro, un dato con
                // juicio real de un analista de uno puramente derivado de la fórmula — la
                // diferencia importa para cualquier calibración futura que use el Registro como
                // evidencia (ver tools/bayesian-calibration/).
                vulnManualOverride = false,
                lossMagnitudes = null,
                seed = null,
                // Antes no se guardaba nada: cada riesgo quedaba asumido como 'amenaza' para
                // siempre, sin importar qué se eligió en el wizard. Una 'oportunidad' (riesgo
                // positivo — su "ale" es en realidad un BENEFICIO esperado, no una pérdida) mezclada
                // sin distinguir en el Pareto/mapa de calor (que asumen "más alto = más urgente
                // tratar") terminaba graficada en la esquina "Crítico" y sumada a la "exposición
                // total", como si un beneficio grande fuera el peor riesgo del portafolio — ver
                // calculateParetoAnalysis, que ahora excluye 'oportunidad' de esa suma.
                riskType = 'amenaza',
                // Vínculo opcional hacia el riesgo de origen en /api/risks (Análisis Rápido) — permite
                // a la tabla concentrada del Registro reconocer que esta entrada FAIR es la
                // continuación del mismo riesgo, en vez de mostrarlo como dos filas separadas.
                sourceRiskId = null,
                // Apetito de Riesgo (Pérdida Anual Aceptable %/ALE Crítico) propio de este riesgo,
                // si el frontend definió uno para él (ver App.FairWizard.openCriteriaOverrideEditor)
                // — null usa los criterios globales de la organización, igual que antes de que
                // existiera esto. Afecta impactPercent (abajo), para que la posición de este riesgo
                // en la Matriz de Riesgos sea consistente con el criterio que en verdad se usó para
                // evaluarlo (ver POST /api/simulate, que ya acepta el mismo override para el cálculo).
                riskCriteriaOverride = null,
                // Riesgos en cascada: cada item es OTRO riesgo del Registro que, de ocurrir,
                // puede desencadenar este (un riesgo puede tener MÁS de una causa a la vez — ej.
                // un incendio en bodega puede venir de una falla eléctrica Y de mal
                // almacenamiento de inflamables, dos causas independientes). Se referencia por
                // riskName (no por id) porque el Registro mismo se identifica así en todos lados
                // (ver PUT/DELETE por :riskName). `probability` (0-100, o null) es la
                // probabilidad condicional de esa arista puntual ("si ESTE padre ocurre, ¿qué tan
                // probable es que el hijo TAMBIÉN ocurra ese mismo año?") — la usa de verdad
                // runFamilyCascadeSimulation (lib/cascadeSimulation.js, "Simular Familia"), no es
                // solo organizativo.
                triggeredBy = [],
                description = null,
                // Norma/marco de la amenaza elegida del Catálogo de Riesgos (ver
                // App.RiskCatalog.useSelected), ej. "ISO 22301, NFPA 1600" + su código interno del
                // catálogo (ej. "NAT-GEO-001") — se muestra en el Paso 1 al elegir y en el detalle
                // del Árbol de Riesgos como referencia expandible (ver
                // backend/src/data/standardsReference.js: hazardStandards). null si el riesgo no
                // se armó desde el catálogo.
                catalogStandard = null,
                catalogCode = null,
                // Historial de Revisiones (ISO 31000, cláusula 6.6 — Monitoreo): cada corrida de
                // este mismo análisis, con fecha/ALE/evaluación — antes solo vivía en memoria/
                // localStorage del navegador (ver App.FairWizard.persistFairAnalysis), nunca
                // llegaba hasta acá, así que el Árbol de Riesgos (que lee el Registro, no
                // localStorage) nunca podía mostrarlo ni usarlo para saber si 6.6 ya se cubrió.
                reviewHistory = [],
                // Id propio de esta entrada del Registro, si el cliente ya la conoce (re-simular un
                // riesgo cargado desde aquí — ver App.FairWizard.loadRegisteredRiskIntoForm). Junto
                // con sourceRiskId, es lo que le permite al store (ver findRegisterEntryIndex)
                // reconocer que esto es una ACTUALIZACIÓN de la misma entrada y no una nueva, sin
                // depender de que el nombre no haya cambiado ni de que sea único.
                id = null,
                // Todo lo de aquí abajo antes solo vivía en el formulario en pantalla (o en
                // localStorage) — el Reporte individual (PDF de un solo riesgo) lo leía directo del
                // DOM, así que un riesgo YA guardado en el Registro no tenía forma de reconstruir su
                // reporte completo después (por ejemplo, para el Informe Consolidado). Se guarda
                // aquí tal cual, sin validar cada campo uno por uno (mismo criterio que el resto de
                // este archivo) porque es información descriptiva, no un cálculo.
                threat = '—',
                effect = 'material',
                timeHorizon = '1',
                reviewDate = null,
                dataSource = null,
                dataConfidence = null,
                dataNotes = null,
                assessor = null,
                assessmentDate = null,
                assessmentLocation = null,
                attackerProfileName = null,
                attackerScore = null,
                defenseProfileName = null,
                defenseScore = null,
                // Identificadores internos (ej. 'estandar'), a diferencia de
                // attacker/defenseProfileName de arriba (solo el nombre para mostrar) — los
                // necesita la página de Tratamiento para poder recalcular "Reducción de ALE"
                // (POST /api/autocalc/reduccion-ale) sin depender de que el wizard siga abierto
                // con ese riesgo cargado.
                attackerKey = null,
                defenseKey = null,
                // Snapshot de las 4 estrategias de tratamiento (ISO 31000, 6.5) tal como estaban
                // configuradas al guardar — permite reconstruir la Sección 9 del reporte para
                // CUALQUIER riesgo del Registro, no solo el que esté abierto en el wizard.
                mitigar = null,
                transferir = null,
                evitar = null,
                aceptarJustificacion = null,
                // Decisión de tratamiento: cuál de las 4 estrategias de arriba se ADOPTÓ de
                // verdad (a diferencia de mitigar/transferir/evitar/aceptarJustificacion, que
                // son solo los INSUMOS de las 4 hipótesis comparadas en paralelo) + el ALE
                // residual que de ahí resulta — ver App.Treatment.adoptStrategy. null mientras
                // nadie haya decidido nada todavía; es un estado real y distinto de "aceptar"
                // (ISO 31000 exige que aceptar sea una decisión documentada y deliberada, no la
                // ausencia de una decisión).
                treatmentDecision = null,
                // El histograma ya viene agrupado en barras (~20 valores) desde el frontend — no se
                // guardan los 10,000 resultados crudos de la simulación, solo lo necesario para
                // volver a dibujar el mismo gráfico en un reporte futuro.
                chartLabels = null,
                chartData = null,
            } = req.body;

            if (typeof ale !== 'number') {
                return res.status(400).json({ error: 'ale (número) es requerido.' });
            }
            // inherentALE/inherentCVaR se validan (a diferencia de median/min/max/p90, que son
            // puro dato histórico de display) porque SÍ se suman en un total de portafolio
            // visible (ver calculateInherentPortfolio) — un valor negativo corrompería ese
            // agregado en silencio.
            if (
                inherentALE !== null &&
                (typeof inherentALE !== 'number' || !Number.isFinite(inherentALE) || inherentALE < 0)
            ) {
                return res.status(400).json({ error: 'inherentALE debe ser un número mayor o igual a 0, o null.' });
            }
            if (
                inherentCVaR !== null &&
                (typeof inherentCVaR !== 'number' || !Number.isFinite(inherentCVaR) || inherentCVaR < 0)
            ) {
                return res.status(400).json({ error: 'inherentCVaR debe ser un número mayor o igual a 0, o null.' });
            }
            if (!Array.isArray(triggeredBy)) {
                return res.status(400).json({ error: 'triggeredBy debe ser un array.' });
            }
            const seenTriggerNames = new Set();
            for (const t of triggeredBy) {
                if (!t || typeof t.riskName !== 'string' || !t.riskName.trim()) {
                    return res.status(400).json({ error: 'Cada causa en triggeredBy necesita un riskName no vacío.' });
                }
                if (t.riskName === riskName) {
                    return res.status(400).json({ error: 'Un riesgo no puede ser su propia causa (triggeredBy).' });
                }
                if (seenTriggerNames.has(t.riskName)) {
                    return res.status(400).json({ error: `"${t.riskName}" está repetido en triggeredBy.` });
                }
                seenTriggerNames.add(t.riskName);
                if (
                    t.probability !== null &&
                    t.probability !== undefined &&
                    (typeof t.probability !== 'number' || t.probability < 0 || t.probability > 100)
                ) {
                    return res.status(400).json({
                        error: `triggeredBy.probability de "${t.riskName}" debe ser un número entre 0 y 100, o null.`,
                    });
                }
            }
            if (treatmentDecision !== null) {
                const validStrategies = ['mitigar', 'transferir', 'evitar', 'aceptar'];
                if (!validStrategies.includes(treatmentDecision.strategy)) {
                    return res
                        .status(400)
                        .json({ error: 'treatmentDecision.strategy debe ser mitigar, transferir, evitar o aceptar.' });
                }
                if (
                    typeof treatmentDecision.residualALE !== 'number' ||
                    !Number.isFinite(treatmentDecision.residualALE) ||
                    treatmentDecision.residualALE < 0
                ) {
                    return res
                        .status(400)
                        .json({ error: 'treatmentDecision.residualALE debe ser un número mayor o igual a 0.' });
                }
                // residualCVaR es OPCIONAL — ausente o null es válido (decisiones de Transferir,
                // que no tiene un CVaR residual calculado, o decisiones adoptadas antes de que
                // este campo existiera). Solo se valida cuando SÍ viene un valor.
                if (
                    treatmentDecision.residualCVaR !== undefined &&
                    treatmentDecision.residualCVaR !== null &&
                    (typeof treatmentDecision.residualCVaR !== 'number' ||
                        !Number.isFinite(treatmentDecision.residualCVaR) ||
                        treatmentDecision.residualCVaR < 0)
                ) {
                    return res.status(400).json({
                        error: 'treatmentDecision.residualCVaR debe ser un número mayor o igual a 0, o null.',
                    });
                }
            }

            const overrideError = validateRiskCriteriaOverride(riskCriteriaOverride, criteria);
            if (overrideError) return res.status(400).json({ error: overrideError });

            const effectiveCriteria = riskCriteriaOverride ? { ...criteria, ...riskCriteriaOverride } : criteria;
            const impactPercent = Math.max(0, Math.min(100, (ale / (effectiveCriteria.aleCritico || 1)) * 100));

            const entry = {
                // La app solo calcula en USD — no es un default, es fijo (ver la nota equivalente
                // en assets.js). Eliminar la variable de moneda evita por construcción que el
                // Pareto/mapa de calor terminen sumando/comparando riesgos en monedas distintas.
                id,
                riskName,
                asset,
                assetId,
                owner,
                currency: 'USD',
                ale,
                cvar95,
                median,
                min,
                max,
                p90,
                inherentALE,
                inherentCVaR,
                inherentEvaluationLevel,
                inherentEvaluationClasses,
                inherentSeverity,
                riskType,
                evaluationLevel,
                evaluationClasses,
                severity,
                evaluationJustification,
                impactPercent,
                probabilityPercent: probExceedance,
                sensitivity: sensitivity.slice(0, 5),
                securityPlan,
                tef,
                vuln,
                vulnManualOverride,
                lossMagnitudes,
                seed,
                sourceRiskId,
                riskCriteriaOverride,
                triggeredBy: triggeredBy.map((t) => ({
                    riskName: t.riskName.trim(),
                    probability: t.probability ?? null,
                })),
                description,
                catalogStandard,
                catalogCode,
                reviewHistory,
                threat,
                effect,
                timeHorizon,
                reviewDate,
                dataSource,
                dataConfidence,
                dataNotes,
                assessor,
                assessmentDate,
                assessmentLocation,
                attackerProfileName,
                attackerScore,
                defenseProfileName,
                defenseScore,
                attackerKey,
                defenseKey,
                mitigar,
                transferir,
                evitar,
                aceptarJustificacion,
                treatmentDecision,
                chartLabels,
                chartData,
                date: new Date().toISOString(),
            };

            // upsertRiskInRegister muta `entry.id` en el sitio (le asigna el id existente o genera
            // uno nuevo) — por eso responder con `entry` tal cual ya trae el id correcto.
            const register = await store.upsertRiskInRegister(entry);
            res.json({ entry, totalRisks: register.length });
        }),
    );

    // DELETE /api/register/:riskName — sourceRiskId (o id) por query string, cuando el cliente
    // los conoce, para borrar la entrada correcta incluso si otro riesgo distinto comparte el
    // mismo riskName (ver findRegisterEntryIndex). Sin ninguno de los dos, cae al comportamiento
    // histórico (por riskName, solo para entradas sin sourceRiskId).
    router.delete(
        '/:riskName',
        asyncHandler(async (req, res) => {
            const { id = null, sourceRiskId = null } = req.query;
            const register = await store.deleteRiskFromRegister(req.params.riskName, { id, sourceRiskId });
            res.json({ totalRisks: register.length });
        }),
    );

    return router;
}

module.exports = createRegisterRouter;
