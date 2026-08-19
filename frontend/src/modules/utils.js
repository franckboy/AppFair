// Utilidades genéricas + constantes compartidas (Fase 3a del plan de migración).
import { App } from './app-namespace.js';

// --- APPLICATION CONFIGURATION ---
// Los perfiles de Atacante/Defensa/Riesgo ya NO viven hardcodeados aquí — antes había una
// copia de esto también en backend/src/data/profiles.js, y las dos copias se desincronizaron
// (bug real, ya corregido una vez). Ahora el backend es la única fuente de verdad; se cargan
// en App.Api.bootstrap() vía GET /api/config/profiles y se guardan en state.quick.*.

// Las 9 categorías de Magnitud de Pérdida (FAIR) son campos fijos del formulario (no vienen
// de ningún perfil configurable), y coinciden exactamente con backend/src/data/profiles.js
// (lossFormsKeys) — un solo lugar en vez de repetir este arreglo por todo el archivo.
export const LOSS_FORMS_KEYS = [
    'productividad',
    'respuesta',
    'reemplazo',
    'multas',
    'reputacion',
    'investigacion',
    'oportunidad',
    'comunitario',
    'ambiental',
];

// Diccionario Modo Simple/Técnico para las 9 categorías de Magnitud de Pérdida — mismo
// patrón que App.UIMode.STEP_LABELS/RESULT_LABELS, pero aparte porque estos elementos se
// generan dinámicamente en App.FairWizard.populateLossMagnitudeForms() en vez de existir
// ya en el HTML. Técnico usa el nombre FAIR/contable de cada forma de pérdida; Simple lo
// convierte en la pregunta que de verdad hay que responder.
export const LOSS_FORM_LABELS = {
    tecnico: {
        productividad: '1. Pérdida de Productividad',
        respuesta: '2. Costos de Respuesta',
        reemplazo: '3. Costos de Reemplazo',
        multas: '4. Multas y Sanciones',
        reputacion: '5. Daño Reputacional',
        investigacion: '6. Costos de Investigación',
        oportunidad: '7. Negocio No Capturado (Ventaja Competitiva)',
        comunitario: '8. Impacto Comunitario/Societario',
        ambiental: '9. Impacto Ambiental',
    },
    simple: {
        productividad: '1. ¿Cuánto perderías por gente que no puede trabajar mientras pasa esto?',
        respuesta: '2. ¿Cuánto costaría responder de inmediato (investigar, contener, avisar)?',
        reemplazo: '3. ¿Cuánto costaría reemplazar o reparar lo dañado o robado?',
        multas: '4. ¿Tendrías que pagar alguna multa o sanción legal?',
        reputacion: '5. ¿Cuánto te costaría recuperar tu imagen o la confianza de tus clientes?',
        investigacion: '6. ¿Cuánto costaría investigar a fondo qué pasó?',
        oportunidad: '7. ¿Cuánto negocio o ventas perderías mientras esto pasa?',
        comunitario: '8. ¿Afectaría a la comunidad de alguna forma que cueste dinero?',
        ambiental: '9. ¿Habría algún costo ambiental (limpieza, remediación, multas)?',
    },
};
export const LOSS_FIELD_LABELS = {
    tecnico: { min: 'Costo (min) — calculado', mode: 'Costo (Más Probable)', max: 'Costo (max) — calculado' },
    simple: {
        min: 'En el mejor caso (calculado)',
        mode: '¿Cuánto costaría en el caso típico?',
        max: 'En el peor caso (calculado)',
    },
};

// Nombres cortos para el Análisis de Sensibilidad (Paso 4 y Registro consolidado) — el
// backend manda 'key' (ver backend/src/lib/simulation.js) además de 'name' (el nombre
// técnico, usado tal cual en Modo Técnico) precisamente para que esto no tenga que
// duplicar ninguna lógica de cálculo, solo traducir la etiqueta.
export const SENSITIVITY_LABELS_SIMPLE = {
    tef: 'Qué tan seguido pasa',
    vulnerabilidad: 'Qué tan probable es que funcione',
    'lm:productividad': 'Productividad perdida',
    'lm:respuesta': 'Costos de responder',
    'lm:reemplazo': 'Costos de reemplazo',
    'lm:multas': 'Multas',
    'lm:reputacion': 'Daño a tu imagen',
    'lm:investigacion': 'Costos de investigar',
    'lm:oportunidad': 'Negocio perdido',
    'lm:comunitario': 'Impacto en la comunidad',
    'lm:ambiental': 'Impacto ambiental',
};
export function sensitivityLabel(factor) {
    if (App.UIMode.mode === 'simple' && factor.key && SENSITIVITY_LABELS_SIMPLE[factor.key]) {
        return SENSITIVITY_LABELS_SIMPLE[factor.key];
    }
    return factor.name;
}

