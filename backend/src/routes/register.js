'use strict';

const { createHash } = require('node:crypto');

const express = require('express');
const {
    normalizeTriggeredBy,
    getRiskMatrixZones,
    calculateParetoAnalysis,
    calculateConsolidatedSensitivity,
    calculateResidualPortfolio,
    calculateResidualParetoAnalysis,
    calculateResidualMatrixPoint,
    calculateInherentPortfolio,
} = require('../lib/register');
const { evaluateFairThreat } = require('../lib/evaluation');
const { defaultRiskCriteria } = require('../data/profiles');
const { normalizeRiskCriteria, validateRiskCriteriaOverride } = require('../lib/riskCriteria');
const { asyncHandler } = require('../middleware/asyncHandler');
const { ACCESS_LEVELS, DEFAULT_ACCESS_LEVEL } = require('../lib/autocalc');
const { simulatePortfolio, simulateResidualPortfolio, PORTFOLIO_ITERATIONS } = require('../lib/portfolioSimulation');

// Caché de la simulación del portafolio (ver GET /portfolio-simulation). Vive en el módulo, no en
// el store: es un resultado derivado, se puede recalcular siempre, y no tiene por qué sobrevivir a
// un reinicio.
const portfolioCache = { huella: null, payload: null };

/**
 * Huella de los campos del Registro que ENTRAN al cálculo del portafolio. Cambiar cualquiera de
 * ellos invalida el caché; cambiar el dueño o la fecha de revisión no.
 */
