// Estado compartido de la app (Fase 3a del plan de migración). Es un único objeto: quien lo
// importa recibe la MISMA instancia, así que mutar sus propiedades (ej. state.fair.x = ...)
// se sigue viendo en todos los módulos que lo importan, igual que antes de dividir el
// archivo — nadie debe reasignar la variable completa (state = {...}).
import { getSafeNumber, LOSS_FORMS_KEYS } from './utils.js';

export const state = {
    config: {
        SIMULATION_ITERATIONS: 10000,
        // Criterios de Riesgo (Contexto — ISO 31000, cláusula 6.3.4).
        // Estos valores definen qué se considera un riesgo aceptable, alto o crítico
        // para esta organización. Son editables desde "Criterios de Riesgo" en el menú
        // y se guardan en este navegador — NO son constantes fijas del programa.
        riskCriteria: {
            // Bandas para clasificar el Riesgo Residual (%) del módulo de Análisis Rápido.
            rrtBands: { medio: 25, alto: 50, critico: 75 },
            // Pérdida Anual Aceptable, como % del ALE Crítico (Apetito de Riesgo). El ALE
            // Aceptable en USD se deriva de esto: aleCritico * aleAceptablePercent / 100.
            aleAceptablePercent: 20,
            aleCritico: 250000,
            // Umbral usado para "Probabilidad de superar $X/año" en los resultados FAIR.
            aleUmbralExcedencia: 100000,
            // false hasta que App.Api.bootstrap() traiga el valor real del backend — mientras
            // tanto, App.Criteria.isComplete() no debe pensar que esto ya fue declarado por el
            // usuario (ver App.Criteria.showGate, el candado obligatorio de primer uso).
            declared: false,
        },
    },
    quick: {
        // attackerProfiles/defenseProfiles los sigue usando FAIR (Paso 2, resumen de
        // Perfil de Atacante/Defensa y la explicación de Reducción de ALE al Mitigar).
        attackerProfiles: {},
        defenseProfiles: {},
        history: [],
        // La norma/estándar del Catálogo de Riesgos elegida más recientemente para el
        // riesgo que se está llenando ahora mismo (ver App.RiskCatalog.useSelected()). Se
        // limpia si el usuario escribe encima de "Nombre del Riesgo" a mano, para no
        // asociar por error la norma de un riesgo distinto.
        selectedCatalogRef: null,
        // Catálogo de Activos (backend, CRUD real — a diferencia de riskCatalog, que es
        // curado en código y de solo lectura). Se carga en App.Api.bootstrap() y se
        // refresca cada vez que se abre la página del catálogo (ver App.AssetCatalog.load).
        assets: [],
        // El activo elegido más recientemente en el picker (ver App.AssetCatalog.openPicker)
        // para el riesgo que se está llenando ahora — mismo propósito que selectedCatalogRef,
        // para poder guardar de qué activo salió el valor y transferirlo a FAIR al promover.
        selectedAssetRef: null,
        // El id (backend, /api/risks) del riesgo actualmente cargado/guardado en el
        // formulario — permite a FAIR saber "este análisis continúa el riesgo X" al
        // promoverlo, en vez de tratarlo como un riesgo nuevo sin relación (ver
        // App.FairRegister.buildConcentratedList). Se limpia si el usuario escribe
        // encima de "Nombre del Riesgo" a mano, igual que selectedCatalogRef/selectedAssetRef.
        currentRiskId: null,
    },
    // Tratamiento del Riesgo (ISO 31000, 6.5) — página aparte (ver App.Treatment), separada
    // del wizard de FAIR: cualquier riesgo ya guardado se puede tratar sin volver a simular,
    // porque /api/treatment/evaluate solo necesita el ALE actual + los insumos de Mitigar/
    // Transferir/Evitar, que ya se guardan en cada entrada del Registro.
    treatment: {
        // La entrada COMPLETA del Registro que se está tratando ahora mismo (no solo su
        // nombre) — evita tener que volver a buscarla en state.fair.riskRegister en cada
        // función; se reemplaza por la respuesta del backend después de cada guardado.
        currentEntry: null,
        // Lista de trabajo de controles nombrados de Mitigar (ver App.Treatment.
        // openControlsModal/applyControlsAggregation) para el riesgo actualmente elegido —
        // [] si el riesgo no usa controles nombrados (sigue con el costo/fiabilidad/retraso
        // manuales de siempre).
        controls: [],
        // Última respuesta completa de POST /api/treatment/evaluate (ver updateTreatmentView) —
        // adoptStrategy() lee de aquí el residualALE ya calculado de la estrategia elegida, sin
        // volver a pedirlo. null hasta la primera evaluación del riesgo actual.
        lastResult: null,
        // Residual REAL de Mitigar (ALE/CVaR), obtenidos re-simulando con el Nivel de Defensa
        // Objetivo (ver updateReduccionALEAuto/calculateResidualFromSimulation) — se mandan tal
        // cual a /api/treatment/evaluate en vez de dejar que derive el residual de reductionPercent
        // × currentALE/currentCVaR. null en modo manual (sin perfil objetivo que simular) o antes
        // del primer autocálculo.
        mitigarResidualALE: null,
        mitigarResidualCVaR: null,
    },
    // Gestión de Riesgos (Gobernanza/Revisión + Plan de Seguridad) — página aparte (ver
    // App.RiskManagement), mismo criterio que treatment de arriba: separada del wizard porque
    // estos datos se actualizan durante toda la vida del riesgo, no solo al simular.
    riskManagement: {
        currentEntry: null,
        // Guardián contra condición de carrera de red (mismo patrón que
        // App.Treatment._reduccionALERequestId) para la reclasificación async del Riesgo
        // Residual (ver App.RiskManagement.renderResidualStatus) al elegir un riesgo.
        residualRequestId: 0,
    },
    fair: {
        fairResultsChart: null,
        simulatedALE: 0,
        pendingRisks: [],
        riskRegister: [],
        // El id de /api/risks del que salió el análisis actualmente cargado en el wizard (si
        // vino de Análisis Rápido) — se envía como sourceRiskId al guardar en el Registro,
        // para que la tabla concentrada sepa que esta simulación es la continuación de ese
        // mismo riesgo y no lo liste dos veces. Null si el análisis se armó desde cero en FAIR.
        sourceRiskId: null,
        // Id propio de la entrada del Registro que corresponde al análisis actualmente
        // cargado (si ya se guardó al menos una vez) — permite que volver a simular
        // actualice la MISMA entrada aunque el nombre del riesgo haya cambiado mientras
        // tanto, en vez de crear una nueva huérfana (ver findRegisterEntryIndex, backend).
        registerEntryId: null,
        currentStep: 1,
        // Promesa del autocálculo (Vulnerabilidad/Magnitud/etc.) en vuelo, si hay uno — lo
        // fija _trackPendingAutocalc() y navigateWizard() lo espera antes de validar, para
        // no bloquear "Siguiente" con datos todavía en 0 mientras la llamada al backend
        // sigue en camino (ver bindEvents()).
        pendingAutocalc: null,
        // Apetito de Riesgo (Pérdida Anual Aceptable %/ALE Crítico) solo para el riesgo que se
        // está armando ahora mismo — null usa los criterios globales de config.riskCriteria (ver
        // App.FairWizard.openCriteriaOverrideEditor). Se limpia al empezar un riesgo nuevo
        // (resetForm) y se restaura al reanudar/cargar uno ya guardado que lo tenía.
        riskCriteriaOverride: null,
        // true en cuanto el usuario teclea directamente en TEF (ver bindEvents) — a partir de
        // ahí suggestTefRange() deja de tocar esos campos, para no pisar un dato real.
        tefManuallyEdited: false,
        // Filas de trabajo de "Riesgos Desencadenantes" (Paso 1) — array vivo, mismo criterio
        // que reviewHistory: { riskName, probability }[], sincronizado desde el DOM antes de
        // guardar/re-pintar (ver App.FairWizard.renderTriggeredByRows/syncTriggeredByDraftFromDom).
        triggeredByDraft: [],
        stepValidations: {
            1: () => document.getElementById('fair-riskName').value.trim() !== '',
            2: () => {
                const checkRange = (prefix) => {
                    const min = getSafeNumber(document.getElementById(`${prefix}-min`));
                    const mode = getSafeNumber(document.getElementById(`${prefix}-mode`));
                    const max = getSafeNumber(document.getElementById(`${prefix}-max`));
                    return min <= mode && mode <= max;
                };
                return checkRange('tef') && checkRange('vuln');
            },
            3: () => {
                const lossFormsKeys = LOSS_FORMS_KEYS;
                return lossFormsKeys.every((key) => {
                    const min = getSafeNumber(document.getElementById(`lm-${key}-min`));
                    const mode = getSafeNumber(document.getElementById(`lm-${key}-mode`));
                    const max = getSafeNumber(document.getElementById(`lm-${key}-max`));
                    return min <= mode && mode <= max;
                });
            },
        },
    },
};