// Etiquetas cortas (encabezado de tabla, <li> corto) para los términos técnicos que se repiten
// en varias páginas fuera del wizard FAIR (Tratamiento, Gestión de Riesgos, Registro, Árbol de
// Cascada) — mismo patrón que SENSITIVITY_LABELS_SIMPLE/sensitivityLabel arriba, pero como
// función de un solo lugar en vez de duplicar la traducción en cada módulo que arma su propio
// HTML por JS (esos módulos no pueden usar el swap posterior de App.UIMode.applyLabels() porque
// reconstruyen su HTML — con innerHTML — cada vez que cambia el riesgo seleccionado).
export const SHORT_METRIC_LABELS_SIMPLE = {
    ale: 'Pérdida Promedio',
    cvar95: 'Peor Caso Típico (5%)',
    p90: 'Peor 10% de los Casos',
    pareto: 'Los Que Más Pesan',
};
export function shortMetricLabel(key, fallbackTechnicalText) {
    if (App.UIMode.mode === 'simple' && SHORT_METRIC_LABELS_SIMPLE[key]) {
        return SHORT_METRIC_LABELS_SIMPLE[key];
    }
    return fallbackTechnicalText;
}

// Formato de moneda único para toda la app — antes cada módulo definía su propia versión local
// (con inconsistencias reales entre ellas: unas mostraban centavos y otras no, y la versión
// armada a mano con Math.round + toLocaleString rompía con negativos, ej. "$-500" en vez de
// "-$500"). Siempre dólares enteros (sin centavos) y '—' si el valor no es un número — mismo
// criterio que ya usaba risk-summary-bar.js antes de este cambio.
export function formatCurrency(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
}

// `evaluation.justification` (calculado por evaluateFairThreat/evaluateFairOpportunity, ver
// backend/src/lib/evaluation.js) menciona CVaR95/percentiles a propósito — sigue siendo la
// prosa correcta para Modo Técnico y para el reporte PDF (ver fair-export.js, que se queda
// siempre técnico). Modo Simple NO reusa ese texto: arma su propia frase, con los MISMOS
// números (`ale`/`cvar95`) y el mismo nivel/severidad ya calculados, sin mencionar percentiles
// ni el nombre de ninguna métrica. Se usa tanto en el banner del Paso 4 del wizard como en el
// panel de "Simular Familia" del Árbol de Cascada — las dos pantallas que hoy insertan
// `evaluation.justification` tal cual.
export function simpleEvaluationMessage(evaluation, ale, cvar95, riskType, formatCurrency) {
    if (riskType === 'oportunidad') {
        if (evaluation.level.startsWith('Oportunidad Significativa')) {
            return `En promedio, esto te podría beneficiar ${formatCurrency(ale)} al año — vale la pena invertir en perseguirlo.`;
        }
        if (evaluation.level.startsWith('Oportunidad Moderada')) {
            return `En promedio, esto te podría beneficiar ${formatCurrency(ale)} al año — considera perseguirlo si tienes los recursos.`;
        }
        return `En promedio, esto te podría beneficiar ${formatCurrency(ale)} al año — probablemente no justifique un esfuerzo dedicado por sí solo.`;
    }

    const isTailDriven = evaluation.level.includes('cola');
    if (evaluation.severity === 'critico') {
        return isTailDriven
            ? `En promedio parece manejable (${formatCurrency(ale)} al año), pero en un mal año podrías perder mucho más (${formatCurrency(cvar95)}) — vale la pena tratarlo ya.`
            : `Esto te podría costar ${formatCurrency(ale)} al año en promedio — es más de lo que tu organización dijo estar dispuesta a perder. Hay que actuar ya.`;
    }
    if (evaluation.severity === 'alto') {
        return `Esto te podría costar ${formatCurrency(ale)} al año en promedio — se acerca al límite de lo que estás dispuesto a perder. Conviene tratarlo.`;
    }
    if (evaluation.severity === 'medio') {
        return `Esto te podría costar ${formatCurrency(ale)} al año en promedio — no es urgente, pero vale la pena vigilarlo.`;
    }
    return `Esto te podría costar ${formatCurrency(ale)} al año en promedio — está dentro de lo que tu organización está dispuesta a perder.`;
}

