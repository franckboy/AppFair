import { App } from './app-namespace.js';
import { state } from './state.js';
import {
    LOSS_FORMS_KEYS,
    lossFormLabels,
    classifyPointSeverity,
    formatCurrency,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    tailContributorKind,
    severityToHex,
    shortMetricLabel,
    showToast,
    pertMean,
} from './utils.js';
import { STRATEGY_LABELS } from './treatment.js';
import { Modal } from './modal.js';

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
            // En qué se apoyan los números del Registro (ver renderProvenanceSummary) — también
            // calculado del lado del servidor, con la misma normalización que usa el resto.
            state.fair.registerProvenanceSummary = registerData.provenanceSummary || null;
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
            // Mismo criterio que inherentSeverity de abajo: gana la clasificación YA CALCULADA por
            // el backend (entry.residualSeverity, ver GET /api/register), que mira promedio Y cola.
            // La copia local solo mira el promedio, así que un residual con la cola por encima del
            // criterio Crítico se pintaba en verde. Se conserva como respaldo para respuestas de un
            // backend anterior, sin forzar una migración.
            residualSeverity:
                residualAle == null
                    ? null
                    : entry.residualSeverity ||
                      this.classifyAleAgainstCriteria(residualAle, entry.riskCriteriaOverride),
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
                    reviewDate,
                    dataSource: document.getElementById('fair-data-source').value,
                    // Procedencia por factor. Se manda siempre (los tres factores, forma completa):
                    // el backend la normaliza igual, y mandarla explícita deja el Registro
                    // autocontenido en vez de depender de una derivación al leer.
                    factorProvenance: App.FairWizard.readProvenance(),
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
                    calibrationVersion: state.fair.lastCalibrationVersion ?? null,
                    isDeliberate: deliberada,
                    accessLevel: deliberada ? document.getElementById('fair-access-level').value : 'nulo',
                    // Unidad en la que se mide el riesgo (ver backend/src/lib/exposure.js).
                    // null = años, o sea el comportamiento de todo riesgo anterior a esto.
                    exposure: App.FairWizard.readExposure(),
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

    _portfolioMcRequestId: 0,

    /**
     * Monte Carlo del PORTAFOLIO: simula todos los riesgos a la vez, en vez de sumar el resultado
     * de cada uno por separado.
     *
     * Por qué importa: el ALE sí se puede sumar (la esperanza es lineal), pero un percentil no —
     * `p90(X + Y) != p90(X) + p90(Y)`. CVaR es una medida coherente y por tanto SUBADITIVA, así
     * que sumar los individuales SOBRESTIMA la cola salvo que todos los riesgos ocurran el mismo
     * año. Se muestran los dos números juntos, nunca uno en lugar del otro: el usuario tiene que
     * poder ver de cuánto era la diferencia.
     *
     * Antes esto era una sola línea de texto dentro de Gestión de Riesgos
     * (`#riskmgmt-portfolio-mc`). Aquí tiene espacio para separar las tres cifras que de verdad
     * dicen algo distinto: la cola real, cuánto sobrestimaba la suma, y cuánto añade la
     * correlación declarada en el Árbol de Cascada.
     *
     * Guardián de condición de carrera: la simulación es cara (10.000 iteraciones por riesgo) y
     * una respuesta vieja no debe pisar a una nueva.
     */
    async renderPortfolioMonteCarlo() {
        const el = document.getElementById('dashboard-portfolio-mc');
        if (!el) return;
        const requestId = ++this._portfolioMcRequestId;

        let data;
        try {
            data = await App.Api.request('/api/register/portfolio-simulation');
        } catch {
            return; // silencioso: es información complementaria, no debe romper la página
        }
        if (requestId !== this._portfolioMcRequestId || !data || !data.summary) return;
        // Se cachea para que el interruptor Actual/Residual pueda repintar el reparto del año malo
        // sin volver a pedir la simulación (es cara: 10.000 iteraciones por riesgo, dos corridas).
        state.fair.portfolioSimulation = data;
        this.renderTailContributors();

        // Modo Simple prohíbe los acrónimos (ver simple-mode-no-jargon.spec.js): se dice lo mismo
        // en palabras. Las dos redacciones describen exactamente las mismas cifras.
        const simple = App.UIMode.mode === 'simple';
        // `estado` marca a qué mitad de la comparación pertenece cada fila, para que el interruptor
        // del Dashboard atenúe la que no se está mirando (ver renderDashboardViewControls). Sin
        // marca = siempre a plena opacidad (las notas que valen para los dos estados).
        const fila = (etiqueta, valor, detalle, estado) => `
            <div class="flex justify-between items-baseline gap-3 py-1 border-b border-gray-200 last:border-0"${
                estado ? ` data-portfolio-state="${estado}"` : ''
            }>
                <span>${etiqueta}</span>
                <strong class="whitespace-nowrap">${valor}</strong>
            </div>
            ${detalle ? `<p class="text-xs text-gray-500 mb-2">${detalle}</p>` : ''}`;

        const res = data.residual;
        const filas = [
            fila(
                simple ? 'En el 5% de años peores perderías, en promedio' : 'CVaR95 del portafolio',
                formatCurrency(data.summary.cvar95),
                `Simulando ${data.includedCount} ${data.includedCount === 1 ? 'amenaza' : 'amenazas'} a la vez.`,
                'actual',
            ),
            fila(
                simple ? '1 de cada 10 años pasaría de' : 'p90 del portafolio',
                formatCurrency(data.summary.p90),
                '',
                'actual',
            ),
        ];

        // Cifras duales: el estado actual y el residual, frente a frente. No se esconde ninguna con
        // el interruptor — comparar es el punto — solo se atenúa la que no se está mirando.
        // Las dos corridas usan la MISMA semilla, así que la resta es el efecto del tratamiento y
        // no ruido de muestreo (ver simulateResidualPortfolio en el backend).
        if (res && res.summary && res.treatedCount > 0) {
            filas.push(
                fila(
                    simple ? 'Lo mismo, pero después de tratar' : 'CVaR95 del portafolio, después de tratar',
                    formatCurrency(res.summary.cvar95),
                    `Con las estrategias ya adoptadas en ${res.treatedCount} ${
                        res.treatedCount === 1 ? 'riesgo' : 'riesgos'
                    }.`,
                    'residual',
                ),
            );
            if (res.tailSavings > 0) {
                filas.push(
                    fila(
                        simple ? 'Lo que te ahorra tratarlos, en los años malos' : 'Ahorro en la cola',
                        formatCurrency(res.tailSavings),
                        res.nonScalableRiskNames && res.nonScalableRiskNames.length > 0
                            ? `No incluye ${res.nonScalableRiskNames.length} con seguro: un deducible y un límite recortan las pérdidas más grandes en vez de reducirlas de forma pareja, así que su efecto no se puede simular con estos datos.`
                            : '',
                        'residual',
                    ),
                );
            }
        }

        // Diversificación y correlación van en direcciones opuestas y se reportan por separado:
        // juntarlas en una sola resta contra la suma no mide ninguna de las dos.
        if (data.includedCount > 1 && data.diversificationBenefit > 0) {
            const pct =
                data.sumOfIndividualCVaR > 0 ? (100 * data.diversificationBenefit) / data.sumOfIndividualCVaR : 0;
            filas.push(
                fila(
                    simple ? 'Menos de lo que daría sumarlos por separado' : 'Beneficio de diversificación',
                    `${formatCurrency(data.diversificationBenefit)} (${pct.toFixed(0)}%)`,
                    'Porque no todos los riesgos ocurren el mismo año.',
                    'actual',
                ),
            );
        }
        if (data.cascadeEdgeCount > 0) {
            // La penalización puede salir NEGATIVA — no es un caso imposible ni un error de signo:
            // el arrastre de la cascada mueve como mucho UNA ocurrencia por año, así que en un
            // riesgo casi enteramente inducido le tapa sus años de varios eventos y le adelgaza la
            // cola (ver el comentario de correlationPenalty en portfolioSimulation.js). Etiquetarlo
            // igual que un valor positivo diría lo contrario de lo que pasó.
            const penaliza = data.correlationPenalty >= 0;
            const dependencias = `${data.cascadeEdgeCount} ${
                data.cascadeEdgeCount === 1 ? 'dependencia declarada' : 'dependencias declaradas'
            } en el Árbol: esos riesgos caen el mismo año.`;
            filas.push(
                fila(
                    penaliza
                        ? simple
                            ? 'Suma de más porque unos riesgos arrastran a otros'
                            : 'Penalización por correlación'
                        : simple
                          ? 'Resta porque un riesgo pasa a ocurrir solo cuando lo arrastra otro'
                          : 'Efecto de la correlación (a la baja)',
                    formatCurrency(data.correlationPenalty),
                    penaliza
                        ? dependencias
                        : `${dependencias} Sale a la baja porque una causa arrastra a su efecto como mucho una vez al año, y eso le quita los años de varios eventos.`,
                    'actual',
                ),
            );
        }

        // Mitigaciones adoptadas antes de que la Decisión guardara su receta (ver hasLegacyResidual
        // en el backend). El portafolio las reconstruye escalando, y eso SOBREESTIMA su cola — hasta
        // el triple, medido. Decir solo "recalcula" dejaría al usuario sin saber hacia qué lado está
        // el error, que es justo lo que necesita para decidir si le urge: una cola inflada es
        // conservadora, no peligrosa, y eso cambia la prioridad con la que se atiende.
        const heredados = (res && res.legacyResidualRiskNames) || [];
        const avisoHeredado =
            heredados.length > 0
                ? `<p class="text-xs mt-2 p-2 rounded bg-blue-50 border-l-4 border-blue-500 text-blue-900">
                       La cola de ${heredados.length === 1 ? 'este riesgo está' : 'estos riesgos está'}
                       <strong>sobreestimada por seguridad</strong>:
                       <strong>${heredados.map((n) => sanitizeHTML(n)).join(', ')}</strong>.
                       ${heredados.length === 1 ? 'Su mitigación se adoptó' : 'Sus mitigaciones se adoptaron'}
                       antes de que la decisión guardara con qué se simuló, así que el portafolio
                       ${heredados.length === 1 ? 'la reconstruye' : 'las reconstruye'} como si toda la reducción
                       hubiera sido prevención. El promedio sale bien; el mal año sale más alto de lo real.
                       Vuelve a adoptar la estrategia en Tratamiento para ver su forma verdadera.
                   </p>`
                : '';

        // Contradicción en las dependencias declaradas: los padres de estos riesgos los causan más
        // veces de las que el propio riesgo dice ocurrir. El motor ya lo acota para no inflar el
        // portafolio (ver overCoupledRiskNames en portfolioSimulation.js), pero callarlo dejaría
        // al usuario sin saber que sus datos se contradicen — y es un dato que solo él puede
        // corregir, bajando la probabilidad de la arista o subiendo la frecuencia del hijo.
        const contradictorios = data.overCoupledRiskNames || [];
        const aviso =
            contradictorios.length > 0
                ? `<p class="text-xs mt-2 p-2 rounded bg-yellow-50 border-l-4 border-yellow-500 text-yellow-800">
                       Revisa ${contradictorios.length === 1 ? 'este riesgo' : 'estos riesgos'}:
                       <strong>${contradictorios.map((n) => sanitizeHTML(n)).join(', ')}</strong>.
                       Las causas que le declaraste en el Árbol lo provocan más veces de las que dijiste que ocurre.
                       Baja la probabilidad de esas causas, o sube su frecuencia.
                   </p>`
                : '';

        el.innerHTML =
            filas.join('') +
            avisoHeredado +
            aviso +
            (data.skippedCount > 0
                ? `<p class="text-xs text-gray-500 mt-2">${data.skippedCount} sin datos suficientes para simular.</p>`
                : '');
        // El bloque se acaba de repintar: hay que volver a aplicar la atenuación del estado que no
        // se está mirando, o las filas nuevas saldrían todas a plena opacidad.
        this.renderDashboardViewControls();
    },

    // Cuántos riesgos se listan antes de agrupar el resto en una sola fila. Más allá de esto la
    // lista deja de ordenar un presupuesto y empieza a ser un volcado.
    _TAIL_CONTRIB_VISIBLE: 8,

    /**
     * De quién es el año malo — reparto del CVaR95 conjunto entre los riesgos que lo componen.
     *
     * Qué pregunta responde, y por qué no la contesta ningún otro bloque del Dashboard: el Monte
     * Carlo del Portafolio dice cuánto vale el año malo del conjunto, y el Pareto dice quién pesa
     * más en el año PROMEDIO. Ninguno dice quién pesa en el año MALO, y no es lo mismo — un riesgo
     * raro y severo puede ser el 8 % del promedio y el 31 % de la cola. Tampoco sirve mirar el
     * CVaR de cada riesgo por separado: eso ignora con quién coincide, y coincidir es justamente
     * lo que arma un mal año.
     *
     * El reparto suma exactamente el CVaR95 del portafolio (ver allocateTailContributions en el
     * backend), así que los porcentajes cierran en 100 sin resto que repartir a ojo.
     *
     * Sigue el interruptor Actual/Residual: aquí sí se cambia el contenido entero en vez de
     * atenuar, porque son dos repartos distintos de dos totales distintos y superponerlos no se
     * podría leer.
     */
    renderTailContributors() {
        const el = document.getElementById('dashboard-tail-contrib');
        if (!el) return;
        const data = state.fair.portfolioSimulation;
        const residual = state.fair.dashboardView === 'residual';
        const fuente = residual && data && data.residual ? data.residual : data;
        const filas = (fuente && fuente.tailContributors) || [];
        const total = fuente && fuente.summary ? fuente.summary.cvar95 : 0;

        const desc = document.getElementById('dashboard-tail-contrib-desc');
        if (desc) {
            desc.textContent = residual
                ? 'De los años peores del portafolio DESPUÉS de tratar, cuánto pone cada riesgo.'
                : 'De los años peores del portafolio, cuánto pone cada riesgo. Sigue el interruptor de arriba.';
        }

        if (filas.length === 0 || !(total > 0)) {
            el.innerHTML = '<p class="text-gray-500">Corre al menos una simulación para ver el reparto.</p>';
            return;
        }

        const simple = App.UIMode.mode === 'simple';
        // Cuántos riesgos hacen falta para juntar el 80 % del año malo. Es el titular: si son tres
        // de veinte, el presupuesto ya está ordenado antes de leer la lista.
        let acumulado = 0;
        let cuantos = 0;
        for (const f of filas) {
            if (acumulado >= 80) break;
            acumulado += f.sharePercent;
            cuantos++;
        }

        const mayor = filas[0].sharePercent || 1;
        const visibles = filas.slice(0, this._TAIL_CONTRIB_VISIBLE);
        const resto = filas.slice(this._TAIL_CONTRIB_VISIBLE);

        const barra = (f) => {
            // La clasificación vive en utils.js (función pura) para poder probarla sin DOM: es una
            // afirmación estadística sobre el portafolio, y verificarla en un E2E contra el
            // Registro compartido no funciona — con riesgos ajenos dominando la cola, la
            // distinción desaparece de verdad, no por un fallo de la prueba.
            const clase = tailContributorKind(f);
            const deCola = clase === 'cola';
            const recurrente = clase === 'recurrente';
            const etiqueta = deCola
                ? `<span class="text-xs font-semibold text-orange-700 whitespace-nowrap">· pesa más en los años malos</span>`
                : recurrente
                  ? `<span class="text-xs text-gray-500 whitespace-nowrap">· costo recurrente</span>`
                  : '';
            return `
                <div class="py-1 border-b border-gray-200 last:border-0">
                    <div class="flex justify-between items-baseline gap-3">
                        <span class="truncate">${sanitizeHTML(f.riskName)} ${etiqueta}</span>
                        <strong class="whitespace-nowrap">${formatCurrency(f.contribution)} (${f.sharePercent.toFixed(1)}%)</strong>
                    </div>
                    <div class="h-1.5 bg-gray-200 rounded mt-1">
                        <div class="h-1.5 rounded ${deCola ? 'bg-orange-500' : 'bg-blue-500'}" style="width: ${Math.max(1, (100 * f.sharePercent) / mayor).toFixed(1)}%"></div>
                    </div>
                </div>`;
        };

        // Concordancia: el sustantivo va con el TOTAL de riesgos y el verbo con cuántos hacen el
        // 80 % ("1 de 4 riesgos explica", no "explican").
        const sujeto = `<strong>${cuantos}</strong> de ${filas.length} ${filas.length === 1 ? 'riesgo' : 'riesgos'} ${
            cuantos === 1 ? 'explica' : 'explican'
        }`;
        const cuota = `el ${Math.min(100, acumulado).toFixed(0)} %`;
        const titular = simple
            ? `<p class="mb-3">${sujeto} ${cuota} de lo que perderías en un año malo (${formatCurrency(total)}).</p>`
            : `<p class="mb-3">${sujeto} ${cuota} del CVaR95 del portafolio (${formatCurrency(total)}).</p>`;

        const filaResto =
            resto.length > 0
                ? `<div class="flex justify-between items-baseline gap-3 py-1 text-gray-500">
                       <span>Otros ${resto.length} riesgos</span>
                       <strong class="whitespace-nowrap">${formatCurrency(resto.reduce((a, f) => a + f.contribution, 0))} (${resto.reduce((a, f) => a + f.sharePercent, 0).toFixed(1)}%)</strong>
                   </div>`
                : '';

        el.innerHTML =
            titular +
            visibles.map(barra).join('') +
            filaResto +
            `<p class="text-xs text-gray-500 mt-2">Reparto del año malo conjunto, no la suma de los años malos de cada uno: cuenta con quién coincide cada riesgo. Los porcentajes cierran en 100 %.</p>`;
    },

    /**
     * ¿En qué se apoyan estos números? — cuánto del Registro está sostenido por algo observado.
     *
     * Se cuenta por FACTOR y no por riesgo, y ésa es la decisión que hace útil al bloque: los tres
     * factores se multiplican para dar el ALE, así que pesan exactamente igual (la elasticidad de
     * los tres es 1). Un riesgo con Frecuencia histórica y Magnitud inventada no está "sostenido a
     * medias" — tiene un factor de tres. Contar por riesgo escondería justo el desbalance que este
     * bloque existe para mostrar: hoy la Vulnerabilidad tiene nueve anclas de experto detrás y los
     * otros dos factores, ninguna.
     */
    renderProvenanceSummary(resumen) {
        const el = document.getElementById('dashboard-provenance');
        if (!el) return;
        if (!resumen || resumen.total === 0) {
            el.innerHTML = '<p class="text-gray-500">Analiza al menos un riesgo para ver en qué se apoya.</p>';
            return;
        }

        const ETIQUETAS = {
            tef: 'Con qué frecuencia pasa',
            vulnerabilidad: 'Qué tan probable es que funcione',
            magnitud: 'Cuánto cuesta',
        };
        const filas = Object.entries(ETIQUETAS)
            .map(([key, etiqueta]) => {
                const f = resumen.porFactor[key] || { conDatos: 0, total: resumen.total, observaciones: 0 };
                const pct = f.total > 0 ? (100 * f.conDatos) / f.total : 0;
                const obs =
                    f.observaciones > 0
                        ? `<span class="text-xs text-gray-500">· ${f.observaciones} ${f.observaciones === 1 ? 'observación declarada' : 'observaciones declaradas'}</span>`
                        : '';
                return `
                    <div class="py-1 border-b border-gray-200 last:border-0">
                        <div class="flex justify-between items-baseline gap-3">
                            <span>${etiqueta} ${obs}</span>
                            <strong class="whitespace-nowrap">${f.conDatos} de ${f.total}</strong>
                        </div>
                        <div class="h-1.5 bg-gray-200 rounded mt-1">
                            <div class="h-1.5 rounded ${pct > 0 ? 'bg-green-500' : 'bg-gray-300'}" style="width: ${Math.max(1, pct).toFixed(1)}%"></div>
                        </div>
                    </div>`;
            })
            .join('');

        const pct = resumen.porcentajeSostenido;
        const titular =
            pct === 0
                ? `<p class="mb-3">Ninguno de los tres factores se apoya todavía en algo observado: <strong>todo el Registro es juicio experto</strong>. No está mal — es el punto de partida normal — pero conviene saberlo antes de presentarlo.</p>`
                : `<p class="mb-3"><strong>${pct.toFixed(0)} %</strong> de los factores del Registro se apoya en algo observado (histórico propio o referencia del sector). El resto es juicio experto.</p>`;

        el.innerHTML =
            titular +
            filas +
            `<p class="text-xs text-gray-500 mt-2">Los tres se multiplican entre sí, así que pesan igual: un error del 50 % en cualquiera es un error del 50 % en el resultado. Por eso se cuentan por separado y no como un promedio por riesgo.</p>`;
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
        this.renderProvenanceSummary(state.fair.registerProvenanceSummary);
        this.renderPortfolioMonteCarlo();
        this.renderDashboardViewControls();

        // El mapa de calor (Impacto vs. Probabilidad de excedencia) y sus zonas
        // Bajo/Medio/Alto/Crítico son conceptos de AMENAZA — para una 'oportunidad'
        // (riesgo positivo) el "ale" guardado es en realidad un beneficio esperado, no una
        // pérdida. Graficarla ahí la posicionaba en la esquina "Crítico" (peor caso posible)
        // aunque fuera una oportunidad grande y buena — se excluye del mapa (y del Pareto,
        // ver backend calculateParetoAnalysis), pero se sigue listando en la tabla de abajo
        // con su propia evaluación correcta ("Oportunidad Significativa...", etc.).
        const threatRegister = register.filter((r) => r.riskType !== 'oportunidad');
        // Riesgos con un punto residual dibujable. El backend ya decidió cuáles lo tienen (ver
        // calculateResidualMatrixPoint) — aquí no se reimplementa ese criterio.
        const conResidual = threatRegister.filter((r) => r.residualMatrixPoint);
        this.renderMigrationNote(threatRegister, conResidual);
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
                const area = chart.chartArea;
                // Los DOS datasets: el actual y el residual. Recortar solo el primero dejaba los
                // puntos verdes saliéndose del cuadro (Evitar cae en 0,0, justo en la esquina).
                chart.data.datasets.forEach((_, i) => {
                    const meta = chart.getDatasetMeta(i);
                    if (!meta || !meta.data) return;
                    meta.data.forEach((point) => {
                        const r = ((point.options && point.options.radius) || 10) + POINT_EDGE_MARGIN;
                        point.x = Math.min(Math.max(point.x, area.left + r), area.right - r);
                        point.y = Math.min(Math.max(point.y, area.top + r), area.bottom - r);
                    });
                });
            },
        };

        /**
         * Flechas de migración: une el punto ACTUAL de cada riesgo con su punto RESIDUAL (dónde
         * quedará después del Tratamiento adoptado). Es la lectura que un comité entiende sin
         * explicación: los riesgos desplazándose fuera de la zona crítica.
         *
         * Se dibuja como plugin y no como dataset de línea porque hacen falta puntas de flecha, y
         * porque así las líneas van DEBAJO de los puntos (beforeDatasetsDraw) en vez de taparlos.
         *
         * Sin flecha cuando no hay desplazamiento real (Aceptar, k=1): un vector de longitud cero
         * es ruido. Ese caso se distingue con un anillo, no borrando el punto — aceptar SÍ es una
         * decisión documentada, y hacerla desaparecer la confundiría con un riesgo sin tratar.
         */
        const migrationArrowsPlugin = {
            id: 'fairRegisterMigrationArrows',
            beforeDatasetsDraw(chart) {
                const metaActual = chart.getDatasetMeta(0);
                const metaResidual = chart.getDatasetMeta(1);
                if (!metaActual || !metaResidual || !metaResidual.data || metaResidual.hidden) return;
                const ctx = chart.ctx;
                const puntosActuales = new Map(
                    (chart.data.datasets[0].data || []).map((d, i) => [d.name, metaActual.data[i]]),
                );

                ctx.save();
                ctx.strokeStyle = '#16a34a';
                ctx.fillStyle = '#16a34a';
                ctx.lineWidth = 2;
                (chart.data.datasets[1].data || []).forEach((d, i) => {
                    const desde = puntosActuales.get(d.name);
                    const hasta = metaResidual.data[i];
                    if (!desde || !hasta) return;
                    const dx = hasta.x - desde.x;
                    const dy = hasta.y - desde.y;
                    const largo = Math.hypot(dx, dy);
                    if (largo < 12) return; // Aceptar (o una reducción irrelevante): sin flecha.

                    // La línea arranca y termina en el BORDE de cada punto, no en su centro, para
                    // que no se vea atravesándolos.
                    const ux = dx / largo;
                    const uy = dy / largo;
                    const x0 = desde.x + ux * 12;
                    const y0 = desde.y + uy * 12;
                    const x1 = hasta.x - ux * 12;
                    const y1 = hasta.y - uy * 12;

                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x1, y1);
                    ctx.stroke();

                    const ancho = 6;
                    const largoPunta = 10;
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x1 - ux * largoPunta - uy * ancho, y1 - uy * largoPunta + ux * ancho);
                    ctx.lineTo(x1 - ux * largoPunta + uy * ancho, y1 - uy * largoPunta - ux * ancho);
                    ctx.closePath();
                    ctx.fill();
                });
                ctx.restore();
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
                    // Punto RESIDUAL: dónde queda el riesgo después del Tratamiento adoptado. Solo
                    // los que tienen uno honesto que dibujar — el backend devuelve null para los
                    // demás (sin decisión, Transferir, o sin curva guardada; ver
                    // calculateResidualMatrixPoint). Verde fijo, no por severidad: aquí el color
                    // codifica "estado residual", no gravedad; que un punto verde caiga en zona
                    // roja es información, no un error.
                    {
                        label: 'Después de tratar',
                        data: conResidual.map((r) => ({
                            x: r.residualMatrixPoint.impactPercent,
                            y: r.residualMatrixPoint.probabilityPercent,
                            name: r.riskName,
                            level: r.evaluationLevel,
                            k: r.residualMatrixPoint.k,
                        })),
                        // Aceptar (k=1) no mueve nada: anillo hueco en vez de punto lleno, para
                        // distinguirlo de un riesgo sin tratar sin fingir un desplazamiento.
                        pointBackgroundColor: conResidual.map((r) =>
                            r.residualMatrixPoint.k === 1 ? 'transparent' : '#16a34a',
                        ),
                        pointBorderColor: '#16a34a',
                        pointBorderWidth: 3,
                        pointRadius: 8,
                        pointHoverRadius: 11,
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
                            // El número solo tiene sentido en el punto ACTUAL: es el que aparece en
                            // la lista de al lado. El punto residual del mismo riesgo comparte
                            // número, así que se busca por nombre en vez de usar su propio índice
                            // (que no corresponde, porque no todos los riesgos tienen residual).
                            label: (context) => {
                                const numero = threatRegister.findIndex((r) => r.riskName === context.raw.name) + 1;
                                const coords = `Impacto ${context.raw.x.toFixed(0)}%, Probabilidad ${context.raw.y.toFixed(0)}%`;
                                if (context.datasetIndex === 0) {
                                    return `${numero}. ${context.raw.name}: ${coords} — ${context.raw.level}`;
                                }
                                const sinCambio = context.raw.k === 1;
                                return `${numero}. ${context.raw.name} — ${
                                    sinCambio ? 'aceptado, sin cambio' : 'después de tratar'
                                }: ${coords}`;
                            },
                        },
                    },
                },
            },
            plugins: [matrixBackgroundPlugin, migrationArrowsPlugin, clampPointsToChartAreaPlugin, pointNumberPlugin],
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
        // Qué columna se está mirando (ver setDashboardView). Se atenúa la otra en vez de
        // esconderla: las dos siguen ahí para comparar de un vistazo.
        const vistaResidual = state.fair.dashboardView === 'residual';
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
                // anterior del modelo de Vulnerabilidad (ver CALIBRATION_VERSION en
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
                        ? `<button class="btn btn-success text-xs px-2 py-1" data-treat-fair title="Tratar este riesgo (Mitigar/Transferir/Evitar/Aceptar)"><i class="fas fa-shield-halved mr-1"></i>Tratar</button>`
                        : '';
                // "Simular" nunca se deshabilita, aunque al riesgo le falten los insumos guardados
                // (tef/vuln/lossMagnitudes — entradas anteriores a que se persistieran). Un botón
                // deshabilitado no responde al clic Y su `title` no se muestra en la mayoría de los
                // navegadores, así que se veía exactamente igual que un botón roto. Ahora el clic
                // llega a simulateRegisteredRisk(), que ya tiene la guarda y explica en un aviso
                // qué hacer ("vuelve a correrlo desde Análisis FAIR").
                //
                // Los botones van dentro de un contenedor flex-nowrap: .btn es `display: flex`
                // (caja de nivel bloque), así que sueltos en la celda cada uno ocupaba TODO el
                // ancho y quedaban apilados uno sobre otro, ignorando cualquier margen lateral.
                // `flex-nowrap` (y no flex-wrap) es lo que obliga a la columna a pedir el ancho
                // que de verdad necesita: con wrap, la tabla se la seguía dando de 116px y los
                // botones volvían a apilarse, solo que ahora por envoltura en vez de por bloque.
                // El contenedor de la tabla ya tiene overflow-x-auto para el desborde.
                const actionsCell =
                    item.stage === 'fair'
                        ? `<div class="flex flex-nowrap items-center gap-1">
                    <button class="btn btn-primary text-xs px-2 py-1" data-analyze-fair="${sanitizeHTML(item.fairEntry.riskName)}"><i class="fas fa-balance-scale mr-1"></i>Analizar</button>
                    <button class="btn btn-secondary text-xs px-2 py-1" data-simulate-risk="${sanitizeHTML(item.fairEntry.riskName)}"><i class="fas fa-chart-bar mr-1"></i>Simular</button>
                    ${treatBtn}
                    <button class="inline-flex items-center justify-center p-1 text-red-600 hover:text-red-800 text-sm" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-risk="${sanitizeHTML(item.fairEntry.riskName)}" data-delete-source-id="${item.id || ''}" data-delete-entry-id="${item.fairEntry.id || ''}"><i class="fas fa-trash"></i></button>
                </div>`
                        : `<div class="flex flex-nowrap items-center gap-1">
                    <button class="btn btn-primary text-xs px-2 py-1" data-analyze-quick="${item.id}" ${item.fullData ? '' : 'disabled title="No se encontró la información completa de este riesgo."'}><i class="fas fa-balance-scale mr-1"></i>Analizar con FAIR</button>
                    <button class="inline-flex items-center justify-center p-1 text-red-600 hover:text-red-800 text-sm" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-quick="${item.id}"><i class="fas fa-trash"></i></button>
                </div>`;

                // data-risk-row marca las filas que tienen un detalle que abrir (ver el listener de
                // clic en fila más abajo): un riesgo de Triage todavía no se ha simulado, así que
                // no tiene nada que mostrar y su fila no debe verse pinchable.
                const filaAbrible = item.stage === 'fair' && item.fairEntry.tef && item.fairEntry.vuln;
                return `
                <tr class="border-b${filaAbrible ? ' cursor-pointer hover:bg-gray-50' : ''}"${filaAbrible ? ' data-risk-row' : ''}>
                    <td class="py-2 text-center">${checkboxCell}</td>
                    <td class="text-center text-gray-500">${item.number}</td>
                    <td class="risk-name-cell">${sanitizeHTML(item.riskName)}</td>
                    <td>${stageBadge}${treatedBadge}${staleBadge}</td>
                    <td>${inherenteCell}</td>
                    <td>${item.controlEffectiveness || '—'}</td>
                    <td class="${vistaResidual ? 'opacity-40' : 'font-semibold'}">${actualCell}</td>
                    <td class="${vistaResidual ? 'font-semibold' : 'opacity-40'}">${residualCell}</td>
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
        // Clic en la FILA (no solo en el botón "Simular") abre el detalle de ese riesgo — es lo que
        // uno espera de una tabla cuyas filas tienen más que contar. Se ignoran los clics sobre los
        // controles de la fila (botones, checkbox) para no abrir el detalle además de lo que el
        // usuario pidió; el nombre sale del texto ya renderizado, no de un atributo, porque
        // sanitizeHTML no escapa comillas dobles y un nombre con " rompería el atributo.
        document.querySelectorAll('#quick-concentrated-table-body tr[data-risk-row]').forEach((tr) => {
            tr.addEventListener('click', (e) => {
                if (e.target.closest('button, input, a, select')) return;
                const cell = tr.querySelector('.risk-name-cell');
                if (cell) this.simulateRegisteredRisk(cell.textContent);
            });
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
        this.updateRecalibrateBtnState();
    },

    /** El botón de recalibración masiva solo existe si hay algo que recalibrar, y dice cuántos.
     *  Su listener se registra UNA vez: vive en HTML estático que no se reconstruye. */
    updateRecalibrateBtnState() {
        const btn = document.getElementById('fair-recalibrate-all-btn');
        if (!btn) return;
        const pendientes = this.staleRisks().length;
        btn.classList.toggle('hidden', pendientes === 0);
        if (pendientes === 0) return;
        document.getElementById('fair-recalibrate-all-label').textContent =
            `Recalibrar ${pendientes} ${pendientes === 1 ? 'riesgo' : 'riesgos'}`;
        if (!this._recalibrateWired) {
            btn.addEventListener('click', () => this.recalibrateAll());
            this._recalibrateWired = true;
        }
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
                  return `<tr><td class="py-1 pr-3 text-gray-600">${lossFormLabels(entry.riskType, 'tecnico')[key]}</td><td class="py-1 pr-3">${fmt(f.min)}</td><td class="py-1 pr-3 font-semibold">${fmt(f.mode)}</td><td class="py-1">${fmt(f.max)}</td></tr>`;
              }).join('')
            : '';
        const sensitivityHTML = (entry.sensitivity || [])
            .slice(0, 5)
            .map((s) => `<li>${sensitivityLabel(s, entry.riskType)}: ${(s.correlation * 100).toFixed(1)}%</li>`)
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
    /**
     * Interruptor Actual / Residual del Dashboard.
     *
     * Gobierna el Pareto y la columna resaltada de la tabla. NO gobierna la Matriz ni el Monte
     * Carlo: esos muestran siempre los dos estados (una flecha y dos cifras, respectivamente),
     * porque comparar es su razón de ser — pero atenúan el estado no seleccionado, para que el
     * interruptor no se vea inerte en media pantalla.
     *
     * El Pareto sí cambia entero, y no por gusto: el residual responde una pregunta DISTINTA
     * ("qué sigue concentrando la exposición después de tratar") y sale en OTRO ORDEN. Superponer
     * los dos en barras dobles obligaría a ordenar por uno y distorsionaría el otro.
     */
    setDashboardView(view) {
        state.fair.dashboardView = view === 'residual' ? 'residual' : 'actual';
        this.renderDashboardViewControls();
        this.renderTailContributors();
        this.renderParetoChart();
        this.renderConcentratedTable(state.fair.concentratedRisks || []);
    },

    renderDashboardViewControls() {
        const activo = state.fair.dashboardView;
        const toggle = document.getElementById('dashboard-state-toggle');
        if (toggle) toggle.classList.toggle('hidden', (state.fair.riskRegister || []).length === 0);
        [
            ['dashboard-view-actual', 'actual'],
            ['dashboard-view-residual', 'residual'],
        ].forEach(([id, view]) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const on = activo === view;
            btn.classList.toggle('bg-blue-600', on);
            btn.classList.toggle('text-white', on);
            btn.classList.toggle('bg-white', !on);
            btn.classList.toggle('text-gray-700', !on);
            btn.setAttribute('aria-pressed', String(on));
        });
        // Atenuar en la Matriz y en el Monte Carlo el estado que no se está mirando. No se ocultan:
        // siguen ahí para comparar, solo pierden protagonismo.
        const chart = state.fair.registerChart;
        if (chart && chart.data.datasets.length > 1) {
            const residual = activo === 'residual';
            chart.data.datasets[0].pointBorderColor = residual ? 'rgba(255,255,255,0.35)' : 'white';
            chart.data.datasets[1].pointBorderColor = residual ? '#16a34a' : 'rgba(22,163,74,0.35)';
            chart.update('none');
        }
        document.querySelectorAll('[data-portfolio-state]').forEach((el) => {
            el.classList.toggle('opacity-40', el.dataset.portfolioState !== activo);
        });
    },

    renderParetoChart() {
        // El Pareto residual viene del backend con su PROPIO ordenamiento (ver
        // calculateResidualParetoAnalysis): responde "qué sigue concentrando la exposición después
        // de tratar", no "dónde enfocar el esfuerzo antes de decidir nada". Un riesgo puede ser el
        // primero en uno y el quinto en el otro — ése es justo el hallazgo útil, y por eso el
        // interruptor cambia el gráfico entero en vez de superponer barras dobles.
        const residual = state.fair.dashboardView === 'residual';
        const fuente = residual ? state.fair.registerResidualPareto : state.fair.registerPareto;
        if (!fuente) return;
        // Las dos fuentes traen el monto en campos distintos (`ale` vs `residualALE`) — a propósito,
        // para que no se puedan confundir. Se normalizan aquí, en un solo sitio.
        const pareto = {
            ...fuente,
            risks: (fuente.risks || []).map((r) => ({ ...r, valor: residual ? r.residualALE : r.ale })),
        };

        const nota = document.getElementById('fair-pareto-state-note');
        if (nota) {
            nota.textContent = residual
                ? 'Después de aplicar los tratamientos ya adoptados.'
                : 'Como está hoy, antes de tratar.';
            nota.className = `text-sm font-semibold mb-1 ${residual ? 'text-green-700' : 'text-red-700'}`;
        }

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
                        data: pareto.risks.map((r) => r.valor),
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
    /**
     * Cuántos riesgos tienen de verdad una flecha de migración, y cuántos no. Sin decirlo, un
     * portafolio con 3 de 20 tratados se ve casi idéntico con y sin flechas: quien lo lee concluye
     * que el tratamiento no movió nada, cuando lo que pasa es que casi nadie tomó una decisión.
     *
     * Los tratados con Transferir se cuentan aparte: sí tienen decisión adoptada, pero no llevan
     * punto verde porque una póliza trunca la cola en vez de escalarla (ver
     * calculateResidualMatrixPoint en el backend) — omitirlos sin explicación los haría parecer
     * riesgos sin tratar.
     */
    renderMigrationNote(threatRegister, conResidual) {
        const el = document.getElementById('fair-matrix-migration-note');
        if (!el) return;
        const total = threatRegister.length;
        const tratados = threatRegister.filter((r) => r.treatmentDecision).length;
        const transferidos = threatRegister.filter(
            (r) =>
                r.treatmentDecision &&
                (r.treatmentDecision.strategy === 'transferir' ||
                    r.treatmentDecision.strategy === 'mitigarTransferir') &&
                !r.residualMatrixPoint,
        ).length;

        if (tratados === 0) {
            el.textContent = `Ninguno de los ${total} riesgos tiene todavía una estrategia de tratamiento adoptada, así que no hay movimiento que mostrar.`;
            el.classList.remove('hidden');
            return;
        }
        const nota =
            transferidos > 0
                ? ` ${transferidos} ${
                      transferidos === 1 ? 'con seguro no lleva flecha' : 'con seguro no llevan flecha'
                  }: un deducible y un límite recortan las pérdidas más grandes en vez de reducirlas de forma pareja, así que su punto no se puede ubicar.`
                : '';
        el.innerHTML =
            `<strong>${tratados} de ${total}</strong> riesgos tienen una estrategia adoptada; la flecha verde muestra dónde queda cada uno después.` +
            (conResidual.length === 0 ? ' Ninguno se puede ubicar todavía.' : '') +
            nota;
        el.classList.remove('hidden');
    },

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

    /** Riesgos del Registro calculados con una calibración anterior a la vigente y con datos
     *  suficientes para volver a simularlos. Mismo criterio que la insignia "⟳ Recalibrar" de la
     *  tabla — un stub "Sin analizar" (creado desde el Árbol con "+") no tiene nada que recalibrar. */
    staleRisks() {
        const vigente = state.config.calibrationVersion;
        if (vigente == null) return [];
        return (state.fair.riskRegister || []).filter(
            (r) => (r.calibrationVersion ?? 0) < vigente && r.tef && r.vuln && r.lossMagnitudes,
        );
    },

    /**
     * Recalibración masiva: vuelve a simular TODOS los riesgos desactualizados con los datos que ya
     * tienen guardados, y actualiza sus números.
     *
     * Por qué existe y por qué NO corre sola. La app nunca recalcula un riesgo guardado por su
     * cuenta: sobrescribir en silencio la evaluación de un analista destruye la trazabilidad de por
     * qué se decidió lo que se decidió (ver la insignia "⟳ Recalibrar"). Esto es la salida explícita
     * a esa regla — la dispara una persona, a sabiendas, y la evaluación anterior de cada riesgo se
     * conserva en su Historial de Revisiones (ISO 31000, cláusula 6.6) en vez de perderse.
     *
     * Va por el MISMO camino que una re-simulación manual (POST /api/simulate + PUT /api/register),
     * no por un atajo propio: así no hay dos maneras distintas de producir un riesgo actualizado que
     * puedan desincronizarse. El PUT reemplaza la entrada completa, por eso se manda `{...entry}`
     * primero y solo se pisan los campos que la simulación produce.
     */
    async recalibrateAll() {
        const pendientes = this.staleRisks();
        if (pendientes.length === 0) {
            showToast('No hay riesgos con calibración desactualizada.');
            return;
        }
        if (!(await this.confirmRecalibration(pendientes.length))) return;

        const cambios = [];
        let falla = null;
        for (let i = 0; i < pendientes.length; i++) {
            const entry = pendientes[i];
            this.renderRecalibrationProgress(i, pendientes.length, entry.riskName);
            try {
                cambios.push(await this.recalibrateOne(entry));
            } catch (e) {
                falla = { riskName: entry.riskName, message: e.userMessage || 'Error de red.' };
                break;
            }
        }

        await this.loadRiskRegister();
        this.renderRecalibrationSummary(cambios, falla, pendientes.length);
    },

    /** Modal de confirmación. Reescribe evaluaciones guardadas, así que dice exactamente qué va a
     *  pasar antes de hacerlo — incluido lo que NO cambia. */
    confirmRecalibration(cuantos) {
        return new Promise((resolve) => {
            Modal.setSize('wide');
            Modal.title.textContent = 'Recalibrar riesgos desactualizados';
            Modal.body.innerHTML = `
                <p class="mb-3">Se van a volver a simular <strong>${cuantos}</strong> ${cuantos === 1 ? 'riesgo' : 'riesgos'} con los datos que ya tienen guardados. No se te va a pedir ningún dato nuevo.</p>
                <ul class="text-sm text-gray-700 list-disc list-inside mb-3 space-y-1">
                    <li>Su <strong>pérdida promedio anual apenas se moverá</strong>: el modelo nuevo tiene la misma media que el anterior.</li>
                    <li>Lo que sí cambia es el <strong>peor caso</strong>, y puede cambiar bastante: sube en los riesgos raros y graves, baja en los frecuentes y menores.</li>
                    <li>Algunos riesgos pueden <strong>cambiar de nivel</strong> (por ejemplo de Alto a Crítico) como consecuencia.</li>
                </ul>
                <p class="text-sm p-2 rounded bg-blue-50 text-blue-900 mb-3">La evaluación anterior de cada riesgo se guarda en su <strong>Historial de Revisiones</strong>, así que no se pierde nada de lo ya decidido.</p>
                <p class="text-sm text-gray-600">Tus decisiones de tratamiento, dueños, fechas de revisión y notas no se tocan.</p>
            `;
            Modal.footer.innerHTML = `
                <button id="recal-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="recal-go-btn" class="btn btn-primary">Recalibrar ${cuantos}</button>
            `;
            Modal.modal.classList.remove('hidden');
            document.getElementById('recal-cancel-btn').addEventListener(
                'click',
                () => {
                    Modal.hide();
                    resolve(false);
                },
                { once: true },
            );
            document.getElementById('recal-go-btn').addEventListener('click', () => resolve(true), { once: true });
        });
    },

    renderRecalibrationProgress(hechos, total, riskName) {
        const pct = Math.round((hechos / total) * 100);
        Modal.body.innerHTML = `
            <p class="mb-3">Recalibrando <strong>${hechos + 1}</strong> de <strong>${total}</strong>…</p>
            <div class="w-full bg-gray-200 rounded h-3 mb-2"><div class="h-3 rounded bg-blue-600" style="width:${pct}%"></div></div>
            <p class="text-sm text-gray-600">${sanitizeHTML(riskName)}</p>
        `;
        Modal.footer.innerHTML = '';
    },

    /** Resumen final: qué cambió en cada riesgo. Es el registro de la operación, no un "listo". */
    renderRecalibrationSummary(cambios, falla, total) {
        const cambioNivel = cambios.filter((c) => c.antes.evaluationLevel !== c.despues.evaluationLevel);
        const pct = (a, b) => (a > 0 ? `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(0)}%` : '—');
        const filas = cambios
            .map(
                (c) => `
                <tr class="border-b">
                    <td class="py-1 pr-3">${sanitizeHTML(c.riskName)}</td>
                    <td class="py-1 pr-3 text-right">${formatCurrency(c.antes.ale)} → ${formatCurrency(c.despues.ale)}</td>
                    <td class="py-1 pr-3 text-right">${formatCurrency(c.antes.cvar95)} → ${formatCurrency(c.despues.cvar95)} <span class="text-gray-500">(${pct(c.antes.cvar95, c.despues.cvar95)})</span></td>
                    <td class="py-1">${c.antes.evaluationLevel !== c.despues.evaluationLevel ? `<strong>${sanitizeHTML(c.antes.evaluationLevel || '—')} → ${sanitizeHTML(c.despues.evaluationLevel)}</strong>` : '<span class="text-gray-500">sin cambio</span>'}</td>
                </tr>`,
            )
            .join('');

        Modal.setSize('xl');
        Modal.title.textContent = 'Recalibración terminada';
        Modal.body.innerHTML = `
            ${
                falla
                    ? `<p class="mb-3 p-2 rounded bg-red-50 border-l-4 border-red-500 text-red-800 text-sm">Se detuvo en <strong>${sanitizeHTML(falla.riskName)}</strong>: ${sanitizeHTML(falla.message)}. Los ${cambios.length} anteriores sí quedaron guardados — puedes volver a ejecutarlo y seguirá desde donde se quedó.</p>`
                    : ''
            }
            <p class="mb-3">Se recalibraron <strong>${cambios.length}</strong> de ${total} ${total === 1 ? 'riesgo' : 'riesgos'}.${cambioNivel.length > 0 ? ` <strong>${cambioNivel.length}</strong> cambió de nivel.` : ' Ninguno cambió de nivel.'}</p>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead><tr class="text-left border-b">
                        <th class="py-1 pr-3">Riesgo</th>
                        <th class="py-1 pr-3 text-right">${shortMetricLabel('ale', 'ALE')}</th>
                        <th class="py-1 pr-3 text-right">${shortMetricLabel('cvar95', 'CVaR 95%')}</th>
                        <th class="py-1">Nivel</th>
                    </tr></thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
            <p class="text-xs text-gray-600 mt-3">La evaluación anterior de cada uno quedó en su Historial de Revisiones.</p>
        `;
        Modal.footer.innerHTML = `<button id="recal-close-btn" class="btn btn-primary">Cerrar</button>`;
        document.getElementById('recal-close-btn').addEventListener('click', () => Modal.hide(), { once: true });
    },

    /** Una sola recalibración: simula con los inputs guardados y guarda el resultado. */
    async recalibrateOne(entry) {
        const deliberada = entry.isDeliberate !== false && entry.attackerKey && entry.defenseKey;
        const result = await App.Api.request('/api/simulate', {
            method: 'POST',
            body: {
                // Sin `iterations`: el backend decide cuántas hacen falta según el riesgo (ver
                // lib/adaptiveSimulation.js). Un riesgo raro necesita muchas más que uno frecuente,
                // y el viejo 10.000 fijo sobraba en unos y faltaba en otros.
                seed: entry.seed || 0,
                tef: entry.tef,
                vuln: entry.vuln,
                lossMagnitudes: entry.lossMagnitudes,
                riskType: entry.riskType || 'amenaza',
                // Los mismos perfiles con los que se calculó la primera vez. Sin ellos el backend
                // caería al triángulo guardado y el riesgo quedaría recalibrado con OTRO modelo de
                // Vulnerabilidad que el que le corresponde.
                attackerKey: deliberada ? entry.attackerKey : undefined,
                defenseKey: deliberada ? entry.defenseKey : undefined,
                accessLevel: deliberada ? entry.accessLevel : undefined,
                confidence: entry.dataConfidence || 'medio',
                vulnManualOverride: !deliberada || !!entry.vulnManualOverride,
                riskCriteria: entry.riskCriteriaOverride
                    ? { ...state.config.riskCriteria, ...entry.riskCriteriaOverride }
                    : state.config.riskCriteria,
            },
        });

        const { summary, evaluation, inherentEvaluation } = result;
        const antes = { ale: entry.ale, evaluationLevel: entry.evaluationLevel, cvar95: entry.cvar95 };

        // El Historial de Revisiones se queda con la foto ANTERIOR: es lo que hace que esto no
        // destruya trazabilidad. Mismo formato que ya escribe el wizard.
        const historial = Array.isArray(entry.reviewHistory) ? [...entry.reviewHistory] : [];
        historial.push({
            date: new Date(entry.date || Date.now()).toLocaleDateString('es-MX', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            }),
            ale: formatCurrency(entry.ale),
            evaluationLevel: entry.evaluationLevel || '—',
        });

        await App.Api.request(`/api/register/${encodeURIComponent(entry.riskName)}`, {
            method: 'PUT',
            body: {
                ...entry,
                ale: summary.average,
                cvar95: summary.cvar95,
                probExceedance: summary.probExceedance,
                inherentALE: summary.inherentALE,
                inherentCVaR: summary.inherentCVaR,
                inherentSeverity: inherentEvaluation ? inherentEvaluation.severity : null,
                evaluationLevel: evaluation.level,
                evaluationClasses: severityToClasses(evaluation.severity),
                severity: evaluation.severity,
                evaluationJustification: evaluation.justification,
                sensitivity: (result.sensitivity || []).slice(0, 5),
                lossExceedanceCurve: result.lossExceedanceCurve || null,
                calibrationVersion: result.calibrationVersion ?? null,
                // El histograma guardado (lo usa el PDF) es de la corrida vieja. Se limpia en vez de
                // dejarlo: el reporte ya sabe omitirlo cuando falta, y un histograma del modelo
                // anterior junto a cifras del nuevo sería una contradicción impresa.
                chartLabels: null,
                chartData: null,
                reviewHistory: historial,
            },
        });

        return {
            riskName: entry.riskName,
            antes,
            despues: { ale: summary.average, evaluationLevel: evaluation.level, cvar95: summary.cvar95 },
        };
    },

    // Re-simula un riesgo ya guardado usando sus inputs originales (tef/vuln/lossMagnitudes)
    // y su semilla — misma reproducibilidad exacta que documenta /api/simulate. Siempre a
    // 10,000 iteraciones (tope único para todas las simulaciones, ver backend/validate.js).
    async simulateRegisteredRisk(riskName) {
        // Un clic en un riesgo abre su FICHA completa, no solo sus resultados. La pestaña inicial es
        // Resultados, así que quien venía del botón "Simular" ve exactamente lo mismo que antes —
        // más las otras dos pestañas al lado.
        this.openRiskCard(riskName, 'resultados');
    },

    /** Llena la pestaña de Resultados. Separado de abrir el modal porque la ficha ya está abierta
     *  cuando se llama, y volver a abrirla vaciaría lo que se acaba de montar. */
    async simulateRegisteredRiskInto(riskName) {
        const risk = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!risk || !risk.tef || !risk.vuln || !risk.lossMagnitudes) {
            showToast(
                'Este riesgo no tiene los datos guardados para re-simular. Vuelve a correrlo desde Análisis FAIR.',
            );
            return;
        }

        const loading = document.getElementById('dashboard-risk-detail-loading');
        const body = document.getElementById('dashboard-risk-detail-body');
        loading.classList.remove('hidden');
        loading.textContent = 'Simulando 10,000 escenarios…';
        body.classList.add('hidden');

        let result;
        try {
            result = await App.Api.request('/api/simulate', {
                method: 'POST',
                body: {
                    // Sin `iterations`: lo decide el backend (ver la nota de la otra llamada). El
                    // comparador de modelos de frecuencia, más abajo, SÍ las fija a propósito.
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
        this.renderRiskDetail(result);
    },

    /**
     * Llena la Zona B del Dashboard (el detalle de UN riesgo) con el resultado de /api/simulate.
     *
     * Es el mismo juego de elementos que usa el wizard al terminar una simulación nueva — antes
     * había dos juegos casi idénticos (#fair-register-sim-* aquí, y los del Paso 4 allá)
     * mostrando lo mismo con código distinto. Los renderizadores de histograma, curva de
     * excedencia y sensibilidad viven en App.FairWizard y se reutilizan tal cual: no se duplica
     * ninguna fórmula ni configuración de gráfico.
     */
    /**
     * Abre el detalle de un riesgo en el modal compartido.
     *
     * El contenido no se regenera: se MUEVE el nodo `#dashboard-risk-detail` al cuerpo del modal
     * y se devuelve a su sitio al cerrar — mismo patrón que ya usaba el panel de Nash. Moviendo
     * el nodo (en vez de reconstruir su HTML) sobreviven los ids, los listeners ya registrados en
     * init(), y sobre todo los <canvas> con sus instancias de Chart ya dibujadas.
     *
     * Vive en un modal, y no colgando del Dashboard, porque el Dashboard responde "¿cómo está mi
     * portafolio?" — un análisis individual permanente ahí abajo mezcla dos niveles de lectura.
     */
    // --- Ficha del riesgo -------------------------------------------------------------------
    //
    // Un riesgo, un lugar. Antes, dejar UN riesgo terminado obligaba a recorrer cuatro pestañas
    // (Análisis → Dashboard → Tratamiento → Gestión) y en ninguna se veía su estado completo: la
    // navegación estaba organizada por HERRAMIENTA y el trabajo real está organizado por RIESGO.
    // Tratamiento y Gestión tenían cada una su propio selector de riesgo, que existía solo porque
    // no había una ficha donde vivir.
    //
    // No se reconstruye HTML: se MUEVEN los paneles que ya existen y se devuelven a su sitio al
    // cerrar — mismo patrón probado de openRiskDetailModal, que preserva ids, listeners y los
    // <canvas> con sus gráficos ya dibujados. Por eso las páginas viejas siguen funcionando igual.
    _cardPanels: {
        resultados: { nodeId: 'dashboard-risk-detail', label: 'Resultados' },
        tratamiento: { nodeId: 'fair-roi-content', label: 'Tratamiento' },
        gobernanza: { nodeId: 'riskmgmt-per-risk', label: 'Gobernanza' },
    },
    _cardHomes: {},
    _cardActive: null,

    /** La casa de cada panel se recuerda la PRIMERA vez, antes de moverlo. Leerla después daría el
     *  cuerpo del modal y el panel nunca volvería a su página. */
    _cardHomeOf(key) {
        if (!this._cardHomes[key]) {
            const node = document.getElementById(this._cardPanels[key].nodeId);
            if (node && node.parentNode) this._cardHomes[key] = node.parentNode;
        }
        return this._cardHomes[key];
    },

    /** Los cuatro hitos del ciclo de vida, derivados de lo que YA se guarda: nada de estado nuevo.
     *  Es lo que hace legible el flujo sin mover ninguna página de sitio. */
    riskProgress(entry) {
        const vigente = state.config.calibrationVersion;
        return [
            { label: 'Analizado', done: !!entry.evaluationLevel },
            { label: 'Tratado', done: !!entry.treatmentDecision },
            { label: 'Con dueño', done: !!(entry.owner && entry.owner !== '—') },
            { label: 'Con fecha de revisión', done: !!entry.reviewDate },
            ...(vigente != null && (entry.calibrationVersion ?? 0) < vigente
                ? [{ label: 'Recalibrar', done: false, warn: true }]
                : []),
        ];
    },

    renderRiskCardHeader(entry) {
        const hitos = this.riskProgress(entry)
            .map(
                (h) =>
                    `<span class="${h.warn ? 'text-orange-700' : h.done ? 'text-green-700' : 'text-gray-400'}">${h.done ? '✓' : '○'} ${h.label}</span>`,
            )
            .join('<span class="text-gray-300 mx-2">·</span>');

        const decision = entry.treatmentDecision;
        const vigenteALE = decision ? decision.residualALE : entry.ale;
        const vigenteCVaR =
            decision && typeof decision.residualCVaR === 'number' ? decision.residualCVaR : entry.cvar95;
        const etiqueta = decision ? 'vigente (tras tratamiento)' : 'actual';

        return `
            <div class="mb-3 pb-3 border-b">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
                    ${entry.evaluationLevel ? `<span class="px-2 py-1 rounded text-xs border-l-4 ${entry.evaluationClasses}">${sanitizeHTML(entry.evaluationLevel)}</span>` : ''}
                    <span class="text-sm text-gray-700">${shortMetricLabel('ale', 'ALE')} ${etiqueta}: <strong>${formatCurrency(vigenteALE)}</strong></span>
                    <span class="text-sm text-gray-700">${shortMetricLabel('cvar95', 'CVaR 95%')}: <strong>${formatCurrency(vigenteCVaR)}</strong></span>
                </div>
                <div class="text-xs flex flex-wrap items-center">${hitos}</div>
            </div>
            <div class="flex gap-1 border-b mb-3" id="risk-card-tabs"></div>
            <div id="risk-card-slot" class="min-h-0"></div>
        `;
    },

    /**
     * Abre la ficha de un riesgo. `tab` elige la pestaña inicial.
     * Oportunidad no tiene Tratamiento (ISO 31000, 6.5 asume una pérdida a reducir), así que esa
     * pestaña no se ofrece — mismo criterio que ya excluye 'oportunidad' del selector de Tratamiento.
     */
    openRiskCard(riskName, tab = 'resultados') {
        const entry = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!entry) {
            showToast('No se encontró este riesgo en el Registro.');
            return;
        }

        const disponibles = Object.keys(this._cardPanels).filter(
            (k) => !(k === 'tratamiento' && entry.riskType === 'oportunidad'),
        );
        if (!disponibles.includes(tab)) tab = disponibles[0];

        state.fair.detailRiskName = riskName;
        this.wireFrequencyModelButton();
        // Registrado una sola vez: pase lo que pase, al ocultarse el modal los paneles vuelven a su
        // página. Sin esto, cerrar por cualquier vía que no sea el botón "Cerrar" dejaría vacías
        // las páginas de Tratamiento o Gestión.
        if (!this._cardHideWired) {
            Modal.onBeforeHide(() => this.returnRiskCardPanel());
            this._cardHideWired = true;
        }

        Modal.setSize('xl');
        Modal.title.textContent = riskName;
        Modal.body.innerHTML = this.renderRiskCardHeader(entry);
        Modal.footer.innerHTML = `<button id="risk-card-close-btn" class="btn btn-secondary">Cerrar</button>`;

        const barra = document.getElementById('risk-card-tabs');
        barra.innerHTML = disponibles
            .map(
                (k) =>
                    `<button type="button" class="px-3 py-2 text-sm border-b-2 -mb-px" data-card-tab="${k}">${this._cardPanels[k].label}</button>`,
            )
            .join('');
        barra.querySelectorAll('[data-card-tab]').forEach((btn) => {
            btn.addEventListener('click', () => this.showRiskCardTab(btn.dataset.cardTab, riskName));
        });

        document.getElementById('risk-card-close-btn').addEventListener('click', () => this.closeRiskCard(), {
            once: true,
        });
        Modal.modal.classList.remove('hidden');
        this.showRiskCardTab(tab, riskName);
    },

    showRiskCardTab(key, riskName) {
        const slot = document.getElementById('risk-card-slot');
        if (!slot) return;

        // Devolver el panel anterior a su página ANTES de traer el nuevo: dos paneles no pueden
        // estar en el mismo sitio, y si uno se quedara aquí su página quedaría vacía.
        this.returnRiskCardPanel();

        const node = document.getElementById(this._cardPanels[key].nodeId);
        if (!node) return;
        this._cardHomeOf(key);
        slot.appendChild(node);
        node.classList.remove('hidden');
        this._cardActive = key;

        document.querySelectorAll('[data-card-tab]').forEach((btn) => {
            const activo = btn.dataset.cardTab === key;
            btn.className = `px-3 py-2 text-sm border-b-2 -mb-px ${activo ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-gray-500'}`;
        });

        // Cada panel se llena por el MISMO camino que usa su página: no hay una segunda forma de
        // pintar un riesgo que pueda desincronizarse de la primera.
        if (key === 'resultados') {
            // El comparador de modelos re-simula desde los inputs GUARDADOS, así que solo aparece
            // cuando hay una entrada completa en el Registro.
            const freqPanel = document.getElementById('fair-frequency-models');
            if (freqPanel) {
                const g = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
                freqPanel.classList.toggle('hidden', !(g && g.tef && g.vuln && g.lossMagnitudes));
                const salida = document.getElementById('fair-freqmodel-result');
                salida.classList.add('hidden');
                salida.innerHTML = '';
            }
            this.simulateRegisteredRiskInto(riskName);
        }
        if (key === 'tratamiento') {
            const sel = document.getElementById('treatment-risk-select');
            if (sel) sel.value = riskName;
            App.Treatment.selectRisk(riskName);
        }
        if (key === 'gobernanza') {
            const sel = document.getElementById('riskmgmt-risk-select');
            if (sel) sel.value = riskName;
            App.RiskManagement.selectRisk(riskName);
        }
    },

    returnRiskCardPanel() {
        if (!this._cardActive) return;
        const key = this._cardActive;
        const node = document.getElementById(this._cardPanels[key].nodeId);
        const casa = this._cardHomes[key];
        if (node && casa) {
            if (key === 'resultados') node.classList.add('hidden');
            casa.appendChild(node);
        }
        this._cardActive = null;
    },

    closeRiskCard() {
        state.fair.detailRiskName = null;
        Modal.hide(); // el gancho onBeforeHide devuelve el panel a su página
    },

    openRiskDetailModal(riskName) {
        const panel = document.getElementById('dashboard-risk-detail');
        const casa = document.getElementById('dashboard-risk-detail-home');
        if (!panel || !casa) return;

        state.fair.detailRiskName = riskName;
        this.wireFrequencyModelButton();

        // El comparador de modelos re-simula desde los inputs GUARDADOS del riesgo, así que solo
        // aparece cuando hay una entrada completa en el Registro — este modal también se abre desde
        // el Paso 4 del wizard, donde el riesgo recién simulado puede no estar guardado todavía.
        const freqPanel = document.getElementById('fair-frequency-models');
        if (freqPanel) {
            const guardado = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
            freqPanel.classList.toggle(
                'hidden',
                !(guardado && guardado.tef && guardado.vuln && guardado.lossMagnitudes),
            );
            const salida = document.getElementById('fair-freqmodel-result');
            salida.classList.add('hidden');
            salida.innerHTML = '';
        }

        Modal.setSize('xl');
        Modal.title.textContent = riskName;
        Modal.body.innerHTML = '';
        Modal.body.appendChild(panel);
        panel.classList.remove('hidden');
        Modal.footer.innerHTML = `<button id="risk-detail-close-btn" class="btn btn-secondary">Cerrar</button>`;

        const cerrar = () => {
            // Devolver el panel a su casa ANTES de cerrar: si se quedara dentro del modal, la
            // próxima apertura no lo encontraría y los gráficos se perderían al vaciar el cuerpo.
            panel.classList.add('hidden');
            casa.appendChild(panel);
            state.fair.detailRiskName = null;
            Modal.hide();
        };
        document.getElementById('risk-detail-close-btn').addEventListener('click', cerrar, { once: true });
        Modal.modal.classList.remove('hidden');
    },

    // El botón vive en HTML estático que nunca se reconstruye (el panel entero se MUEVE al modal y
    // vuelve, ver openRiskDetailModal), así que basta con un listener registrado una sola vez —
    // no hay un init() de este módulo donde ponerlo, y volver a registrarlo en cada apertura
    // dispararía la comparación tantas veces como modales se hayan abierto.
    wireFrequencyModelButton() {
        if (this._freqModelWired) return;
        const btn = document.getElementById('fair-freqmodel-btn');
        if (!btn) return;
        btn.addEventListener('click', () => this.compareFrequencyModels());
        this._freqModelWired = true;
    },

    /**
     * Corre el riesgo abierto con los DOS modelos de frecuencia y muestra ambos lado a lado.
     *
     * Es un diagnóstico: no guarda nada, no toca ninguna cifra del Registro. Está para poder ver,
     * con datos reales, cuánto cambia la cola al dejar de repartir la frecuencia como una fracción
     * continua de evento — antes de decidir si el modelo compuesto debe ser el default.
     */
    async compareFrequencyModels() {
        const riskName = state.fair.detailRiskName;
        const risk = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        const salida = document.getElementById('fair-freqmodel-result');
        const btn = document.getElementById('fair-freqmodel-btn');
        if (!salida || !btn) return;
        if (!risk || !risk.tef || !risk.vuln || !risk.lossMagnitudes) {
            showToast('Este riesgo no tiene los datos guardados para comparar. Vuelve a correrlo desde Análisis FAIR.');
            return;
        }

        btn.disabled = true;
        salida.classList.remove('hidden');
        salida.innerHTML = '<p class="text-sm text-gray-500">Comparando los dos modelos…</p>';

        try {
            const data = await App.Api.request('/api/simulate/frequency-models', {
                method: 'POST',
                body: {
                    iterations: 10000,
                    seed: risk.seed || 0,
                    tef: risk.tef,
                    vuln: risk.vuln,
                    lossMagnitudes: risk.lossMagnitudes,
                },
            });
            // Si mientras tanto se cerró el modal o se abrió OTRO riesgo, esta respuesta ya no
            // corresponde a lo que se está viendo (mismo criterio que el guardián de
            // Treatment.updateReduccionALEAuto).
            if (state.fair.detailRiskName !== riskName) return;
            salida.innerHTML = this.buildFrequencyComparisonHTML(data);
        } catch (e) {
            if (state.fair.detailRiskName !== riskName) return;
            salida.innerHTML = `<p class="text-sm text-red-600">${sanitizeHTML(e.userMessage || 'No se pudieron comparar los modelos.')}</p>`;
        } finally {
            btn.disabled = false;
        }
    },

    buildFrequencyComparisonHTML(data) {
        const actual = data.models.expected.summary;
        const compuesto = data.models.compound.summary;
        const info = data.models.compound;
        const simple = App.UIMode.mode === 'simple';

        const delta = (valor) => {
            if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
            const signo = valor >= 0 ? '+' : '';
            const color = Math.abs(valor) < 5 ? 'text-gray-500' : valor > 0 ? 'text-red-600' : 'text-green-700';
            return `<span class="${color}">${signo}${valor.toFixed(1)}%</span>`;
        };

        const filas = [
            [
                shortMetricLabel('ale', 'Pérdida Anual Esperada (ALE)'),
                actual.average,
                compuesto.average,
                data.delta.alePercent,
            ],
            [shortMetricLabel('p90', 'Pérdida en el peor 10% (P90)'), actual.p90, compuesto.p90, data.delta.p90Percent],
            [shortMetricLabel('cvar95', 'CVaR 95%'), actual.cvar95, compuesto.cvar95, data.delta.cvar95Percent],
        ]
            .map(
                ([etiqueta, a, c, d]) => `
                <tr class="border-b">
                    <td class="py-1 pr-3">${etiqueta}</td>
                    <td class="py-1 pr-3 text-right">${formatCurrency(a)}</td>
                    <td class="py-1 pr-3 text-right font-semibold">${formatCurrency(c)}</td>
                    <td class="py-1 text-right">${delta(d)}</td>
                </tr>`,
            )
            .join('');

        // Los años agrupados por cuántos eventos trajeron. Es la lectura que el modelo de hoy no
        // puede dar (ahí todos los años traen la misma fracción de evento) y la que hace evidente
        // de dónde sale la diferencia en la cola.
        const reparto = info.eventCountDistribution
            .filter((d) => d.years > 0)
            .map(
                (d) =>
                    `<li>${d.events === 0 ? 'Ningún evento' : d.events === 1 ? '1 evento' : `${d.events} eventos`}: <strong>${((d.years / data.iterations) * 100).toFixed(1)}%</strong> de los años</li>`,
            )
            .join('');

        const lectura = simple
            ? 'La primera columna es lo que la app muestra hoy. La segunda es la misma información contando los años uno por uno: unos sin nada y otros con el golpe completo. Fíjate en la última fila — ahí es donde de verdad cambia.'
            : 'El promedio coincide por construcción (los dos modelos tienen la misma media). Lo que cambia es la forma: el modelo compuesto concentra la pérdida en pocos años en vez de repartirla, así que sube la cola de los riesgos raros y la baja en los frecuentes.';

        return `
            <div class="overflow-x-auto">
                <table class="w-full text-sm mb-3">
                    <thead>
                        <tr class="text-left border-b">
                            <th class="py-1 pr-3"></th>
                            <th class="py-1 pr-3 text-right">${simple ? 'Como se ve hoy' : 'Modelo actual'}</th>
                            <th class="py-1 pr-3 text-right">${simple ? 'Contando año por año' : 'Modelo compuesto'}</th>
                            <th class="py-1 text-right">${simple ? 'Cambio' : 'Diferencia'}</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
            </div>
            <p class="text-sm text-gray-700 mb-2">${simple ? 'De 10.000 años simulados:' : `De ${data.iterations.toLocaleString('es-MX')} años simulados:`}</p>
            <ul class="text-sm text-gray-700 list-disc list-inside mb-3">${reparto}</ul>
            <p class="text-xs text-gray-600">${lectura}</p>
            <p class="text-xs text-gray-500 mt-2">Las dos corridas usan la misma semilla (${data.usedSeed}), así que la diferencia es el modelo y no el azar. Esto no modifica ni guarda nada.</p>
        `;
    },

    renderRiskDetail(result) {
        const { summary } = result;
        document.getElementById('ale-result').textContent = formatCurrency(summary.average);
        document.getElementById('median-loss-result').textContent = formatCurrency(summary.median);
        document.getElementById('min-loss-result').textContent = formatCurrency(summary.min);
        document.getElementById('max-loss-result').textContent = formatCurrency(summary.max);
        document.getElementById('percentile-90-result').textContent = `> ${formatCurrency(summary.p90)}`;
        document.getElementById('cvar-95-result').textContent = formatCurrency(summary.cvar95);
        document.getElementById('prob-threshold-result').textContent = `${summary.probExceedance.toFixed(1)}%`;

        // Años que no costaron nada. Con el modelo compuesto de frecuencia, un riesgo raro tiene
        // la mayoría de sus años en $0 exacto, así que el P90 (y a veces la mediana) salen en cero.
        // Es la respuesta correcta, pero un "$0" solo se lee como si la app estuviera rota — esta
        // nota es la que lo convierte en información. No aparece cuando no hay años en cero.
        const notaCeros = document.getElementById('fair-zero-years-note');
        const pctCeros = summary.zeroLossYearsPercent;
        if (notaCeros && typeof pctCeros === 'number' && pctCeros > 0) {
            const deCada10 = Math.round(pctCeros / 10);
            const simple = App.UIMode.mode === 'simple';
            notaCeros.textContent = simple
                ? `De cada 10 años, en ${deCada10} no perderías nada por este riesgo: simplemente no pasa. Por eso varias de las cifras de arriba salen en $0 — no es un error, es que la pérdida no llega repartida, llega de golpe el año que ocurre.`
                : `El ${pctCeros.toFixed(1)}% de los años simulados no registró ningún evento. Por eso la mediana y el P90 pueden salir en $0: la pérdida no se reparte entre todos los años, se concentra en los pocos en que el evento ocurre.`;
            notaCeros.classList.remove('hidden');
        } else if (notaCeros) {
            notaCeros.classList.add('hidden');
        }

        // Cuántas veces prosperó un ataque, no cuánto costó. Todo lo demás en esta pantalla está en
        // dinero; el motor ya sorteaba este conteo y lo tiraba. Es la lectura que hace intuitivo el
        // resto — "te pegaron 4.012 veces en 10.000 años" se entiende sin saber qué es un percentil.
        // Solo existe con el modelo compuesto de frecuencia (ver summarizeEventCounts).
        const notaEventos = document.getElementById('fair-events-note');
        const eventos = result.events;
        if (notaEventos && eventos && eventos.totalEvents > 0) {
            const simple = App.UIMode.mode === 'simple';
            const n = (x) => x.toLocaleString('es-MX');
            const cadaCuanto =
                eventos.meanEventsPerYear >= 1
                    ? `${eventos.meanEventsPerYear.toFixed(1)} veces por año`
                    : `una vez cada ${(1 / eventos.meanEventsPerYear).toFixed(1)} años`;
            notaEventos.textContent = simple
                ? `Contando golpes en vez de dinero: en los ${n(eventos.years)} años simulados el ataque prosperó ${n(eventos.totalEvents)} veces — en promedio ${cadaCuanto}. El peor año acumuló ${eventos.maxEventsInAYear}.`
                : `Eventos consumados: ${n(eventos.totalEvents)} en ${n(eventos.years)} años simulados (${eventos.meanEventsPerYear.toFixed(3)} por año). Máximo en un solo año: ${eventos.maxEventsInAYear}. Es el conteo de ataques que superaron la defensa, antes de traducirlo a dinero.`;
            notaEventos.classList.remove('hidden');
        } else if (notaEventos) {
            notaEventos.classList.add('hidden');
        }

        // RUIDO DE SIMULACIÓN. El motor calculaba estos dos errores desde hacía tiempo y no salían
        // de la librería — mismo caso que el conteo de eventos. Sin mostrarlos, volver a simular el
        // mismo riesgo con otra semilla movía el año malo hasta un 5 % y eso se leía como un bug de
        // la app en vez de como lo que es: la muestra útil de un riesgo raro no es 10.000 años sino
        // los ~500 en que pasó algo.
        //
        // Se muestran los DOS porque no son el mismo número, y el que decide es el del año malo
        // (alimenta los Criterios de Riesgo y el reparto del portafolio).
        const notaError = document.getElementById('fair-mc-error-note');
        const errAle = summary.standardErrorPercent;
        const errCvar = summary.cvar95StandardErrorPercent;
        if (notaError && typeof errAle === 'number') {
            const simple = App.UIMode.mode === 'simple';
            // El umbral no es estético: por debajo del 1 % el ruido es irrelevante para decidir,
            // por encima del 3 % el número todavía baila lo bastante como para no apoyar una
            // decisión de inversión sin volver a simular con más escenarios.
            const peor = Math.max(errAle, typeof errCvar === 'number' ? errCvar : 0);
            const alto = peor > 3;
            notaError.className = alto
                ? 'mt-2 p-2 rounded text-sm bg-amber-50 border-l-4 border-amber-400 text-amber-900'
                : 'mt-2 p-2 rounded text-sm bg-gray-100 text-gray-700';
            const cifras =
                typeof errCvar === 'number'
                    ? `±${errAle.toFixed(1)} % en el promedio y ±${errCvar.toFixed(1)} % en el año malo`
                    : `±${errAle.toFixed(1)} % en el promedio`;
            const n = (result.iterations || 0).toLocaleString('es-MX');
            const base = simple
                ? `Estas cifras salen de simular ${n} años al azar, así que traen algo de ruido propio: ${cifras}. Volver a calcular da números un poco distintos, y eso es normal.`
                : `Ruido de muestreo por usar ${n} escenarios en vez de infinitos: ${cifras}.`;
            // Cuántos escenarios se corrieron ya no es fijo: lo decide el backend según el riesgo.
            // Se dice CÓMO se eligió, y sobre todo si se quedó corto — entregar un resultado con
            // más ruido del pedido es aceptable, entregarlo sin avisar no.
            const prec = result.precision;
            let comoSeEligio = '';
            if (prec && prec.mode === 'adaptativo') {
                comoSeEligio =
                    prec.stoppedBy === 'objetivo'
                        ? ` Se corrieron los escenarios necesarios para bajar de ±${prec.targetCvarErrorPercent} % y no más.`
                        : ` Se cortó ${prec.stoppedBy === 'tiempo' ? 'por tiempo' : 'en el máximo de escenarios'} antes de llegar al ±${prec.targetCvarErrorPercent} % buscado, así que estas cifras traen más ruido del deseado.`;
            }
            const aviso = alto
                ? ' Es bastante: en un riesgo poco frecuente la mayoría de los años no pasa nada y no aportan información, así que la muestra útil es mucho más chica de lo que parece. Conviene tomar estas cifras como aproximadas.'
                : '';
            // Nunca el ruido a secas: al lado del error de simulación tiene que estar de qué está
            // hecha la entrada, o se lee como si el número fuera preciso al decimal.
            const encuadre = simple
                ? ' Ojo: esto solo mide el ruido del cálculo, no si los datos que le diste son buenos.'
                : ' Mide solo el error numérico, no la incertidumbre de las entradas (ver Calidad de la Información).';
            notaError.textContent = base + comoSeEligio + aviso + encuadre;
            notaError.classList.remove('hidden');
        } else if (notaError) {
            notaError.classList.add('hidden');
        }

        // Riesgo Inherente: solo lo trae Amenaza (ver calculateInherentRiskFromSimulation en el
        // backend). Se oculta la línea entera en vez de mostrar "$NaN".
        const inherenteLine = document.getElementById('fair-inherente-line');
        if (typeof summary.inherentALE === 'number') {
            inherenteLine.classList.remove('hidden');
            document.getElementById('fair-inherente-result').textContent = formatCurrency(summary.inherentALE);
        } else {
            inherenteLine.classList.add('hidden');
        }

        App.FairWizard.renderLossHistogram(result.annualLosses, summary.max);
        App.FairWizard.renderLossExceedanceCurve({
            curva: result.lossExceedanceCurve || null,
            inherente: result.inherentLossExceedanceCurve || null,
        });
        App.FairWizard.renderSensitivity(result.sensitivity);
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