function portfolioFingerprint(risks) {
    const relevante = (risks || []).map((r) => [
        r.riskName,
        r.riskType,
        r.ale,
        r.tef,
        r.vuln,
        r.vulnManualOverride,
        r.lossMagnitudes,
        r.attackerKey,
        r.defenseKey,
        r.accessLevel,
        r.dataConfidence,
        r.triggeredBy,
        r.triggeredByRiskName,
        r.triggeredByProbability,
        r.treatmentDecision,
    ]);
    return createHash('sha1').update(JSON.stringify(relevante)).digest('hex');
}

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

            // Punto RESIDUAL de cada riesgo en la Matriz (el destino de la flecha de migración).
            // Derivado, no persistido: se recalcula solo si cambian los Criterios de Riesgo. Se
            // resuelven aquí los criterios EFECTIVOS de cada riesgo (su override individual si lo
            // tiene, o los globales) — la misma resolución que hace el PUT para el punto actual,
            // en un solo lugar. `null` = no hay punto verde honesto que dibujar (ver el helper).
            risks.forEach((r) => {
                const efectivos = r.riskCriteriaOverride ? { ...criteria, ...r.riskCriteriaOverride } : criteria;
                r.residualMatrixPoint = calculateResidualMatrixPoint(r, efectivos);
            });

            const pareto = calculateParetoAnalysis(risks);
            const consolidatedSensitivity = calculateConsolidatedSensitivity(risks);
            const residualPortfolio = calculateResidualPortfolio(risks);
            if (residualPortfolio.cvarRiskCount > 0) {
                // Se clasifica con totalResidualCVaRFloor, NO con totalResidualCVaR: el primero
                // cubre las mismas amenazas que totalResidualALE, el segundo solo las que tienen
                // CVaR residual conocido (ver calculateResidualPortfolio). Cruzar los dos totales
                // podía dejar de escalar a "Crítico por cola de riesgo" un portafolio que sí lo
                // era, en cuanto alguna decisión de Transferir (o Mitigar+Transferir) no aportaba
                // su CVaR — subestimando el riesgo, justo la dirección que no se debe fallar.
                residualPortfolio.evaluation = evaluateFairThreat(
                    residualPortfolio.totalResidualALE,
                    residualPortfolio.totalResidualCVaRFloor,
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
    // GET /api/register/portfolio-simulation
    // Monte Carlo ACOPLADO del portafolio (ver lib/portfolioSimulation.js). Ruta aparte, y no
    // dentro del GET / de arriba, porque re-simula cada riesgo completo: es cara (10.000
    // iteraciones por riesgo) y no tiene por qué pagarse cada vez que se pinta la tabla.
    //
    // Devuelve percentiles REALES del portafolio, no la suma de los individuales: el ALE sí se
    // puede sumar (la esperanza es lineal) pero un percentil no. `sumOfIndividualCVaR` y
    // `diversificationBenefit` se devuelven para poder mostrar de cuánto era la sobrestimación.
    router.get(
        '/portfolio-simulation',
        asyncHandler(async (req, res) => {
            const risks = (await store.get('riskRegister')) || [];

            // Caché por huella del Registro. Sin esto, cada visita al Dashboard cuesta dos
            // simulaciones completas (actual + residual): con 66 riesgos son ~5,5 segundos de
            // cómputo SÍNCRONO, y Node es de un solo hilo — durante ese rato el backend no atiende
            // ninguna otra petición y la app entera se ve congelada. La huella cubre solo los
            // campos que de verdad entran al cálculo, así que editar el dueño o la fecha de
            // revisión de un riesgo no obliga a re-simular; cambiar su Vulnerabilidad o su
            // decisión de Tratamiento sí.
            const huella = portfolioFingerprint(risks);
            if (portfolioCache.huella === huella) {
                return res.json(portfolioCache.payload);
            }

            const result = simulatePortfolio(risks);
            // Respirar entre las dos corridas. Cada una es cómputo síncrono y Node es de un solo
            // hilo: encadenarlas sin ceder duplicaría el tiempo que el servidor pasa sordo a
            // cualquier otra petición. Con este setImmediate el bloqueo peor caso vuelve a ser el
            // de UNA corrida, no el de dos.
            await new Promise((resolve) => setImmediate(resolve));
            // El estado RESIDUAL (después del Tratamiento adoptado) viaja en la MISMA respuesta, no
            // en una llamada aparte: las dos cifras se muestran juntas ("ahorro en la cola"), y dos
            // peticiones podrían intercalarse y dejar en pantalla un par que nunca existió — el
            // mismo problema que ya obligó a poner guardianes de carrera en otras vistas.
            const residual = simulateResidualPortfolio(risks);
            const criteria = normalizeRiskCriteria((await store.get('riskCriteria')) || defaultRiskCriteria);

            // Clasificación del portafolio contra los Criterios de Riesgo, con el MISMO evaluador
            // que clasifica un riesgo individual — nunca se reimplementan los umbrales aquí.
            const evaluar = (summary) =>
                summary ? evaluateFairThreat(summary.average, summary.cvar95, criteria, makeCurrencyFormatter()) : null;

            // El estado actual se devuelve en la RAÍZ (no anidado bajo `actual`) para no romper a
            // quien ya consume esta ruta; el residual se agrega al lado.
            const payload = {
                ...result,
                evaluation: evaluar(result.summary),
                iterations: PORTFOLIO_ITERATIONS,
                residual: {
                    ...residual,
                    evaluation: evaluar(residual.summary),
                    // Lo que el comité quiere ver de una: cuánto encoge la cola el tratamiento, ya
                    // descontada la diversificación (ambas corridas son conjuntas y pareadas).
                    tailSavings:
                        result.summary && residual.summary ? result.summary.cvar95 - residual.summary.cvar95 : null,
                },
            };
            portfolioCache.huella = huella;
            portfolioCache.payload = payload;
            res.json(payload);
        }),
    );

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
                // Decisión de tratamiento: cuál estrategia se ADOPTÓ de verdad — una de las 4 de
                // arriba, o la combinación Mitigar+Transferir (a diferencia de
                // mitigar/transferir/evitar/aceptarJustificacion, que son solo los INSUMOS de las
                // hipótesis comparadas en paralelo) + el ALE residual que de ahí resulta — ver
                // App.Treatment.adoptStrategy. null mientras
                // nadie haya decidido nada todavía; es un estado real y distinto de "aceptar"
                // (ISO 31000 exige que aceptar sea una decisión documentada y deliberada, no la
                // ausencia de una decisión).
                treatmentDecision = null,
                // El histograma ya viene agrupado en barras (~20 valores) desde el frontend — no se
                // guardan los 10,000 resultados crudos de la simulación, solo lo necesario para
                // volver a dibujar el mismo gráfico en un reporte futuro.
                chartLabels = null,
                chartData = null,
                // Curva de Excedencia de Pérdidas (ver buildLossExceedanceCurve en lib/simulation.js):
                // ~34 puntos {loss, probability}, no los 10,000 crudos — mismo criterio que el
                // histograma de arriba. Sin migración para lo ya guardado: un riesgo anterior a
                // esto la recalcula la próxima vez que se simule, y la vista se oculta mientras
                // tanto (mismo patrón que inherentALE).
                lossExceedanceCurve = null,
                inherentLossExceedanceCurve = null,
                // Sello del modelo de Vulnerabilidad con el que se calculó este riesgo (ver
                // CALIBRATION_VERSION en lib/autocalc.js). Llega desde la respuesta
                // de POST /api/simulate, vía el frontend. `null` = guardado antes de que existiera
                // el sello, es decir, con la calibración vieja.
                calibrationVersion = null,
                // Si la amenaza la provoca alguien a propósito. Cuando es false no hay adversario
                // (sismo, incendio accidental, falla de equipo), así que el riesgo se analizó sin
                // Perfil de Atacante/Defensa y con la Vulnerabilidad capturada a mano. Default
                // true: es el caso principal de una app de seguridad patrimonial, y coincide con
                // cómo abre el formulario. Sin esto, un riesgo no deliberado volvía a abrirse como
                // deliberado al retomarlo, resucitando unos perfiles que nunca se eligieron.
                isDeliberate = true,
                // Nivel de Acceso / Proximidad (ver ACCESS_LEVELS en lib/autocalc.js) — propiedad
                // del RIESGO, no del Perfil de Atacante: el mismo empleado desleal tiene acceso
                // total a su bodega y ninguno al centro de datos.
                accessLevel = DEFAULT_ACCESS_LEVEL,
            } = req.body;

            if (calibrationVersion !== null && (!Number.isInteger(calibrationVersion) || calibrationVersion < 1)) {
                return res.status(400).json({ error: 'calibrationVersion debe ser un entero >= 1 o null.' });
            }
            if (typeof isDeliberate !== 'boolean') {
                return res.status(400).json({ error: 'isDeliberate debe ser booleano.' });
            }
            if (!Object.prototype.hasOwnProperty.call(ACCESS_LEVELS, accessLevel)) {
                return res
                    .status(400)
                    .json({ error: `accessLevel debe ser uno de: ${Object.keys(ACCESS_LEVELS).join(', ')}.` });
            }
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
                const validStrategies = ['mitigar', 'transferir', 'evitar', 'aceptar', 'mitigarTransferir'];
                if (!validStrategies.includes(treatmentDecision.strategy)) {
                    return res.status(400).json({
                        error: 'treatmentDecision.strategy debe ser mitigar, transferir, evitar, aceptar o mitigarTransferir.',
                    });
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

            // Validación ligera de las curvas (mismo criterio que el resto de este PUT: se
            // rechaza lo que rompería el dibujo, no se re-deriva el dato). Se acepta null/ausente
            // para los riesgos que todavía no la traen.
            for (const [nombre, curva] of [
                ['lossExceedanceCurve', lossExceedanceCurve],
                ['inherentLossExceedanceCurve', inherentLossExceedanceCurve],
                // La del RESIDUAL viaja dentro de la Decisión de Tratamiento (no como campo suelto
                // de la entrada) porque pertenece a ESA decisión: quitar la decisión debe llevarse
                // la curva con ella, sin dejar una curva huérfana que ya no describe nada.
                [
                    'treatmentDecision.residualLossExceedanceCurve',
                    treatmentDecision && treatmentDecision.residualLossExceedanceCurve,
                ],
            ]) {
                if (curva === null || curva === undefined) continue;
                if (!Array.isArray(curva)) {
                    return res.status(400).json({ error: `${nombre} debe ser un arreglo de puntos o null.` });
                }
                const invalido = curva.some(
                    (p) =>
                        !p ||
                        typeof p.loss !== 'number' ||
                        !Number.isFinite(p.loss) ||
                        p.loss < 0 ||
                        typeof p.probability !== 'number' ||
                        !Number.isFinite(p.probability) ||
                        p.probability < 0 ||
                        p.probability > 100,
                );
                if (invalido) {
                    return res.status(400).json({
                        error: `${nombre}: cada punto necesita loss >= 0 y probability entre 0 y 100.`,
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
                lossExceedanceCurve,
                inherentLossExceedanceCurve,
                calibrationVersion,
                isDeliberate,
                accessLevel,
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
