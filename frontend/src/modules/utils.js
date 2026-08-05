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