// --- Helper Functions ---
export const sanitizeHTML = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

export const getSafeNumber = (input) => {
    if (!input) return 0;
    const val = parseFloat(input.value);
    return isNaN(val) ? 0 : Math.max(0, val);
};

// Espera a que el usuario deje de escribir antes de disparar `fn` — se usa solo en los
// campos de Tratamiento (costo/prima/deducible, etc.) porque, a diferencia de los demás
// autocálculos (que reaccionan a un <select> en 'change'), esos SÍ están atados a 'input'
// de texto libre, y cada llamada ahora es una petición de red a /api/treatment/evaluate.
//
// .flush(): dispara YA la llamada pendiente (si hay una) y cancela el timer — sin esto, cambiar
// de riesgo en el selector de Tratamiento/Gestión de Riesgos ANTES de que venza el delay perdía
// la edición en curso en silencio: el guardado debounced disparaba después de que selectRisk()
// ya había cambiado state.xxx.currentEntry Y los valores del DOM al riesgo nuevo, así que
// terminaba guardando (sin cambios) el riesgo nuevo en vez de la edición del riesgo anterior.
export const debounce = (fn, delayMs) => {
    let timeoutId = null;
    let pendingArgs = null;
    const debounced = (...args) => {
        pendingArgs = args;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            timeoutId = null;
            const args = pendingArgs;
            pendingArgs = null;
            fn(...args);
        }, delayMs);
    };
    debounced.flush = () => {
        if (timeoutId === null) return;
        clearTimeout(timeoutId);
        timeoutId = null;
        const args = pendingArgs;
        pendingArgs = null;
        fn(...args);
    };
    return debounced;
};

export const updateProgressBar = (containerId, currentStep, totalSteps) => {
    const progressBarContainer = document.getElementById(containerId);
    if (!progressBarContainer) return;

    const steps = progressBarContainer.querySelectorAll('.wizard-progress-step');
    steps.forEach((stepEl, index) => {
        stepEl.classList.toggle('active', index < currentStep);
    });
};

export const toggleErrorState = (elementId, message) => {
    const inputEl = document.getElementById(elementId);
    const errorEl = document.getElementById(`${elementId}-error`);

    if (message) {
        inputEl.classList.add('input-error');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    } else {
        inputEl.classList.remove('input-error');
        errorEl.classList.add('hidden');
    }
};

export const showToast = (message) => {
    const toast = document.createElement('div');
    toast.className = 'toast hide';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger the animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Hide and remove the toast
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
};

// Agrupa las pérdidas anuales simuladas (Monte Carlo) en `numBins` cubetas de igual ancho, para
// dibujar el histograma de resultados — usado tanto en Análisis FAIR (gráfico en vivo tras
// simular) como en Registro de Riesgos (al re-simular un riesgo ya guardado). Antes esta misma
// lógica estaba copiada literal en los dos módulos; un solo lugar evita que se desincronicen.
export const buildHistogramBins = (losses, maxLoss, numBins = 20) => {
    const binWidth = maxLoss > 0 ? maxLoss / numBins : 1;
    const labels = [];
    for (let i = 0; i < numBins; i++) {
        labels.push(`${((i * binWidth) / 1000).toFixed(0)}k`);
    }
    const binCounts = new Array(numBins).fill(0);
    losses.forEach((loss) => {
        const binIndex = Math.min(Math.floor(loss / binWidth), numBins - 1);
        binCounts[binIndex]++;
    });
    return { labels, binCounts };
};

