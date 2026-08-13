import { App } from './app-namespace.js';
import { state } from './state.js';
import {
    LOSS_FORMS_KEYS,
    LOSS_FORM_LABELS,
    buildHistogramBins,
    classifyPointSeverity,
    formatCurrency,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    severityToHex,
    shortMetricLabel,
    showToast,
    pertMean,
} from './utils.js';
import { STRATEGY_LABELS } from './treatment.js';

// ============================================================
// App.FairRegister — el Registro de Riesgos consolidado: guardar/borrar
// cada riesgo ya simulado, y el dashboard (mapa de calor, Pareto,
// sensibilidad consolidada, interpretación general, re-simular un riesgo
// guardado). Si el bug está en la página "Registro de Riesgos", está aquí.
// ============================================================
export const FairRegister = {
    // El Registro de Riesgos vive en el backend (GET/PUT/DELETE /api/register) — ya no en
    // localStorage. `render=false` se usa en el arranque (la página aún está oculta; crear
    // los gráficos de Chart.js sobre un <canvas> de tamaño 0 los deja mal dimensionados).
    async loadRiskRegister(render = true) {
        try {
            const [registerData, risksData] = await Promise.all([
                App.Api.request('/api/register'),
                App.Api.request('/api/risks'),
            ]);
            state.fair.riskRegister = registerData.risks || [];
            // Las filas de "Riesgos Desencadenantes" (Paso 1 de FAIR) viven fuera de esta
            // página — se refrescan aquí, no solo cuando se dibuja el Registro, para que
            // tengan la lista al día sin importar por dónde haya entrado el usuario.
            App.FairWizard.renderTriggeredByRows();
            state.fair.registerPareto = registerData.pareto || null;
            state.fair.registerConsolidatedSensitivity = registerData.consolidatedSensitivity || [];
            state.fair.registerHeatmapZones = registerData.heatmapZones || [];
            // Riesgo Residual del Portafolio (ver App.RiskManagement.renderResidualPortfolio) —
            // ya viene calculado del lado del servidor, sin llamada de red aparte.
            state.fair.registerResidualPortfolio = registerData.residualPortfolio || null;
            // Pareto sobre el Riesgo RESIDUAL (ver App.RiskManagement.renderResidualPareto) —
            // mismo criterio: ya viene calculado del lado del servidor.
            state.fair.registerResidualPareto = registerData.residualPareto || null;
            // Waterfall Inherente (sin controles) → Actual del Portafolio (ver
            // App.RiskManagement.renderResidualPortfolio, que combina esto con
            // registerResidualPortfolio para armar las 3 etapas) — igual, ya calculado del lado
            // del servidor.
            state.fair.registerInherentPortfolio = registerData.inherentPortfolio || null;
            // Tabla concentrada: fusiona los riesgos de Análisis Rápido (/api/risks, pueden
            // no tener simulación FAIR todavía) con los ya simulados (state.fair.riskRegister)
            // — ver buildConcentratedList(). El resto (mapa de calor, Pareto, sensibilidad
            // consolidada) sigue usando riskRegister sin cambios, a propósito: esos conceptos
            // (Bajo/Medio/Alto/Crítico por ALE, exposición total) solo tienen sentido para
            // riesgos ya cuantificados con FAIR, no para un estimado de triage.
            state.fair.concentratedRisks = this.buildConcentratedList(risksData.risks || [], state.fair.riskRegister);
        } catch (e) {
            console.error('No se pudo cargar el Registro de Riesgos:', e);
            if (render) showToast(e.userMessage || 'No se pudo cargar el Registro de Riesgos.');
            state.fair.riskRegister = state.fair.riskRegister || [];
            state.fair.concentratedRisks = state.fair.concentratedRisks || [];
        }
        // La barra persistente de riesgo (App.RiskSummaryBar) vive fuera de la página Registro —
        // se refresca aquí siempre, sin importar `render`, para que quede al día sin importar
        // por dónde haya entrado el usuario (mismo criterio que renderTriggeredByRows arriba).
        App.RiskSummaryBar.render();
        if (render) this.renderRiskRegister();
    },

    // Une /api/risks (historial de Análisis Rápido) con state.fair.riskRegister (ya
    // simulados en FAIR) en una sola lista, para la tabla de arriba del Registro. Un riesgo
    // que ya se promovió y simuló aparece UNA vez (con los datos de FAIR), no dos — se
    // reconoce por sourceRiskId (ver saveToRiskRegister). Los registros de FAIR sin ese
    // vínculo (guardados antes de que existiera, o armados con "Duplicar como Plantilla" sin
    // pasar por Análisis Rápido) se listan igual, tal como ya se veían antes de este cambio.
    // La numeración (#) es la posición en esta lista ordenada por fecha de creación — se
    // recalcula cada vez que se dibuja, así que si se borra un riesgo, el siguiente toma su
    // lugar en vez de dejar un hueco.
    // Deriva Riesgo Inherente/Residual (en dinero) y Efectividad de Controles (%) a partir
    // de un resultado FAIR — el motor RI/RRt (ARO×Vulnerabilidad×Impacto, en %) de la vieja
    // Vista Rápida ya no existe, y forzar el ALE (que ya está en dinero) a una escala 0-100%
    // era una conversión de más sin ningún beneficio real:
    //   Residual ($) = el ALE ya simulado (con la Vulnerabilidad/controles actuales).
    //   Inherente ($) = el mismo ALE pero con la Vulnerabilidad al 100% (sin controles) — el
    //     ALE es proporcional a la Vulnerabilidad, así que escalarla a su máximo aproxima
    //     cuánto perderías sin las mitigaciones actuales.
    //   Efectividad de Controles (%) = 100% − Vulnerabilidad (Más Probable) — qué porcentaje
    //     de los intentos de amenaza bloquean tus controles actuales.
    // Cada monto en dinero se clasifica contra el MISMO Criterio ALE que ya usa "Evaluación"
    // (evaluateFairThreat, en el backend) — mismo umbral, sin re-inventar una escala aparte.
    // Residual usa directamente entry.severity (ya viene calculado sobre ese mismo ALE);
    // Inherente es un monto DISTINTO (mayor, sin controles), así que se clasifica aparte
    // contra el mismo Criterio ALE Aceptable/Crítico.
    // Mismo criterio que evaluateFairThreat (backend/src/lib/evaluation.js) — el tramo entre
    // Aceptable y Crítico se parte a la mitad exacta en Medio/Alto, sin un tercer umbral
    // configurado aparte (decisión del usuario). Bajo/Crítico no se mueven.
    // criteriaOverride (opcional): el Apetito de Riesgo propio de un riesgo en particular (ver
    // App.FairWizard.openCriteriaOverrideEditor) — mismo mecanismo que ya usa /api/simulate,
    // para que "Riesgo Inherente" se clasifique contra el MISMO criterio que se usó de verdad
    // para evaluar ese riesgo, no siempre el global.
    //
    // FALLBACK SOLO PARA RIESGOS LEGADO: para cualquier riesgo simulado después de que
    // entry.inherentSeverity existiera, computeFairRiskEquivalents prefiere ese valor YA
    // CALCULADO por el backend (evaluateFairThreat, POST /api/simulate) — este banding manual
    // solo se usa cuando ese campo no está persistido todavía (riesgos guardados antes de este
    // cambio). No se elimina porque, a diferencia del backend, esta copia SOLO recibe `ale`
    // (nunca cvar95) — no puede detectar "Crítico por cola de riesgo", una limitación conocida y
    // aceptada para el caso legado, no para el camino nuevo.
    classifyAleAgainstCriteria(ale, criteriaOverride = null) {
        const criteria = criteriaOverride
            ? { ...state.config.riskCriteria, ...criteriaOverride }
            : state.config.riskCriteria;
        if (!criteria || typeof ale !== 'number') return null;
        const { aleAceptablePercent, aleCritico } = criteria;
        const aleAceptable = aleCritico * (aleAceptablePercent / 100);
        const aleMedio = aleAceptable + (aleCritico - aleAceptable) / 2;
        if (ale > aleCritico) return 'critico';
        if (ale > aleMedio) return 'alto';
        if (ale > aleAceptable) return 'medio';
        return 'bajo';
    },

    // La clasificación (Bajo/Medio/Alto/Crítico) no se repite aquí — ya la muestra la
    // columna "Evaluación" (evaluateFairThreat, en el backend); tener una "Categoría" aparte
    // solo duplicaba esa misma severidad con otro formato.
    // Solo aplica a riesgos tipo Amenaza: uno de tipo Oportunidad es un beneficio esperado,
    // no una pérdida, y no tiene un "Riesgo Inherente/Residual" con el mismo sentido.
    computeFairRiskEquivalents(entry) {
        if (!entry || entry.riskType === 'oportunidad' || typeof entry.ale !== 'number') return null;
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        // Riesgo Inherente REAL (sin ningún control) — ver calculateInherentRiskFromSimulation,
        // backend/src/lib/autocalc.js. Solo riesgos simulados DESPUÉS de que esto existiera lo
        // traen persistido; para los guardados antes, se cae a la aproximación algebraica
        // anterior ("des-mitigar" el ALE dividiendo entre la Vulnerabilidad media — válida bajo
        // la vieja Vulnerabilidad lineal, aproximada bajo el modelo TCap/RS + Tullock actual) sin
        // forzar una migración/re-simulación.
        const hasRealInherent = typeof entry.inherentALE === 'number';
        const vuln = entry.vuln;
        const vulnMean =
            vuln && typeof vuln.min === 'number' && typeof vuln.mode === 'number' && typeof vuln.max === 'number'
                ? pertMean(vuln.min, vuln.mode, vuln.max)
                : null;
        const inherentAle = hasRealInherent
            ? entry.inherentALE
            : vulnMean && vulnMean > 0
              ? entry.ale * (100 / vulnMean)
              : null;
        // Efectividad de Controles en dólares reales: cuánto reduce la Vulnerabilidad actual el
        // Riesgo Inherente — cuando hay dato real (hasRealInherent), reemplaza la aproximación
        // vieja (100% - Vulnerabilidad media), que en el promedio da el mismo número (ALE es
        // proporcional a la Vulnerabilidad media) pero ya no depende de esa proporcionalidad.
        const controlEffectiveness = hasRealInherent
            ? inherentAle > 0
                ? `${(((inherentAle - entry.ale) / inherentAle) * 100).toFixed(1)}%`
                : null
            : vulnMean != null
              ? `${(100 - vulnMean).toFixed(1)}%`
              : null;

        // Riesgo RESIDUAL de verdad: el que queda después de ADOPTAR una decisión de Tratamiento
        // (ver App.Treatment.adoptStrategy). Es null mientras no se haya decidido nada, y esa
        // ausencia es información real, no un hueco: ISO 31000 exige que tratar un riesgo sea una
        // decisión documentada y deliberada, así que "sin decidir" no es lo mismo que "residual =
        // actual". Se clasifica contra el MISMO criterio (incluido el override del riesgo) que ya
        // usan el Inherente y el Actual, para que las tres etapas sean comparables entre sí.
        const decision = entry.treatmentDecision || null;
        const residualAle = decision && typeof decision.residualALE === 'number' ? decision.residualALE : null;

        return {
            // OJO con el nombre: esto es el ALE ACTUAL (con los controles vigentes), la SEGUNDA
            // etapa del waterfall — antes se llamaba `residualMoney`, heredado de cuando la app
            // solo tenía dos etapas (Inherente → Residual) y no existía la decisión de
            // Tratamiento. Se renombró para que "residual" signifique una sola cosa en todo el
            // código, igual que ya se hizo con la columna visible de la tabla.
            actualMoney: fmt(entry.ale),
            actualSeverity: entry.severity || null,
            residualMoney: residualAle != null ? fmt(residualAle) : null,
            residualSeverity:
                residualAle != null ? this.classifyAleAgainstCriteria(residualAle, entry.riskCriteriaOverride) : null,
            residualStrategy: decision ? decision.strategy : null,
            inherentMoney: inherentAle != null ? fmt(inherentAle) : null,
            // Preferir la clasificación YA CALCULADA por el backend (entry.inherentSeverity, ver
            // evaluateFairThreat en POST /api/simulate) — bug real corregido: classifyAleAgainstCriteria
            // reimplementaba este banding a mano, pero solo miraba el ALE, nunca el CVaR95, así
            // que nunca podía detectar "Crítico por cola de riesgo" (cvar95 > aleCritico aunque
            // el ale no lo supere). Cae a la copia local SOLO para riesgos guardados antes de que
            // este campo existiera (con o sin inherentALE real) — mismo criterio de
            // retrocompatibilidad que el resto de esta función, sin forzar una migración.
            inherentSeverity:
                inherentAle == null
                    ? null
                    : hasRealInherent && entry.inherentSeverity
                      ? entry.inherentSeverity
                      : this.classifyAleAgainstCriteria(inherentAle, entry.riskCriteriaOverride || null),
            controlEffectiveness,
        };
    },

    buildConcentratedList(risks, register) {
        const merged = risks.map((risk) => {
            const fairEntry = register.find((r) => r.sourceRiskId === risk.id) || null;
            const fairEquiv = this.computeFairRiskEquivalents(fairEntry);
            return {
                id: risk.id,
                // Identificador estable para "Análisis Profundo" (ver renderConcentratedTable):
                // una vez que este riesgo tiene entrada de FAIR, esa es la fuente de verdad —
                // el id del riesgo de Análisis Rápido ya no sirve para buscar sus datos.
                rowKey: fairEntry ? fairEntry.id : risk.id,
                // Si ya existe una entrada de FAIR, su nombre/activo son los vigentes — el
                // wizard de FAIR permite editarlos independientemente del nombre con el que
                // se creó el riesgo en Análisis Rápido, así que quedarse con el de Análisis
                // Rápido mostraría un nombre desactualizado en cuanto lo cambiaras en FAIR.
                riskName: (fairEntry && fairEntry.riskName) || risk.name,
                stage: fairEntry ? 'fair' : 'triage',
                createdAt: risk.createdAt || risk.date,
                quickAle: risk.ale || null,
                riesgoInherente: fairEquiv ? fairEquiv.inherentMoney : risk.ri || null,
                riesgoInherenteSeverity: fairEquiv ? fairEquiv.inherentSeverity : null,
                riesgoActual: fairEquiv ? fairEquiv.actualMoney : risk.rrt || null,
                riesgoActualSeverity: fairEquiv ? fairEquiv.actualSeverity : null,
                riesgoResidual: fairEquiv ? fairEquiv.residualMoney : null,
                riesgoResidualSeverity: fairEquiv ? fairEquiv.residualSeverity : null,
                riesgoResidualStrategy: fairEquiv ? fairEquiv.residualStrategy : null,
                controlEffectiveness: fairEquiv ? fairEquiv.controlEffectiveness : null,
                asset: (fairEntry && fairEntry.asset) || (risk.fullData && risk.fullData.asset) || '—',
                fairEntry,
                // Para el botón "Analizar con FAIR" en filas de triage — mismo objeto que
                // App.FairAnalysis.receiveData() ya espera. Bug real (histórico):
                // risk.fullData.quickRiskId quedaba guardado con el valor que tenía AL
                // MOMENTO de guardar (normalmente null). Se corrige aquí, en la única fuente
                // de este objeto, con el id real de este mismo riesgo (risk.id).
                fullData: risk.fullData ? { ...risk.fullData, quickRiskId: risk.id } : null,
            };
        });

        const linkedRiskIds = new Set(merged.map((item) => item.id));
        register.forEach((reg) => {
            if (!reg.sourceRiskId || !linkedRiskIds.has(reg.sourceRiskId)) {
                const fairEquiv = this.computeFairRiskEquivalents(reg);
                merged.push({
                    id: null,
                    rowKey: reg.id,
                    riskName: reg.riskName,
                    stage: 'fair',
                    createdAt: reg.date,
                    quickAle: null,
                    riesgoInherente: fairEquiv ? fairEquiv.inherentMoney : null,
                    riesgoInherenteSeverity: fairEquiv ? fairEquiv.inherentSeverity : null,
                    riesgoActual: fairEquiv ? fairEquiv.actualMoney : null,
                    riesgoActualSeverity: fairEquiv ? fairEquiv.actualSeverity : null,
                    riesgoResidual: fairEquiv ? fairEquiv.residualMoney : null,
                    riesgoResidualSeverity: fairEquiv ? fairEquiv.residualSeverity : null,
                    riesgoResidualStrategy: fairEquiv ? fairEquiv.residualStrategy : null,
                    controlEffectiveness: fairEquiv ? fairEquiv.controlEffectiveness : null,
                    asset: reg.asset,
                    fairEntry: reg,
                });
            }
        });

        merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        merged.forEach((item, i) => {
            item.number = i + 1;
        });
        return merged;
    },

    // --- Registro de Riesgos (RIMS RA.1-2015, 6.4.4.3): cada riesgo FAIR ya analizado queda
    // guardado aquí automáticamente al correr su simulación, para poder verlos todos juntos
    // en un mapa de calor — en vez de que cada análisis viva aislado del resto.
    // Guarda/actualiza este riesgo en el Registro del backend justo después de una
    // simulación exitosa (PUT /api/register/:riskName). Idempotente por id/sourceRiskId
    // cuando se conocen (ver findRegisterEntryIndex en el backend) — riskName en la URL es
    // solo el punto de entrada, no la identidad real de la entrada.
    async saveToRiskRegister(summary, evaluation, inherentEvaluation = null) {
        const riskName = document.getElementById('fair-riskName').value.trim();
        if (!riskName) return;

        const currency = 'USD';
        const readRange = (prefix) => ({
            min: getSafeNumber(document.getElementById(`${prefix}-min`)),
            mode: getSafeNumber(document.getElementById(`${prefix}-mode`)),
            max: getSafeNumber(document.getElementById(`${prefix}-max`)),
        });
        // Se guardan los inputs (no solo el resultado) para poder re-simular este riesgo
        // después desde el botón "Simular" del Registro sin pedirle los datos de nuevo al
        // usuario — junto con la semilla usada, la simulación siempre da el mismo resultado.
        const lossMagnitudes = {};
        LOSS_FORMS_KEYS.forEach((key) => {
            lossMagnitudes[key] = readRange(`lm-${key}`);
        });

        // Bug real: sin esto, un análisis nuevo armado directo en FAIR (sin pasar por un
        // riesgo ya vinculado por sourceRiskId) no tenía NINGÚN id propio hasta que el
        // backend le asignaba uno DESPUÉS de este mismo guardado — así que el primer PUT
        // caía en el último criterio de identidad de findRegisterEntryIndex (por riskName),
        // y dos riesgos nuevos sin ninguna relación con el mismo nombre (ej. "Robo en
        // Bodega") se pisaban entre sí. Se genera aquí, ANTES del primer guardado, para que
        // ese primer PUT ya traiga un id propio — el mismo problema que se corrigió para
        // riesgos vinculados a Vista Rápida, ahora relevante para el caso más común (Vista
        // Rápida ya no existe, así que ningún riesgo nuevo llega con sourceRiskId).
        if (!state.fair.registerEntryId) state.fair.registerEntryId = crypto.randomUUID();

        // Mitigar/Transferir/Evitar/Aceptar ya no se editan en el wizard — viven en su propia
        // página (ver App.Treatment). Al (re)simular, se conservan tal cual estaban en esta
        // MISMA entrada si ya existía (para no perder lo que el usuario ya haya configurado ahí
        // antes), o quedan en su valor por defecto si es un riesgo nuevo.
        const existingEntry = (state.fair.riskRegister || []).find((r) => r.id === state.fair.registerEntryId) || null;
        const mitigar = existingEntry?.mitigar || { cost: 0, reductionPercent: 0, reliability: 'media', delayDays: 0 };
        const transferir = existingEntry?.transferir || {
            premium: 0,
            deductible: 0,
            limit: 0,
            unlimited: false,
            reliability: 'media',
            delayDays: 0,
        };
        const evitar = existingEntry?.evitar || { cost: 0, reliability: 'alta', delayDays: 0 };
        const aceptarJustificacion = existingEntry?.aceptarJustificacion || null;
        // Decisión de tratamiento (ver App.Treatment.adoptStrategy) — mismo criterio que
        // mitigar/transferir/evitar de arriba: sin conservarla aquí, volver a simular un riesgo
        // ya tratado la borraría en silencio en cuanto se guardara de nuevo.
        const treatmentDecision = existingEntry?.treatmentDecision || null;
        // Gobernanza/Revisión y Plan de Seguridad tampoco se editan ya en el wizard — viven en su
        // propia página (ver App.RiskManagement). Mismo criterio que mitigar/transferir/evitar de
        // arriba: se conservan tal cual si ya existían, o quedan en su valor por defecto (el mismo
        // que antes precargaba el wizard) si es un riesgo nuevo — el usuario los ajusta después
        // desde Gestión de Riesgos, sin necesidad de volver a simular.
        const owner = existingEntry?.owner || App.OrgDefaults.defaults.owner || '—';
        const reviewDate = existingEntry?.reviewDate || null;
        const assessor = existingEntry?.assessor || null;
        const assessmentDate = existingEntry?.assessmentDate || null;
        const assessmentLocation = existingEntry?.assessmentLocation || null;
        const securityPlan = existingEntry?.securityPlan || '—';
        const deliberada = document.getElementById('fair-deliberate-threat').checked;
        const attackerProfile = state.quick.attackerProfiles[state.fair.attackerKey] || {};
        const defenseProfile = state.quick.defenseProfiles[state.fair.defenseKey] || {};
        const chart = state.fair.fairResultsChart;

        let res;
        try {
            res = await App.Api.request(`/api/register/${encodeURIComponent(riskName)}`, {
                method: 'PUT',
                body: {
                    // Id propio de esta entrada del Registro — le permite al backend
                    // reconocer que esto es una actualización de la MISMA entrada aunque el
                    // nombre haya cambiado, y evita colisionar con otro riesgo que comparta
                    // nombre (ver findRegisterEntryIndex).
                    id: state.fair.registerEntryId,
                    asset: document.getElementById('fair-asset').value.trim() || '—',
                    // Vínculo real hacia el Catálogo de Activos (id, no solo el nombre copiado
                    // arriba) — permite a App.AssetCatalog mostrar qué riesgos ya guardados
                    // referencian a cada activo (ver linkedRisksFor). null si el riesgo no se
                    // armó eligiendo un activo del catálogo (ej. "Activo Afectado" escrito a mano).
                    assetId: state.quick.selectedAssetRef ? state.quick.selectedAssetRef.id : null,
                    owner,
                    ale: summary.average,
                    cvar95: summary.cvar95,
                    median: summary.median,
                    min: summary.min,
                    max: summary.max,
                    p90: summary.p90,
                    // Riesgo Inherente REAL (sin ningún control, ver
                    // calculateInherentRiskFromSimulation en el backend) — null para Oportunidad.
                    // Recalculado en CADA simulación, mismo ciclo de vida que ale/cvar95 (no se
                    // hereda de existingEntry como sí hace treatmentDecision).
                    inherentALE: summary.inherentALE,
                    inherentCVaR: summary.inherentCVaR,
                    // Clasificación del Riesgo Inherente, ya calculada por el backend
                    // (evaluateFairThreat, ver POST /api/simulate) — null para Oportunidad, mismo
                    // ciclo de vida que inherentALE/inherentCVaR arriba. Reemplaza la copia local
                    // classifyAleAgainstCriteria (bug real: esa copia solo miraba inherentALE,
                    // nunca inherentCVaR, así que nunca detectaba "Crítico por cola de riesgo").
                    inherentEvaluationLevel: inherentEvaluation ? inherentEvaluation.level : null,
                    inherentEvaluationClasses: inherentEvaluation
                        ? severityToClasses(inherentEvaluation.severity)
                        : null,
                    inherentSeverity: inherentEvaluation ? inherentEvaluation.severity : null,
                    evaluationLevel: evaluation.level,
                    evaluationClasses: severityToClasses(evaluation.severity),
                    // El texto de evaluationLevel no siempre contiene literalmente la
                    // palabra del nivel (ej. "Aceptable" es severidad "bajo", "Requiere
                    // Tratamiento" es "alto") — se guarda el severity crudo aparte para
                    // poder agrupar por nivel de forma confiable (ver Interpretación
                    // General en renderPortfolioInterpretation).
                    severity: evaluation.severity,
                    evaluationJustification: evaluation.justification,
                    probExceedance: summary.probExceedance,
                    sensitivity: (state.fair.lastSensitivity || []).slice(0, 5),
                    currency,
                    securityPlan,
                    tef: readRange('tef'),
                    vuln: readRange('vuln'),
                    // Si el usuario de verdad tocó "Ajustar manualmente" para Vulnerabilidad, o
                    // si es el resultado sin editar de calculateVulnerability (autocalc.js) —
                    // antes solo vivía en el borrador de localStorage, nunca llegaba al
                    // Registro (ver la corrección en loadRegisteredRiskIntoForm, que antes
                    // asumía "manual" siempre al retomar un riesgo, sin este dato real).
                    vulnManualOverride: document.getElementById('vuln-manual-override').checked,
                    lossMagnitudes,
                    seed: state.fair.lastSeed || null,
                    riskType: document.getElementById('fair-risk-type').value,
                    // Vincula esta entrada del Registro con el riesgo de Análisis Rápido del
                    // que salió (si vino de ahí) — ver App.FairWizard.loadRiskIntoForm y
                    // App.FairRegister.buildConcentratedList.
                    sourceRiskId: state.fair.sourceRiskId || null,
                    // Apetito de Riesgo (Pérdida Anual Aceptable %/ALE Crítico) propio de este
                    // riesgo, si se definió uno — ver App.FairWizard.openCriteriaOverrideEditor.
                    // null usa los criterios globales, igual que antes de que existiera esto.
                    riskCriteriaOverride: state.fair.riskCriteriaOverride || null,
                    // Riesgo(s) en cascada (Paso 1, "Riesgos Desencadenantes") — un riesgo puede
                    // tener más de una causa, ver App.FairWizard.renderTriggeredByRows y
                    // App.RiskCascadeTree.buildGraph. La probabilidad la usa "Simular Familia"
                    // (runFamilyCascadeSimulation, backend).
                    triggeredBy: (() => {
                        App.FairWizard.syncTriggeredByDraftFromDom();
                        return state.fair.triggeredByDraft.filter((t) => t.riskName);
                    })(),
                    // Norma del catálogo elegida en el Paso 1 (ver App.RiskCatalog.useSelected) —
                    // ya viene correctamente hidratado tanto si se acaba de elegir como si se
                    // restauró al retomar este mismo riesgo (ver loadRegisteredRiskIntoForm), así
                    // que a diferencia de mitigar/transferir/owner no necesita el respaldo de
                    // existingEntry (esos se editan en Gestión de Riesgos, una página aparte).
                    catalogStandard: state.fair.catalogStandard || null,
                    catalogCode: state.fair.catalogCode || null,
                    // Historial de Revisiones (ISO 31000, 6.6) — ver el fix de persistencia de
                    // esta tarea; antes nunca se mandaba, así que un riesgo re-simulado varias
                    // veces perdía su historial completo apenas se recargaba la página.
                    reviewHistory: state.fair.reviewHistory || [],
                    description: document.getElementById('fair-riskDescription').value.trim() || null,
                    // A partir de aquí: campos que antes solo vivían en este formulario (o en
                    // el Reporte individual, leídos directo del DOM) — se guardan para que el
                    // Informe Consolidado pueda reconstruir el reporte completo de CUALQUIER
                    // riesgo del Registro, no solo el que esté abierto ahora mismo.
                    threat: document.getElementById('fair-threat').value.trim() || '—',
                    effect: document.getElementById('fair-effect').value,
                    timeHorizon: document.getElementById('fair-time-horizon').value,
                    reviewDate,
                    dataSource: document.getElementById('fair-data-source').value,
                    dataConfidence: document.getElementById('fair-data-confidence').value,
                    dataNotes: document.getElementById('fair-data-notes').value.trim() || null,
                    assessor,
                    assessmentDate,
                    assessmentLocation,
                    attackerProfileName: attackerProfile.name || null,
                    attackerScore: state.fair.attackerScore || null,
                    defenseProfileName: defenseProfile.name || null,
                    defenseScore: state.fair.defenseScore || null,
                    // Identificadores internos (ej. 'estandar'), a diferencia de
                    // attacker/defenseProfileName de arriba — los necesita App.Treatment para
                    // poder recalcular "Reducción de ALE" sin depender de que el wizard siga
                    // abierto con este riesgo cargado.
                    // Sin adversario no hay perfiles que guardar: dejarlos aquí no solo sería un
                    // dato falso, además ANULA la bandera de arriba, porque inferDeliberateThreat
                    // trata un attackerKey presente como prueba de que el riesgo sí se analizó
                    // como contienda (ver fair-wizard.js). Mismo criterio que ya aplica
                    // runSimulation al no mandarlos a /api/simulate.
                    attackerKey: deliberada ? state.fair.attackerKey || null : null,
                    defenseKey: deliberada ? state.fair.defenseKey || null : null,
                    mitigar,
                    transferir,
                    evitar,
                    aceptarJustificacion,
                    treatmentDecision,
                    // Curva de Excedencia de Pérdidas de esta corrida (ver
                    // buildLossExceedanceCurve en el backend). Sin mandarla acá se perdería: este
                    // PUT reconstruye la entrada completa, así que lo que no viaja se borra.
                    lossExceedanceCurve: state.fair.lastLossExceedanceCurve || null,
                    inherentLossExceedanceCurve: state.fair.lastInherentLossExceedanceCurve || null,
                    calibrationVersion: state.fair.lastCalibrationVersion ?? null,
                    isDeliberate: deliberada,
                    chartLabels: chart ? chart.data.labels : null,
                    chartData: chart ? chart.data.datasets[0].data : null,
                },
            });
        } catch (e) {
            console.error('No se pudo guardar en el Registro de Riesgos:', e);
            showToast(e.userMessage || 'No se pudo guardar este riesgo en el Registro.');
            return;
        }
        // Guarda el id que acaba de asignar/confirmar el backend — así, si se vuelve a
        // simular este mismo riesgo (sin recargar), el próximo PUT ya sabe que es una
        // actualización de esta misma entrada, no una nueva (ver findRegisterEntryIndex).
        state.fair.registerEntryId = res.entry.id;
        // Bug real: sin esto, state.fair.riskRegister (en memoria) se quedaba desactualizado
        // hasta que el usuario visitara la página de Registro — así que un riesgo recién
        // simulado no aparecía todavía como opción en "Riesgo Desencadenante" (Paso 1) para
        // el SIGUIENTE riesgo que se analizara en la misma sesión, sin necesidad real de
        // ese rodeo. render=false porque no hace falta redibujar la analítica pesada
        // (mapa de calor/Pareto, en #registerPage) si no estamos viéndola ahora mismo.
        await this.loadRiskRegister(false);
        // La tabla concentrada sí se redibuja siempre, aparte de esa analítica pesada — desde
        // la fusión de Análisis Rápido y FAIR en una sola página, esta misma tabla vive
        // siempre visible debajo de este wizard (no solo en Registro de Riesgos), así que sin
        // esto la fila del riesgo recién simulado se quedaba diciendo "Triage" hasta que el
        // usuario tocara algo más (ver App.FairRegister.renderConcentratedTable).
        this.renderConcentratedTable(state.fair.concentratedRisks);
    },

    // Elimina un riesgo de la tabla concentrada — si ya tiene simulación FAIR, borra esa
    // entrada del Registro; si viene de Análisis Rápido, borra también /api/risks. Un
    // riesgo ya analizado con FAIR normalmente tiene ambas partes (se borran las dos, para
    // no dejar una mitad huérfana); uno que nunca pasó por FAIR solo tiene la de /api/risks.
    async deleteConcentratedRisk({ riskName, sourceId, entryId }) {
        try {
            if (riskName) {
                // Misma prioridad que findRegisterEntryIndex: el id propio de la entrada
                // primero (el más preciso — un riesgo armado directo en FAIR, sin
                // sourceRiskId, ya tiene uno propio desde su primer guardado, ver
                // saveToRiskRegister), sourceRiskId como respaldo. Sin esto, dos riesgos
                // distintos con el mismo nombre y sin sourceRiskId (el caso normal desde que
                // se eliminó Vista Rápida) podían borrar el equivocado.
                const params = new URLSearchParams();
                if (entryId) params.set('id', entryId);
                else if (sourceId) params.set('sourceRiskId', sourceId);
                const qs = params.toString() ? `?${params.toString()}` : '';
                await App.Api.request(`/api/register/${encodeURIComponent(riskName)}${qs}`, { method: 'DELETE' });
            }
            if (sourceId) await App.Api.request(`/api/risks/${sourceId}`, { method: 'DELETE' });
        } catch (e) {
            showToast(e.userMessage || 'No se pudo eliminar el riesgo.');
            return;
        }
        await this.loadRiskRegister();
        showToast('Riesgo eliminado.');
    },

    renderRiskRegister() {
        const empty = document.getElementById('fair-register-empty');
        const content = document.getElementById('fair-register-content');
        const register = state.fair.riskRegister;
        const concentrated = state.fair.concentratedRisks || [];

        // La tabla (Análisis Rápido + Registro de Riesgos, ver renderConcentratedTable) se
        // dibuja siempre, tenga o no filas — su propio "No hay riesgos guardados" cubre el
        // caso vacío. Lo que sí sigue condicionado a tener datos es la analítica de abajo
        // (mapa de calor/Pareto/sensibilidad/interpretación), que solo tiene sentido con al
        // menos un riesgo YA analizado con FAIR (`register`, no `concentrated` — un riesgo
        // que solo pasó por Análisis Rápido no aporta nada a esas gráficas).
        this.renderConcentratedTable(concentrated);

        if (register.length === 0) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            return;
        }
        empty.classList.add('hidden');
        content.classList.remove('hidden');

        this.renderPortfolioInterpretation(register);

        // El mapa de calor (Impacto vs. Probabilidad de excedencia) y sus zonas
        // Bajo/Medio/Alto/Crítico son conceptos de AMENAZA — para una 'oportunidad'
        // (riesgo positivo) el "ale" guardado es en realidad un beneficio esperado, no una
        // pérdida. Graficarla ahí la posicionaba en la esquina "Crítico" (peor caso posible)
        // aunque fuera una oportunidad grande y buena — se excluye del mapa (y del Pareto,
        // ver backend calculateParetoAnalysis), pero se sigue listando en la tabla de abajo
        // con su propia evaluación correcta ("Oportunidad Significativa...", etc.).
        const threatRegister = register.filter((r) => r.riskType !== 'oportunidad');
        const opportunityCount = register.length - threatRegister.length;

        // Las zonas del mapa de calor (colores + rangos) ya vienen del backend en la
        // respuesta de GET /api/register — solo falta el color del texto, que es
        // puramente presentación (blanco sobre fondos oscuros, negro sobre claros).
        const textColorByLevel = { Bajo: '#000', Medio: '#000', Alto: '#fff', Crítico: '#fff' };
        const canvas = document.getElementById('fair-register-chart');
        const matrixBackgroundPlugin = {
            id: 'fairRegisterMatrixBackground',
            beforeDatasetsDraw(chart) {
                const {
                    ctx,
                    scales: { x, y },
                } = chart;
                ctx.save();
                const zones = state.fair.registerHeatmapZones || [];
                zones.forEach((zone) => {
                    ctx.fillStyle = zone.color;
                    ctx.fillRect(
                        x.getPixelForValue(zone.x[0]),
                        y.getPixelForValue(zone.y[1]),
                        x.getPixelForValue(zone.x[1]) - x.getPixelForValue(zone.x[0]),
                        y.getPixelForValue(zone.y[0]) - y.getPixelForValue(zone.y[1]),
                    );
                });
                ctx.font = 'bold 14px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                zones.forEach((zone) => {
                    const midX = x.getPixelForValue((zone.x[0] + zone.x[1]) / 2);
                    const midY = y.getPixelForValue((zone.y[0] + zone.y[1]) / 2);
                    ctx.fillStyle = textColorByLevel[zone.level] || '#000';
                    ctx.fillText(zone.level, midX, midY);
                });
                ctx.restore();
            },
        };

        // Un riesgo con impactPercent/probabilityPercent en 0 o 100 (recortado ahí, ver el
        // backend) queda con el CENTRO del punto exactamente sobre el borde del área de
        // dibujo — Chart.js lo posiciona ahí tal cual, así que la mitad del círculo (radio 10,
        // hasta 13 al pasar el mouse) se dibuja visualmente "saliendo" del cuadro del gráfico,
        // aunque `clip` (ver el dataset) evite que se vea cortado.
        //
        // Bug real encontrado (no en `afterDatasetsUpdate`, donde vivía esto antes): en un
        // contenedor angosto (pantallas chicas/móvil), el navegador puede reacomodar el tamaño
        // real del gráfico DESPUÉS de que Chart.js ya calculó la posición de los puntos para
        // ese ciclo de actualización — así que un punto en una esquina (ej. impacto Y
        // probabilidad ambos en 100%) se ajustaba contra un `chartArea` que ya había quedado
        // desactualizado, y el círculo volvía a quedar cortado. `beforeDatasetsDraw` corre
        // justo antes de PINTAR cada cuadro (no al actualizar los datos), así que siempre usa
        // el `chartArea` ya confirmado y final para ese dibujo — no puede quedar desactualizado
        // por un reacomodo posterior. El DATO real (tooltip, eje) no cambia, solo dónde se
        // dibuja el punto.
        // +4px de margen (además del radio) para que el punto NUNCA quede tocando la línea del
        // eje/borde del cuadro — un punto justo tangente a esa línea se veía como si la
        // "cortara" visualmente (la línea desaparece detrás del círculo justo en la esquina).
        // Con este margen siempre queda un huequito visible entre el punto y el borde.
        const POINT_EDGE_MARGIN = 4;
        const clampPointsToChartAreaPlugin = {
            id: 'fairRegisterClampPoints',
            beforeDatasetsDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data) return;
                const area = chart.chartArea;
                meta.data.forEach((point) => {
                    const r = ((point.options && point.options.radius) || 10) + POINT_EDGE_MARGIN;
                    point.x = Math.min(Math.max(point.x, area.left + r), area.right - r);
                    point.y = Math.min(Math.max(point.y, area.top + r), area.bottom - r);
                });
            },
        };

        // Cada punto lleva su número (1, 2, 3...) encima, en el mismo orden que el registro
        // — así se puede identificar cuál riesgo es cuál sin adivinar por posición o color.
        // Se dibuja después de los puntos (afterDatasetsDraw) para que quede legible arriba,
        // no debajo del círculo. Reusa la posición YA ajustada por clampPointsToChartAreaPlugin
        // (en vez de recalcularla desde el valor del dato) para que el número quede centrado
        // sobre el círculo tal como se dibujó, no sobre dónde el círculo "debería" estar si no
        // se hubiera ajustado.
        const pointNumberPlugin = {
            id: 'fairRegisterPointNumbers',
            afterDatasetsDraw(chart) {
                const meta = chart.getDatasetMeta(0);
                if (!meta || !meta.data) return;
                const { ctx } = chart;
                ctx.save();
                ctx.font = 'bold 11px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#fff';
                meta.data.forEach((point, i) => {
                    ctx.fillText(String(i + 1), point.x, point.y);
                });
                ctx.restore();
            },
        };
        // El color del punto/la leyenda ya NO viene de r.severity (evaluateFairThreat, que
        // compara el ALE en dólares contra aleAceptable/aleCritico y nunca devuelve 'medio') —
        // viene de classifyPointSeverity, el MISMO criterio que ya pintó la zona de fondo donde
        // cae ese punto (posición Impacto%/Probabilidad% contra rrtBands). Antes podían no
        // coincidir (un punto "crítico" por su ALE, parado sobre una zona "Medio" por su
        // posición) — ver el comentario de classifyPointSeverity en utils.js.
        const zones = state.fair.registerHeatmapZones || [];
        document.getElementById('fair-register-legend').innerHTML = `
            <p class="font-semibold text-gray-700 mb-2">Riesgos en el mapa</p>
            <ol class="space-y-1">
                ${threatRegister.map((r, i) => `<li><span style="display:inline-block;width:8px;height:8px;border-radius:9999px;margin-right:4px;background-color:${severityToHex(classifyPointSeverity(r.impactPercent, r.probabilityPercent, zones))}"></span><strong>${i + 1}.</strong> ${sanitizeHTML(r.riskName)}</li>`).join('')}
            </ol>
            ${opportunityCount > 0 ? `<p class="text-xs text-gray-500 mt-2">${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'} no se muestra${opportunityCount === 1 ? '' : 'n'} aquí — un beneficio esperado no es un riesgo a tratar. Están en la tabla de abajo.</p>` : ''}`;

        if (state.fair.registerChart) state.fair.registerChart.destroy();
        state.fair.registerChart = new Chart(canvas, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Riesgos FAIR',
                        // Antes cada punto era del mismo morado fijo sin importar qué tan grave
                        // fuera el riesgo — el color solo venía del fondo por cuadrante (zona),
                        // no del punto en sí. Ahora cada punto se colorea con classifyPointSeverity
                        // (el mismo criterio que ya pintó la zona donde cae — ver el comentario en
                        // utils.js), no con `r.severity` — evita que un punto salga de un color y
                        // la zona debajo de otro.
                        data: threatRegister.map((r) => ({
                            x: r.impactPercent,
                            y: r.probabilityPercent,
                            name: r.riskName,
                            level: r.evaluationLevel,
                        })),
                        pointBackgroundColor: threatRegister.map((r) =>
                            severityToHex(classifyPointSeverity(r.impactPercent, r.probabilityPercent, zones)),
                        ),
                        pointBorderColor: 'white',
                        // Los colores de severidad (severityToHex) son parecidos en tono a los
                        // colores de fondo de su propia zona (ej. "Medio" es dorado sobre dorado,
                        // "Crítico" es rojo sobre granate) — con el borde de 1px por defecto de
                        // Chart.js, el punto casi desaparecía contra su propio fondo. Un borde
                        // blanco más grueso separa el punto del fondo sin importar qué tan
                        // parecido sea el tono, en vez de tener que elegir colores de punto
                        // distintos a los que ya usan los badges de severidad en el resto de la app.
                        pointBorderWidth: 3,
                        pointRadius: 10,
                        pointHoverRadius: 13,
                        // impactPercent/probabilityPercent se recortan a [0,100] (ver el backend) —
                        // un riesgo cuyo ALE ya iguala o supera el umbral Crítico cae EXACTO en
                        // x=100, con el centro del punto sobre el borde del eje. Chart.js por
                        // defecto recorta cada punto al área del gráfico, así que ese punto se veía
                        // cortado a la mitad (mismo problema en y=0/100). clip amplía esa zona de
                        // recorte más allá del área del gráfico, así el círculo completo (radio 10,
                        // hasta 13 al pasar el mouse) no se corta — y clampPointsToChartAreaPlugin
                        // (abajo) además reubica su centro para que no se vea saliendo del cuadro.
                        clip: 16,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // Espacio de sobra alrededor del área de dibujo — sin esto, un punto en el borde
                // (ver el comentario de "clip" arriba) puede quedar apenas fuera del <canvas>
                // mismo, no solo del área del gráfico, y clip por sí solo no alcanza.
                layout: {
                    padding: { top: 14, right: 14, bottom: 4, left: 4 },
                },
                scales: {
                    // Título corto y grande en vez del nombre técnico completo — el detalle
                    // (qué % de qué exactamente) ya vive en el tooltip y en la descripción de
                    // arriba de este gráfico; el eje solo necesita decir de qué se trata, no
                    // explicarlo.
                    x: {
                        title: { display: true, text: 'IMPACTO', font: { size: 16, weight: 'bold' } },
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 25 },
                    },
                    y: {
                        title: { display: true, text: 'PROBABILIDAD', font: { size: 16, weight: 'bold' } },
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 25 },
                    },
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) =>
                                `${context.dataIndex + 1}. ${context.raw.name}: Impacto ${context.raw.x.toFixed(0)}%, Probabilidad ${context.raw.y.toFixed(0)}% — ${context.raw.level}`,
                        },
                    },
                },
            },
            plugins: [matrixBackgroundPlugin, clampPointsToChartAreaPlugin, pointNumberPlugin],
        });

        this.renderParetoChart();
        this.renderConsolidatedSensitivity();
    },

    // Dibuja la tabla concentrada (#quick-concentrated-table-body, en Análisis de Riesgo) —
    // antes se dibujaba TAMBIÉN en Registro de Riesgos, en una copia idéntica del mismo DOM;
    // se quitó esa copia (ver #registerPage en el HTML) para no tener la misma información
    // dos veces. Une lo que ya pasó por FAIR con lo que todavía está solo en Vista Rápida
    // (ver buildConcentratedList), e incluye tanto las columnas del viejo Historial (Riesgo
    // Inherente/Residual/Categoría, por RRt%) como las del Registro (Etapa/CVaR/Evaluación, por
    // FAIR) — ningún dato se pierde al fusionar las dos tablas que existían antes por separado.
    renderConcentratedTable(list) {
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const formatDate = (d) =>
            d ? new Date(d).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
        const bodies = ['quick-concentrated-table-body'].map((id) => document.getElementById(id)).filter(Boolean);

        // Filtros por Etapa/Evaluación (selects estáticos, ver el listener en
        // App.FairWizard.init) — filtran SOLO qué se dibuja, nunca la lista completa
        // (state.fair.concentratedRisks): item.number ya viene asignado en buildConcentratedList
        // según la posición en la lista COMPLETA, así que una fila filtrada conserva su mismo
        // número de siempre en vez de renumerarse — más fácil de ubicar de nuevo al quitar el
        // filtro. Evaluación no aplica a Triage (sin fairEntry, sin severity todavía) — un
        // filtro específico los excluye, igual que ya hace evalCell mostrando '—' para ellos.
        const stageFilter = document.getElementById('quick-concentrated-filter-stage')?.value || '';
        const evalFilter = document.getElementById('quick-concentrated-filter-eval')?.value || '';
        const filteredList = list.filter((item) => {
            if (stageFilter && item.stage !== stageFilter) return false;
            if (evalFilter && (!item.fairEntry || item.fairEntry.severity !== evalFilter)) return false;
            return true;
        });

        const countEl = document.getElementById('quick-concentrated-filter-count');
        if (countEl) {
            countEl.textContent =
                (stageFilter || evalFilter) && list.length > 0
                    ? `Mostrando ${filteredList.length} de ${list.length}`
                    : '';
        }

        if (list.length === 0) {
            bodies.forEach((tb) => {
                tb.innerHTML =
                    '<tr><td colspan="12" class="text-center py-4 text-gray-500">No hay riesgos guardados.</td></tr>';
            });
            return;
        }
        if (filteredList.length === 0) {
            bodies.forEach((tb) => {
                tb.innerHTML =
                    '<tr><td colspan="12" class="text-center py-4 text-gray-500">Ningún riesgo coincide con el filtro elegido.</td></tr>';
            });
            return;
        }

        const rowsHTML = filteredList
            .map((item) => {
                const stageBadge =
                    item.stage === 'fair'
                        ? `<span class="px-2 py-1 rounded text-xs bg-blue-50 text-blue-700 border-l-4 border-blue-500">Analizado (FAIR)</span>`
                        : `<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 border-l-4 border-gray-400">Triage</span>`;

                // Señal de que este riesgo ya tiene una Decisión de Tratamiento adoptada (ver
                // App.Treatment.adoptStrategy) — antes esta tabla se quedaba en 2 pisos
                // (Inherente/Actual) sin ninguna señal de que Gestión de Riesgos/Tratamiento ya
                // tienen un 3er piso (Residual, el resultado real post-tratamiento) para este
                // riesgo. No se agrega una columna nueva (ya son 12) — el residual real completo
                // vive un clic más allá, en Tratamiento/Gestión de Riesgos; acá solo la señal +
                // el monto en el tooltip, para saber de un vistazo cuáles ya se decidieron.
                const decision = item.fairEntry && item.fairEntry.treatmentDecision;
                const treatedBadge = decision
                    ? `<span class="ml-1 px-2 py-1 rounded text-xs bg-green-50 text-green-700 border-l-4 border-green-500" title="${sanitizeHTML(STRATEGY_LABELS[decision.strategy] || decision.strategy)} — Residual: ${fmt(decision.residualALE)}${decision.decidedAt ? ` (decidido el ${new Date(decision.decidedAt).toLocaleDateString('es-MX')})` : ''}">✔ Tratado</span>`
                    : '';

                // Señal de calibración desactualizada: este riesgo se calculó con una versión
                // anterior del modelo de Vulnerabilidad (ver VULNERABILITY_CALIBRATION_VERSION en
                // backend/src/lib/autocalc.js), así que sus números ya no son comparables con los
                // de un riesgo recién simulado. No se recalcula solo a propósito — sobrescribir en
                // silencio una evaluación guardada rompe la trazabilidad; el analista decide.
                const vigente = state.config.calibrationVersion;
                const staleBadge =
                    item.fairEntry && vigente != null && (item.fairEntry.calibrationVersion ?? 0) < vigente
                        ? `<span class="ml-1 px-2 py-1 rounded text-xs bg-orange-50 text-orange-800 border-l-4 border-orange-500" title="Calculado con una calibración anterior del modelo de Vulnerabilidad. Vuelve a simularlo desde Análisis FAIR para actualizar sus números.">⟳ Recalibrar</span>`
                        : '';

                const evalCell = item.fairEntry
                    ? `<span class="px-2 py-1 rounded text-xs border-l-4 ${item.fairEntry.evaluationClasses}">${item.fairEntry.evaluationLevel}</span>`
                    : '—';

                // Mismo Criterio ALE que ya usa "Evaluación" — cada monto se colorea según ESE
                // mismo umbral (ver computeFairRiskEquivalents), para que un riesgo "Crítico" se
                // vea igual de rojo en Inherente/Actual que en Evaluación, no distinto.
                const moneyBadge = (text, severity) =>
                    text && severity
                        ? `<span class="px-2 py-1 rounded text-xs border-l-4 ${severityToClasses(severity)}">${text}</span>`
                        : text || '—';

                // Las tres etapas del riesgo, en el mismo renglón y en orden:
                //   Inherente  — sin ningún control (vulnerabilidad al 100%).
                //   Actual     — con los controles vigentes; es entry.ale, el que alimenta la
                //                Matriz, el Pareto del Registro y la columna "Evaluación".
                //   Residual   — lo que queda DESPUÉS de adoptar una decisión de Tratamiento.
                //                "—" mientras no se haya decidido nada: no es un hueco de datos,
                //                es que todavía no existe esa etapa para ese riesgo.
                const inherenteCell = moneyBadge(item.riesgoInherente, item.riesgoInherenteSeverity);
                const actualCell = moneyBadge(item.riesgoActual, item.riesgoActualSeverity);
                const residualCell = item.riesgoResidual
                    ? `${moneyBadge(item.riesgoResidual, item.riesgoResidualSeverity)}${
                          item.riesgoResidualStrategy
                              ? `<span class="block text-xs text-gray-500 mt-1">${sanitizeHTML(STRATEGY_LABELS[item.riesgoResidualStrategy] || item.riesgoResidualStrategy)}</span>`
                              : ''
                      }`
                    : '<span class="text-gray-400">— sin tratar</span>';
                const cvarCell = item.fairEntry ? fmt(item.fairEntry.cvar95) : '—';
                const dateCell = formatDate(item.fairEntry ? item.fairEntry.date : item.createdAt);

                // Selecciona uno o más riesgos (cualquier etapa) para verlos en "Análisis
                // Profundo" — ver showDeepAnalysis(). rowKey es estable: el id de la entrada de
                // FAIR si ya existe, o el id del riesgo de Análisis Rápido si todavía no.
                const checkboxCell = item.rowKey
                    ? `<input type="checkbox" class="concentrated-checkbox" data-id="${item.rowKey}" />`
                    : '';

                // "Analizar" abre el wizard completo de FAIR (pasos 1-3; Tratamiento ya no vive
                // ahí, ver "Tratar" abajo) para ESTE riesgo — a diferencia de "Simular" (un
                // vistazo rápido de solo lectura sin salir del Registro). Es la vista de detalle
                // por riesgo. "Tratar" no aplica a una Oportunidad (ver App.Treatment) — se
                // omite el botón en vez de mandar a una página que lo va a rechazar.
                const treatBtn =
                    item.stage === 'fair' && item.fairEntry.riskType !== 'oportunidad'
                        ? `<button class="btn btn-success text-xs ml-1" data-treat-fair title="Tratar este riesgo (Mitigar/Transferir/Evitar/Aceptar)"><i class="fas fa-shield-halved mr-1"></i>Tratar</button>`
                        : '';
                const actionsCell =
                    item.stage === 'fair'
                        ? `<button class="btn btn-primary text-xs" data-analyze-fair="${sanitizeHTML(item.fairEntry.riskName)}"><i class="fas fa-balance-scale mr-1"></i>Analizar</button>
                    <button class="btn btn-secondary text-xs ml-1" data-simulate-risk="${sanitizeHTML(item.fairEntry.riskName)}" ${item.fairEntry.tef && item.fairEntry.vuln && item.fairEntry.lossMagnitudes ? '' : 'disabled title="Este riesgo se guardó antes de esta función — vuelve a correr su simulación desde Análisis FAIR para poder verla aquí."'}>
                        <i class="fas fa-chart-bar mr-1"></i>Simular
                    </button>
                    ${treatBtn}
                    <button class="inline-flex items-center justify-center p-2 text-red-600 hover:text-red-800 text-sm ml-2" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-risk="${sanitizeHTML(item.fairEntry.riskName)}" data-delete-source-id="${item.id || ''}" data-delete-entry-id="${item.fairEntry.id || ''}"><i class="fas fa-trash"></i></button>`
                        : `<button class="btn btn-primary text-xs" data-analyze-quick="${item.id}" ${item.fullData ? '' : 'disabled title="No se encontró la información completa de este riesgo."'}><i class="fas fa-balance-scale mr-1"></i>Analizar con FAIR</button>
                    <button class="inline-flex items-center justify-center p-2 text-red-600 hover:text-red-800 text-sm ml-2" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-quick="${item.id}"><i class="fas fa-trash"></i></button>`;

                return `
                <tr class="border-b">
                    <td class="py-2 text-center">${checkboxCell}</td>
                    <td class="text-center text-gray-500">${item.number}</td>
                    <td class="risk-name-cell">${sanitizeHTML(item.riskName)}</td>
                    <td>${stageBadge}${treatedBadge}${staleBadge}</td>
                    <td>${inherenteCell}</td>
                    <td>${item.controlEffectiveness || '—'}</td>
                    <td>${actualCell}</td>
                    <td>${residualCell}</td>
                    <td>${sanitizeHTML(item.asset)}</td>
                    <td>${cvarCell}</td>
                    <td>${evalCell}</td>
                    <td>${dateCell}</td>
                    <td class="whitespace-nowrap">${actionsCell}</td>
                </tr>`;
            })
            .join('');

        bodies.forEach((tb) => {
            tb.innerHTML = rowsHTML;
        });

        document.querySelectorAll('[data-delete-risk]').forEach((btn) => {
            btn.addEventListener('click', () =>
                this.deleteConcentratedRisk({
                    riskName: btn.dataset.deleteRisk,
                    sourceId: btn.dataset.deleteSourceId || null,
                    entryId: btn.dataset.deleteEntryId || null,
                }),
            );
        });
        document.querySelectorAll('[data-simulate-risk]').forEach((btn) => {
            btn.addEventListener('click', () => this.simulateRegisteredRisk(btn.dataset.simulateRisk));
        });
        document.querySelectorAll('[data-treat-fair]').forEach((btn) => {
            // El nombre sale del texto ya renderizado (.risk-name-cell), no de un atributo —
            // mismo motivo que App.RiskCascadeTree.render(): sanitizeHTML no escapa comillas
            // dobles, así que un nombre de riesgo con " rompería un atributo data-treat-fair="...".
            btn.addEventListener('click', () => {
                const riskName = btn.closest('tr').querySelector('.risk-name-cell').textContent;
                App.Navigation.switchPage('treatment');
                App.Treatment.load(riskName);
            });
        });
        document.querySelectorAll('[data-delete-quick]').forEach((btn) => {
            btn.addEventListener('click', () =>
                this.deleteConcentratedRisk({ riskName: null, sourceId: btn.dataset.deleteQuick }),
            );
        });
        document.querySelectorAll('[data-analyze-fair]').forEach((btn) => {
            btn.addEventListener('click', () => {
                App.Navigation.switchPage('fair');
                App.FairWizard.loadRegisteredRiskIntoForm(btn.dataset.analyzeFair);
            });
        });
        document.querySelectorAll('[data-analyze-quick]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const item = (state.fair.concentratedRisks || []).find((x) => x.id === btn.dataset.analyzeQuick);
                if (!item || !item.fullData) {
                    showToast('No se encontró la información de este riesgo.');
                    return;
                }
                App.Navigation.switchPage('fair');
                App.FairAnalysis.receiveData([item.fullData]);
            });
        });
        document.querySelectorAll('.concentrated-checkbox').forEach((cb) => {
            cb.addEventListener('change', () => this.updateDeepAnalysisBtnState());
        });
        this.updateDeepAnalysisBtnState();
    },

    toggleSelectAll(tbodyId, checked) {
        document.querySelectorAll(`#${tbodyId} .concentrated-checkbox`).forEach((cb) => {
            cb.checked = checked;
        });
        this.updateDeepAnalysisBtnState();
    },

    updateDeepAnalysisBtnState() {
        const tbodyId = 'quick-concentrated-table-body';
        const btn = document.getElementById('fair-deep-analysis-btn');
        if (!btn) return;
        const anyChecked = document.querySelectorAll(`#${tbodyId} .concentrated-checkbox:checked`).length > 0;
        btn.disabled = !anyChecked;
    },

    // "Análisis Profundo": muestra, de un vistazo y sin salir del Registro, todos los datos
    // con los que se calculó cada riesgo seleccionado (TEF, Vulnerabilidad, Magnitud de
    // Pérdida por categoría, sensibilidad, evaluación) — de momento el detalle básico ya
    // guardado en el Registro; ver buildDeepAnalysisCard.
    showDeepAnalysis(tbodyId) {
        const selectedKeys = Array.from(document.querySelectorAll(`#${tbodyId} .concentrated-checkbox:checked`)).map(
            (cb) => cb.dataset.id,
        );
        const selectedItems = (state.fair.concentratedRisks || []).filter((item) =>
            selectedKeys.includes(String(item.rowKey)),
        );
        if (selectedItems.length === 0) return;

        document.getElementById('fair-deep-analysis-body').innerHTML = selectedItems
            .map((item) => this.buildDeepAnalysisCard(item))
            .join('');
        document.getElementById('fair-deep-analysis-panel').classList.remove('hidden');
        document.getElementById('fair-deep-analysis-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    buildDeepAnalysisCard(item) {
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const entry = item.fairEntry;

        if (!entry) {
            const fd = item.fullData || {};
            // Riesgo Inherente/Residual/ALE (%) solo existen en datos de la vieja Vista
            // Rápida (eliminada) — un borrador guardado con "Guardar" (Paso 1) nunca los
            // tiene. Se muestran solo si de verdad hay algo que mostrar, para no llenar la
            // tarjeta de guiones sin sentido.
            const hasLegacyEstimate = item.riesgoInherente || item.riesgoResidual || item.quickAle;
            return `
                <div class="p-4 bg-white rounded-lg border border-gray-200">
                    <h4 class="text-base font-semibold text-gray-800 mb-2">${sanitizeHTML(item.riskName)}</h4>
                    <p class="description-text mb-2">Este riesgo se guardó desde el Paso 1 sin completar el resto del análisis — usa "Analizar con FAIR" para calcular su Impacto, CVaR y Evaluación.</p>
                    <ul class="text-sm text-gray-700 space-y-1">
                        <li><strong>Activo:</strong> ${sanitizeHTML(item.asset || '—')}</li>
                        <li><strong>Amenaza:</strong> ${sanitizeHTML(fd.threat) || '—'}</li>
                        <li><strong>Descripción:</strong> ${sanitizeHTML(fd.riskDescription) || '—'}</li>
                        ${
                            hasLegacyEstimate
                                ? `
                        <li><strong>Riesgo Inherente:</strong> ${item.riesgoInherente ?? '—'}</li>
                        <li><strong>Riesgo Residual:</strong> ${item.riesgoResidual ?? '—'}</li>
                        <li><strong>ALE estimado:</strong> ${item.quickAle || '—'}</li>`
                                : ''
                        }
                    </ul>
                </div>`;
        }

        const rangeRow = (label, range, suffix = '') =>
            range
                ? `<tr><td class="py-1 pr-3 text-gray-600">${label}</td><td class="py-1 pr-3">${range.min}${suffix}</td><td class="py-1 pr-3 font-semibold">${range.mode}${suffix}</td><td class="py-1">${range.max}${suffix}</td></tr>`
                : '';
        const lossRows = entry.lossMagnitudes
            ? LOSS_FORMS_KEYS.map((key) => {
                  const f = entry.lossMagnitudes[key];
                  if (!f) return '';
                  return `<tr><td class="py-1 pr-3 text-gray-600">${LOSS_FORM_LABELS.tecnico[key]}</td><td class="py-1 pr-3">${fmt(f.min)}</td><td class="py-1 pr-3 font-semibold">${fmt(f.mode)}</td><td class="py-1">${fmt(f.max)}</td></tr>`;
              }).join('')
            : '';
        const sensitivityHTML = (entry.sensitivity || [])
            .slice(0, 5)
            .map((s) => `<li>${sensitivityLabel(s)}: ${(s.correlation * 100).toFixed(1)}%</li>`)
            .join('');

        return `
            <div class="p-4 bg-white rounded-lg border border-gray-200">
                <div class="flex justify-between items-start flex-wrap gap-2 mb-2">
                    <h4 class="text-base font-semibold text-gray-800">${sanitizeHTML(item.riskName)}</h4>
                    <span class="px-2 py-1 rounded text-xs border-l-4 ${entry.evaluationClasses}">${entry.evaluationLevel}</span>
                </div>
                <ul class="text-sm text-gray-700 space-y-1 mb-3">
                    <li><strong>Activo:</strong> ${sanitizeHTML(entry.asset || '—')}</li>
                    <li><strong>Responsable:</strong> ${sanitizeHTML(entry.owner || '—')}</li>
                    <li><strong>${shortMetricLabel('ale', 'Pérdida Anual Esperada (ALE)')}:</strong> ${fmt(entry.ale)}</li>
                    <li><strong>${shortMetricLabel('cvar95', 'CVaR 95%')}:</strong> ${fmt(entry.cvar95)}</li>
                    ${item.riesgoInherente ? `<li><strong>Riesgo Inherente (sin controles):</strong> ${item.riesgoInherente}</li>` : ''}
                    ${item.controlEffectiveness ? `<li><strong>Efectividad de Controles:</strong> ${item.controlEffectiveness}</li>` : ''}
                    <li><strong>Fecha del análisis:</strong> ${entry.date ? new Date(entry.date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</li>
                    ${entry.evaluationJustification ? `<li><strong>Justificación:</strong> ${sanitizeHTML(entry.evaluationJustification)}</li>` : ''}
                </ul>
                ${
                    entry.tef || entry.vuln
                        ? `
                <table class="w-full text-sm mb-3">
                    <thead><tr class="text-left text-gray-500"><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr></thead>
                    <tbody>
                        ${rangeRow('Frecuencia de Evento de Amenaza (contactos/año)', entry.tef)}
                        ${rangeRow('Vulnerabilidad', entry.vuln, '%')}
                    </tbody>
                </table>`
                        : ''
                }
                ${
                    lossRows
                        ? `
                <h5 class="text-sm font-semibold text-gray-800 mb-1">Magnitud de Pérdida</h5>
                <table class="w-full text-sm mb-3">
                    <thead><tr class="text-left text-gray-500"><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr></thead>
                    <tbody>${lossRows}</tbody>
                </table>`
                        : ''
                }
                ${
                    sensitivityHTML
                        ? `
                <h5 class="text-sm font-semibold text-gray-800 mb-1">Variables más influyentes</h5>
                <ul class="text-sm text-gray-700 list-disc list-inside">${sensitivityHTML}</ul>`
                        : ''
                }
            </div>`;
    },

    // El Pareto 80-20 (ordenado, con % acumulado) ya viene calculado del backend
    // (GET /api/register → pareto) — aquí solo se dibuja.
    renderParetoChart() {
        const pareto = state.fair.registerPareto;
        if (!pareto) return;

        document.getElementById('fair-pareto-summary').textContent =
            `${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount} riesgo(s) concentran el 80% de tu exposición total (${formatCurrency(pareto.totalExposure)}/año). Prioriza el tratamiento en esos primero.`;

        // Antes el eje X mostraba el nombre completo de cada riesgo, rotado 45° — con un
        // nombre largo, la etiqueta terminaba ocupando más alto que el gráfico mismo. Ahora
        // cada barra lleva solo su número (1 = mayor ALE, igual que el orden del Pareto) y la
        // lista de abajo (#fair-pareto-legend) dice qué riesgo es cada uno — mismo patrón que
        // ya usa la Matriz de Riesgos. También resuelve una ambigüedad real: dos
        // riesgos legítimamente pueden compartir nombre (ver registerIdentity.js), y con solo
        // el nombre como etiqueta no había forma de distinguir cuál barra era cuál.
        document.getElementById('fair-pareto-legend').innerHTML = `
            <p class="font-semibold text-gray-700 mb-2">Riesgos en el gráfico</p>
            <ol class="space-y-1">
                ${pareto.risks.map((r, i) => `<li><strong>${i + 1}.</strong> ${sanitizeHTML(r.riskName)}</li>`).join('')}
            </ol>`;

        const canvas = document.getElementById('fair-pareto-chart');
        if (state.fair.paretoChart) state.fair.paretoChart.destroy();
        state.fair.paretoChart = new Chart(canvas, {
            // Chart.js exige un "type" a nivel raíz incluso en gráficos mixtos (cada dataset
            // ya trae el suyo) — sin esto no lanza error, simplemente no dibuja nada, que es
            // justo lo que pasaba aquí.
            type: 'bar',
            data: {
                labels: pareto.risks.map((r, i) => String(i + 1)),
                datasets: [
                    {
                        type: 'bar',
                        label: 'Pérdida Anual Esperada',
                        data: pareto.risks.map((r) => r.ale),
                        backgroundColor: 'rgba(124, 58, 237, 0.6)',
                        yAxisID: 'y',
                        // Sin esto, con pocos riesgos guardados (1-3) cada barra se estira para
                        // llenar todo el ancho disponible, con espacios enormes entre ellas — se
                        // ve "desparramado" en vez de una barra de ancho razonable y consistente,
                        // tenga 2 o 20 riesgos el Registro.
                        maxBarThickness: 70,
                    },
                    {
                        type: 'line',
                        label: '% Acumulado',
                        data: pareto.risks.map((r) => r.cumulativePercent),
                        borderColor: '#B22222',
                        backgroundColor: '#B22222',
                        yAxisID: 'y1',
                        // Bug real corregido: con tension > 0 (curva Bezier), un punto que hace
                        // meseta cerca del 100% (típico del % acumulado, que por definición se
                        // achata hacia el final) hace que la curva SOBREPASE el valor más alto
                        // entre dos puntos — visualmente "se sale" por arriba del cuadro, aunque
                        // ningún dato real exceda 100. El % acumulado tampoco es una cantidad que
                        // deba interpolarse suavizada (cada segmento representa un salto discreto
                        // al sumar un riesgo más) — una línea recta es además más correcta.
                        tension: 0,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // El punto más alto suele caer justo en max:100 del eje y1 (borde superior del
                // área de dibujo) — sin este margen, la mitad de su marcador (radio ~3px) queda
                // pegada al borde del cuadro y se ve como si "se saliera" de él.
                layout: { padding: { top: 10 } },
                scales: {
                    y: {
                        position: 'left',
                        beginAtZero: true,
                        title: { display: true, text: 'Pérdida Anual Esperada' },
                        ticks: { callback: (v) => formatCurrency(v) },
                    },
                    y1: {
                        position: 'right',
                        beginAtZero: true,
                        max: 100,
                        title: { display: true, text: '% Acumulado' },
                        grid: { drawOnChartArea: false },
                    },
                    // Ya no hace falta rotar nada — la etiqueta es solo un número (ver el
                    // comentario de arriba sobre labels/fair-pareto-legend).
                    x: { title: { display: true, text: 'Riesgo #' } },
                },
                plugins: {
                    legend: { position: 'bottom' },
                    // El eje ya no muestra el nombre — se agrega como título del tooltip para no
                    // perder esa información al pasar el mouse, aunque la lista de abajo también
                    // la tenga siempre visible.
                    tooltip: {
                        callbacks: {
                            title: (items) => pareto.risks[items[0].dataIndex].riskName,
                        },
                    },
                },
            },
        });
    },

    // El promedio de sensibilidad por variable, considerando todos los riesgos guardados,
    // también viene ya calculado del backend (GET /api/register → consolidatedSensitivity).
    renderConsolidatedSensitivity() {
        const container = document.getElementById('fair-consolidated-sensitivity-list');
        const averaged = state.fair.registerConsolidatedSensitivity || [];

        if (averaged.length === 0) {
            container.innerHTML = `<p class="description-text">Aún no hay suficientes datos de sensibilidad guardados.</p>`;
            return;
        }
        const maxVal = Math.max(...averaged.map((a) => a.averageCorrelation), 0.0001);
        container.innerHTML = averaged
            .map((a) => {
                const pct = Math.max(2, Math.round((a.averageCorrelation / maxVal) * 100));
                return `
                <div class="mb-2">
                    <div class="flex justify-between text-sm"><span>${sensitivityLabel(a)}</span><span>${(a.averageCorrelation * 100).toFixed(1)}%</span></div>
                    <div class="w-full bg-gray-200 rounded h-2"><div class="h-2 rounded bg-purple-600" style="width:${pct}%;"></div></div>
                </div>`;
            })
            .join('');
    },

    // Re-simula un riesgo ya guardado usando sus inputs originales (tef/vuln/lossMagnitudes)
    // y su semilla — misma reproducibilidad exacta que documenta /api/simulate. Siempre a
    // 10,000 iteraciones (tope único para todas las simulaciones, ver backend/validate.js).
    async simulateRegisteredRisk(riskName) {
        const risk = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!risk || !risk.tef || !risk.vuln || !risk.lossMagnitudes) {
            showToast(
                'Este riesgo no tiene los datos guardados para re-simular. Vuelve a correrlo desde Análisis FAIR.',
            );
            return;
        }

        const section = document.getElementById('fair-register-simulation');
        const loading = document.getElementById('fair-register-simulation-loading');
        const body = document.getElementById('fair-register-simulation-body');
        document.getElementById('fair-register-simulation-title').textContent =
            `Simulación Detallada: ${risk.riskName}`;
        section.classList.remove('hidden');
        loading.classList.remove('hidden');
        loading.textContent = 'Simulando 10,000 escenarios…';
        body.classList.add('hidden');
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });

        let result;
        try {
            result = await App.Api.request('/api/simulate', {
                method: 'POST',
                body: {
                    iterations: 10000,
                    seed: risk.seed || 0,
                    tef: risk.tef,
                    vuln: risk.vuln,
                    lossMagnitudes: risk.lossMagnitudes,
                    // Sin esto, una 'oportunidad' guardada se re-simulaba asumiendo
                    // 'amenaza' (el default del backend) — el `evaluation` que devuelve la
                    // respuesta quedaría mal calculado (aunque esta vista no lo muestre hoy).
                    riskType: risk.riskType || 'amenaza',
                },
            });
        } catch (e) {
            loading.textContent = e.userMessage || 'No se pudo simular este riesgo.';
            return;
        }

        loading.classList.add('hidden');
        body.classList.remove('hidden');

        document.getElementById('fair-register-sim-ale').textContent = formatCurrency(result.summary.average);
        document.getElementById('fair-register-sim-median').textContent = formatCurrency(result.summary.median);
        document.getElementById('fair-register-sim-p90').textContent = formatCurrency(result.summary.p90);
        document.getElementById('fair-register-sim-cvar').textContent = formatCurrency(result.summary.cvar95);

        const sensContainer = document.getElementById('fair-register-sim-sensitivity');
        const top = (result.sensitivity || []).slice(0, 5);
        const maxAbs = Math.max(...top.map((s) => Math.abs(s.correlation)), 0.0001);
        sensContainer.innerHTML = top
            .map((s) => {
                const pct = Math.max(2, Math.round((Math.abs(s.correlation) / maxAbs) * 100));
                const color = s.correlation >= 0 ? '#3B82F6' : '#EF4444';
                return `
                <div class="mb-2">
                    <div class="flex justify-between text-sm"><span>${sensitivityLabel(s)}</span><span>${(s.correlation * 100).toFixed(1)}%</span></div>
                    <div class="w-full bg-gray-200 rounded h-2"><div class="h-2 rounded" style="width:${pct}%; background-color:${color};"></div></div>
                </div>`;
            })
            .join('');

        // Histograma — mismo binning que el de Análisis FAIR (ver buildHistogramBins en utils.js).
        const ctx = document.getElementById('fair-register-sim-chart').getContext('2d');
        const { labels, binCounts } = buildHistogramBins(result.annualLosses, result.summary.max);
        if (state.fair.registerSimChart) state.fair.registerSimChart.destroy();
        state.fair.registerSimChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Frecuencia de Pérdida Anual',
                        data: binCounts,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                    x: {
                        title: { display: true, text: 'Pérdida Anual Estimada (miles de USD)' },
                        ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 },
                    },
                },
            },
        });
    },

    // Síntesis del portafolio completo (no de un riesgo aislado) — cuenta por nivel de
    // severidad, qué riesgos concentran el 80% de la exposición (ya calculado por el
    // backend en /api/register) y cuál variable más vale la pena mejorar en promedio.
    renderPortfolioInterpretation(register) {
        const container = document.getElementById('fair-register-interpretation');
        // Antes esta función solo se llamaba cuando el Registro ya tenía al menos un riesgo
        // simulado. Ahora la tabla concentrada puede mostrarse con riesgos que aún están
        // solo en Vista Rápida (register vacío) — este guardián cubre ese caso.
        if (!register || register.length === 0) {
            container.innerHTML = `<p class="description-text">Aún no tienes ningún riesgo analizado con FAIR — esta interpretación aparece en cuanto corras tu primera simulación.</p>`;
            return;
        }
        const pareto = state.fair.registerPareto;
        // Se agrupa por el campo "severity" crudo ('critico'/'alto'/'medio'/'bajo'), no por
        // el texto de evaluationLevel — ese texto no siempre contiene la palabra del nivel
        // (ej. "Aceptable" es severidad "bajo", "Requiere Tratamiento" es "alto").
        //
        // Solo se cuentan las amenazas: una 'oportunidad' también usa severity 'bajo'/'medio',
        // pero con el significado invertido (evaluateFairOpportunity — 'bajo' ahí significa
        // "Oportunidad Menor", no "riesgo bajo"). Contarla junto con las amenazas inflaba el
        // bucket "Bajo" con oportunidades buenas como si fueran riesgos triviales.
        const severityLabels = { critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo' };
        const bySeverity = { critico: 0, alto: 0, medio: 0, bajo: 0 };
        const threatRegister = register.filter((r) => r.riskType !== 'oportunidad');
        const opportunityCount = register.length - threatRegister.length;
        threatRegister.forEach((r) => {
            if (r.severity && bySeverity[r.severity] !== undefined) bySeverity[r.severity]++;
        });
        const parts = [];
        if (threatRegister.length > 0) {
            parts.push(
                `Tienes <strong>${threatRegister.length}</strong> amenaza${threatRegister.length === 1 ? '' : 's'} guardada${threatRegister.length === 1 ? '' : 's'}: ` +
                    Object.entries(bySeverity)
                        .filter(([, n]) => n > 0)
                        .map(([sev, n]) => `${n} en nivel <strong>${severityLabels[sev]}</strong>`)
                        .join(', ') +
                    (opportunityCount > 0
                        ? ` (+ ${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'}, ver tabla abajo).`
                        : '.'),
            );
        } else {
            parts.push(
                `Tienes <strong>${opportunityCount}</strong> oportunidad${opportunityCount === 1 ? '' : 'es'} guardada${opportunityCount === 1 ? '' : 's'} y ninguna amenaza — ver tabla abajo.`,
            );
        }

        if (pareto && pareto.risks.length > 0) {
            const topNames = pareto.risks.slice(0, pareto.riskCountFor80Percent).map((r) => sanitizeHTML(r.riskName));
            const exposicionTexto = `el 80% de tu exposición total (${formatCurrency(pareto.totalExposure)}/año)`;
            parts.push(
                `<strong>${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount}</strong> riesgo${pareto.riskCountFor80Percent === 1 ? '' : 's'} (${topNames.join(', ')}) concentra${pareto.riskCountFor80Percent === 1 ? '' : 'n'} ${exposicionTexto} — prioriza el tratamiento ahí antes que en los demás.`,
            );
        }

        const topSensitivity = (state.fair.registerConsolidatedSensitivity || [])[0];
        if (topSensitivity) {
            parts.push(
                `La variable que más mueve tus resultados, en promedio, es <strong>"${sensitivityLabel(topSensitivity)}"</strong> — mejorar la calidad de ese dato es donde más rendiría tu esfuerzo.`,
            );
        }

        container.innerHTML = parts.map((p) => `<p class="mb-2">${p}</p>`).join('');
    },
};

App.FairRegister = FairRegister;
