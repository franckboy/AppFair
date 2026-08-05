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
export const debounce = (fn, delayMs) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delayMs);
    };
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
export const computeSuggestedTef = (attackerProfile, attackerKey, ponderacion, isDeliberate) => {
    const frequencyFactor = (attackerProfile.motivation + attackerProfile.persistence) / 2;
    const attackerThreatFactor = frequencyFactor / 100;
    const multiplier = isDeliberate ? 1 + attackerThreatFactor * ponderacion : 1;

    const BASE_MODE = 10; // punto de partida neutral (amenaza no deliberada, o ponderación=0)
    const mode = Math.max(1, Math.round(BASE_MODE * multiplier));

    return {
        min: Math.max(1, Math.round(mode * 0.5)),
        mode,
        max: Math.round(mode * 1.8),
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