// Punto de partida automático para TEF (Paso 2 del wizard FAIR — ver App.FairWizard.suggestTefRange()
// para cómo se usa). No hay forma de calcular "cuántas veces al año" con certeza solo a partir
// de un perfil de atacante — depende del contexto real de la organización, que el software no
// conoce. Por eso esto es una SUGERENCIA editable, no un cálculo "verdadero" como Vulnerabilidad
// o Magnitud de Pérdida, que sí son derivables con la info disponible.
//
// La Frecuencia depende de qué tan motivado y persistente es el atacante — NO de tu nivel de
// Defensa. La Defensa ya se aplica en Vulnerabilidad (si el ataque tiene éxito); usarla también
// aquí contaría el mismo efecto dos veces.
//
// El multiplicador escala según la motivación+persistencia del atacante en bruto (0-100), no
// centrada en 50 — antes, un atacante "por debajo del promedio" (ej. Intruso Oportunista, o el
// Grupo Organizado que da justo 50) hacía que subir el ponderador de "qué tan deliberada es la
// amenaza" bajara o no moviera la frecuencia sugerida, mismo problema que el de Riesgo Inherente
// en Análisis Rápido: marcar una amenaza como deliberada y pesarla más nunca debería sugerir
// MENOS frecuencia que el punto de partida neutral (BASE_MODE, ponderación=0) — solo puede
// sugerir igual o más.
// Frecuencia de Eventos de Amenaza (intentos al año) sugerida por Perfil de Atacante.
//
// Anclas de juicio experto en seguridad patrimonial, sobre escenarios concretos:
//   - Hurto oportunista en bodega urbana ......... 12-24 intentos/año (base 18)
//   - Robo de carga por crimen organizado ........  1-2  intentos/año (base 1,2)
//   - Terrorismo / sabotaje industrial ...........  0,02 intentos/año (1 cada 50 años)
//
// La relación con la capacidad del atacante es INVERSA, y eso corrige una premisa equivocada del
// modelo anterior (que partía de 10 intentos/año para todos y los SUBÍA con la Motivación y la
// Persistencia). La frecuencia con la que TU activo recibe intentos no la manda cuánto empeño pone
// cada atacante: la mandan cuántos actores de ese tipo hay sueltos y qué tan indiscriminados son.
// Un oportunista prueba puertas todo el tiempo; un actor estatal monta una campaña dirigida cada
// varios años. La Motivación y la Persistencia sí importan, pero para si el intento TIENE ÉXITO —
// eso ya lo modela la Vulnerabilidad.
const TEF_ANCHORS_BY_PROFILE_SCORE = [
    { profileScore: 18, eventsPerYear: 18 }, // intruso oportunista
    { profileScore: 60, eventsPerYear: 1.2 }, // crimen organizado
    { profileScore: 90, eventsPerYear: 0.02 }, // terrorista o espía
];

/** Interpola la frecuencia base en escala LOGARÍTMICA — las anclas abarcan tres órdenes de
 * magnitud (18 a 0,02), así que interpolar linealmente aplastaría todo el extremo bajo. */
function anchoredEventsPerYear(profileScore) {
    const nodes = TEF_ANCHORS_BY_PROFILE_SCORE;
    const logs = nodes.map((n) => Math.log(n.eventsPerYear));
    if (profileScore <= nodes[0].profileScore) return nodes[0].eventsPerYear;
    for (let i = 1; i < nodes.length; i++) {
        if (profileScore <= nodes[i].profileScore) {
            const t = (profileScore - nodes[i - 1].profileScore) / (nodes[i].profileScore - nodes[i - 1].profileScore);
            return Math.exp(logs[i - 1] + t * (logs[i] - logs[i - 1]));
        }
    }
    return nodes[nodes.length - 1].eventsPerYear;
}

// Sensibilidad neutra del deslizador: con este valor la sugerencia es exactamente el ancla.
const TEF_PONDERATION_NEUTRAL = 0.7;

/** Redondea conservando información en el extremo bajo: 18 se queda en 18, pero 0,02 NO puede
 * redondearse a 0 — el modelo anterior tenía un piso rígido en 1 evento/año que hacía imposible
 * expresar una amenaza de baja frecuencia y alto impacto. */
function roundFrequency(value) {
    if (value >= 10) return Math.round(value);
    if (value >= 1) return Math.round(value * 10) / 10;
    return Math.round(value * 1000) / 1000;
}

export const computeSuggestedTef = (attackerProfile, attackerKey, ponderacion, isDeliberate) => {
    const attributes = Object.entries(attackerProfile)
        .filter(([key]) => key !== 'name')
        .map(([, value]) => value);
    const profileScore = attributes.length ? attributes.reduce((sum, v) => sum + v, 0) / attributes.length : 0;

    const base = anchoredEventsPerYear(profileScore);
    // El deslizador ya no deriva de Motivación/Persistencia (ver arriba): ahora solo sube o baja la
    // sugerencia alrededor del ancla, y en su posición neutra la deja tal cual.
    const multiplier = isDeliberate ? Math.max(0.1, ponderacion / TEF_PONDERATION_NEUTRAL) : 1;
    const mode = roundFrequency(base * multiplier);

    return {
        min: roundFrequency(mode * 0.75),
        mode,
        max: roundFrequency(mode * 1.5),
        explanation: `Sugerido según el Perfil "${attackerProfile.name || attackerKey}"${isDeliberate ? ' y la sensibilidad de ajuste elegida' : ''} — es un punto de partida, no un cálculo exacto. Edítalo si tienes un dato mejor (histórico, benchmark del sector, etc.).`,
    };
};

// Un rango triangular (min/más probable/max) exige min <= mode <= max — se usa tanto para TEF/
// Vulnerabilidad (Paso 2) como para cada categoría de Magnitud de Pérdida (Paso 3), cuando el
// usuario edita a mano y puede dejar los tres valores desordenados.
export const sortTriangularRange = (values) => [...values].sort((a, b) => a - b);

// Media de una distribución Beta-PERT(min, mode, max, lambda=4) — fórmula estándar
// (min + lambda·mode + max) / (lambda + 2). El backend simula Vulnerabilidad con PERT (ver
// backend/src/lib/random.js:getPertRandom), no con una triangular ni con la moda sola — así
// que para "des-mitigar" el ALE Residual y estimar el Riesgo Inherente (ver
// App.FairRegister.computeFairRiskEquivalents) hay que usar la media de ESA distribución, no
// la de otra. Antes se dividía entre la MODA de Vulnerabilidad directamente, que no es lo
// mismo que su media — la moda es solo el valor "más probable" de la distribución, mientras
// que la media es el centro de masa de toda la distribución (incluyendo la cola hacia min y
// hacia max), que es lo que corresponde usar para "des-mitigar" un promedio (el ALE Residual
// que reporta el motor SÍ es un promedio de todas las iteraciones de Monte Carlo). Con
// lambda=4, PERT le da 4x más peso a la moda que a min/max juntos — por diseño, para que un
// experto que da un solo valor "más probable" no vea ese valor diluido por los extremos, que
// es justo lo que le pasaba a la triangular (ver README, sección de distribuciones).
export const pertMean = (min, mode, max, lambda = 4) => (min + lambda * mode + max) / (lambda + 2);

// La evaluación de resultados FAIR (Crítico/Alto/Medio/Bajo + justificación) ahora la
// calcula el backend en /api/simulate — este mapa solo traduce su `severity` a las
// clases Tailwind que ya usaba la UI, porque el backend correctamente no sabe nada de CSS.
export const severityToClasses = (severity) =>
    ({
        critico: 'bg-red-50 border-red-600 text-red-800',
        alto: 'bg-orange-50 border-orange-500 text-orange-800',
        medio: 'bg-yellow-50 border-yellow-500 text-yellow-800',
        bajo: 'bg-green-50 border-green-500 text-green-800',
    })[severity] || 'bg-gray-50 border-gray-400 text-gray-700';

// Mismo mapeo que severityToClasses, pero en hex — para el mapa de calor consolidado, que
// se dibuja en un <canvas> (Chart.js) y no puede usar clases de Tailwind. Mismos tonos que
// los bordes de los badges de arriba, para que el color signifique lo mismo en toda la app.
export const severityToHex = (severity) =>
    ({
        critico: '#DC2626', // red-600
        alto: '#F97316', // orange-500
        medio: '#EAB308', // yellow-500
        bajo: '#22C55E', // green-500
    })[severity] || '#7C3AED'; // severidad desconocida/faltante: el morado que ya se usaba antes

// Bug real encontrado: el punto de un riesgo en la Matriz de Riesgos se coloreaba con
// `r.severity` (evaluateFairThreat en el backend — compara el ALE en dólares contra
// aleAceptable/aleCritico, y SOLO puede devolver 'critico'/'alto'/'bajo', nunca 'medio'), un
// criterio totalmente distinto al que colorea el fondo de las zonas de la matriz misma
// (posición x/y del punto — Impacto%/Probabilidad% — contra las bandas rrtBands, ver
// getRiskMatrixZones en el backend). Como son dos cálculos independientes, un punto podía
// salir rojo ("crítico" por su ALE en dólares) parado sobre una zona amarilla ("Medio" por su
// posición) — visualmente contradictorio en un mapa que se supone que el color del punto
// significa "en qué zona cae". Esta función clasifica al punto con el MISMO criterio que ya
// pintó la zona debajo de él (las `zones` que ya trae la respuesta de /api/register), así el
// punto SIEMPRE es del mismo color que el cuadrante donde está parado, por construcción.
// getRiskMatrixZones (backend) lista la 'Alto' que cubre TODO el cuadrante superior derecho
// ANTES que la 'Crítico' más chica que va adentro de esa misma esquina — al pintar en el
// canvas eso funciona bien (Crítico se dibuja despues, tapando/encima de Alto ahí), pero con
// el primer match de un .find() normal (de adelante hacia atrás) un punto en la esquina
// (100,100) encontraba 'Alto' primero y nunca llegaba a 'Crítico'. Se recorre de ATRÁS hacia
// ADELANTE para que la zona que "gana" sea la misma que se ve pintada encima en el canvas
// (la dibujada más tarde), no la primera que aparece en la lista.
export const classifyPointSeverity = (x, y, zones) => {
    const levelToSeverityKey = { Bajo: 'bajo', Medio: 'medio', Alto: 'alto', Crítico: 'critico' };
    const list = zones || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const z = list[i];
        if (x >= z.x[0] && x <= z.x[1] && y >= z.y[0] && y <= z.y[1]) {
            return levelToSeverityKey[z.level];
        }
    }
    return null;
};

// Qué puntos de la cláusula 6 de ISO 31000 ("Proceso") ya cubrió un riesgo del Registro, según
// qué datos tiene guardados — no es una casilla que alguien marca a mano, se deriva de hechos
// verificables, así que nunca puede afirmar de más (ver App.RiskCascadeTree.openDetail, "Marco
// Normativo"). El tratamiento usa el mismo criterio de "¿de verdad se configuró?" que ya usa
// evaluateTreatmentStrategies en el backend (backend/src/lib/treatment.js): costo/prima > 0, no
// el default en 0 que trae cada riesgo nuevo sin tocar.
export const computeCoveredIsoClauses = (risk) => {
    if (!risk) return [];
    const clauses = [];
    if (risk.tef && risk.vuln && risk.lossMagnitudes) {
        clauses.push('6.4.2', '6.4.3', '6.4.4');
    }
    const hasRealTreatment =
        (risk.mitigar && risk.mitigar.cost > 0) ||
        (risk.transferir && risk.transferir.premium > 0) ||
        (risk.evitar && risk.evitar.cost > 0) ||
        !!risk.aceptarJustificacion;
    if (hasRealTreatment) clauses.push('6.5');
    if (Array.isArray(risk.reviewHistory) && risk.reviewHistory.length >= 2) clauses.push('6.6');
    return clauses;
};

// Cómo se lee un riesgo dentro del reparto del año malo (ver renderTailContributors): comparando
// su cuota de la COLA contra su cuota del PROMEDIO. Es la distinción que justifica ese bloque —
// el Pareto ya ordena por el promedio, y ordenar por la cola solo aporta si las dos cosas
// difieren:
//
//   'cola'       pesa bastante más en los años malos que en un año normal. Es un problema de
//                cola: le sirve más contener el daño por evento que bajar la frecuencia.
//   'recurrente' pesa más en el año promedio que en la cola. Es costo corriente, no un mal año.
//   null         ninguna de las dos cosas de forma clara.
//
// El umbral de relevancia evita etiquetar ruido: entre dos cifras diminutas la razón se dispara
// sin significar nada, y un riesgo que pone el 0,3 % del año malo no cambia ninguna decisión
// aunque su razón sea 4x. Función pura y aparte del render para poder probarla sin DOM.
export const TAIL_CONTRIBUTOR_MIN_SHARE = 5;
export const TAIL_CONTRIBUTOR_RATIO = 1.25;
export function tailContributorKind({ sharePercent, expectedSharePercent }) {
    if (!(sharePercent >= TAIL_CONTRIBUTOR_MIN_SHARE)) return null;
    if (sharePercent > expectedSharePercent * TAIL_CONTRIBUTOR_RATIO) return 'cola';
    if (expectedSharePercent > sharePercent * TAIL_CONTRIBUTOR_RATIO) return 'recurrente';
    return null;
}
