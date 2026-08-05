import { App } from './app-namespace.js';
import { state } from './state.js';
import { LOSS_FORMS_KEYS, LOSS_FORM_LABELS, LOSS_FIELD_LABELS, showToast } from './utils.js';

// --- Modo Simple / Modo Técnico ---
// Cambia SOLO el lenguaje que ve el usuario — nunca el cálculo. Los mismos campos, las
// mismas fórmulas, el mismo Monte Carlo; lo único que cambia es cómo se nombran las cosas
// y qué secciones avanzadas se muestran (ver la clase CSS .advanced-only).
export const UIMode = {
    STORAGE_KEY: 'uiMode',
    mode: 'simple', // Modo Simple es el que ve un usuario nuevo por defecto

    STEP_LABELS: {
        tecnico: {
            'fair-step1-title': 'Paso 1: Definición del Escenario de Riesgo',
            'fair-step2-title': 'Paso 2: Análisis de Frecuencia de Evento de Pérdida',
            'fair-step3-title': 'Paso 3: Análisis de Magnitud de la Pérdida',
            'fair-step4-title': 'Paso 4: Simulación y Resultados',
            'tef-min-label': 'Contacto/Año (Mín)',
            'tef-mode-label': 'Contacto/Año (Más Probable)',
            'tef-max-label': 'Contacto/Año (Máx)',
            'fair-data-confidence-label': 'Nivel de Confianza en los Estimados:',
            'run-simulation-btn-label': 'Ejecutar Simulación Monte Carlo',
            'attacker-defense-section-title': 'Perfil del Atacante y Nivel de Defensa',
            'metrics-panel-title': 'Métricas Clave de Riesgo',
            'fair-mitigar-title': '1. Mitigar (reducir probabilidad o impacto)',
            'fair-costoControlAnual-label': 'Costo Anual del Control:',
            'fair-mitigar-defensa-objetivo-label': 'Nivel de Defensa Objetivo con este Control',
            'fair-reduccionALE-override-label': 'Escribir la Reducción de ALE (%) manualmente',
            'fair-reduccionALE-label': 'Reducción Estimada de ALE (%) — calculada',
            'fair-seguro-title': '2. Transferir / Compartir (seguro)',
            'fair-seguro-prima-label': 'Prima Anual:',
            'fair-seguro-deducible-label': 'Deducible por Evento:',
            'fair-seguro-limite-label': 'Límite de Cobertura',
            'fair-seguro-sin-limite-label': 'Cobertura ilimitada (sin tope) arriba del deducible',
            'fair-evitar-title': '3. Evitar (eliminar la fuente del riesgo)',
            'fair-evitar-costo-label': 'Costo Anualizado de Eliminar la Actividad/Fuente:',
            'fair-aceptar-title': '4. Aceptar / Retener (sin tratamiento)',
            'fair-aceptar-description':
                'ISO 31000 exige que aceptar un riesgo sea una decisión documentada y deliberada, no la ausencia de una decisión. Escribe la justificación.',
            'fair-aceptar-justificacion-label': 'Justificación de la aceptación:',
            'governance-section-title': 'Gobernanza y Revisión',
            'fair-owner-label': 'Dueño del Riesgo (responsable):',
            'fair-review-date-label': 'Próxima Fecha de Revisión:',
            'data-quality-section-title': 'Calidad de la Información',
        },
        simple: {
            'fair-step1-title': 'Paso 1: Cuéntanos qué riesgo vamos a analizar',
            'fair-step2-title': 'Paso 2: ¿Qué tan seguido pasaría, y qué tan probable es que funcione?',
            'fair-step3-title': 'Paso 3: ¿Cuánto te costaría si pasa?',
            'fair-step4-title': 'Paso 4: Resultado de la simulación',
            'tef-min-label': 'En el mejor caso (menos veces)',
            'tef-mode-label': 'Lo más probable',
            'tef-max-label': 'En el peor caso (más veces)',
            'fair-data-confidence-label': '¿Qué tan seguro estás de estos números?',
            'run-simulation-btn-label': 'Ver Qué Tan Probable Es Que Esto Me Cueste Caro',
            'attacker-defense-section-title': '¿Quién podría hacer esto, y qué tan preparada está tu defensa?',
            'metrics-panel-title': 'Lo que necesitas saber',
            'fair-mitigar-title': '1. Poner un control (que pase menos o duela menos)',
            'fair-costoControlAnual-label': '¿Cuánto cuesta ese control al año?',
            'fair-mitigar-defensa-objetivo-label': '¿A qué nivel de seguridad llegarías con este control?',
            'fair-reduccionALE-override-label': 'Prefiero escribir yo cuánto reduce la pérdida (%)',
            'fair-reduccionALE-label': 'Cuánto reduce la pérdida esperada (%) — calculado',
            'fair-seguro-title': '2. Contratar un seguro',
            'fair-seguro-prima-label': '¿Cuánto pagarías al año por el seguro?',
            'fair-seguro-deducible-label': '¿Cuánto pagas tú antes de que el seguro cubra algo?',
            'fair-seguro-limite-label': '¿Cuál es el máximo que cubre el seguro?',
            'fair-seguro-sin-limite-label': 'El seguro cubre todo, sin límite, arriba de lo que yo pago',
            'fair-evitar-title': '3. Dejar de hacer la actividad que causa el riesgo',
            'fair-evitar-costo-label': '¿Cuánto te costaría al año dejar de hacerlo?',
            'fair-aceptar-title': '4. No hacer nada y asumir el riesgo',
            'fair-aceptar-description':
                'Si decides no hacer nada, igual tienes que dejarlo por escrito y explicar por qué — no es lo mismo decidir aceptar el riesgo que simplemente no decidir nada.',
            'fair-aceptar-justificacion-label': '¿Por qué decides no hacer nada al respecto?',
            'governance-section-title': '¿Quién es responsable, y cuándo se revisa esto?',
            'fair-owner-label': '¿Quién es el responsable de este riesgo?',
            'fair-review-date-label': '¿Cuándo deberíamos revisarlo de nuevo?',
            'data-quality-section-title': '¿Qué tan buena es tu información?',
        },
    },

    RESULT_LABELS: {
        amenaza: {
            tecnico: {
                'fair-effect-label': 'Efecto / Pérdida:',
                'tef-header': 'Frecuencia de Evento de Amenaza',
                'vuln-header': 'Vulnerabilidad (%)',
                'chart-title': 'Distribución de Pérdida Anual',
                'ale-label': 'Pérdida Anual Esperada (ALE) — Promedio Simulado:',
                'median-label': 'Pérdida Anual Mediana (Percentil 50):',
                'min-label': 'Pérdida Mínima Simulada:',
                'max-label': 'Pérdida Máxima Simulada:',
                'p90-label': 'Pérdida en el peor 10% de los casos (P90):',
                'cvar-label': 'CVaR 95% (promedio del peor 5% de los casos):',
            },
            simple: {
                'fair-effect-label': 'Qué se vería afectado:',
                'tef-header': '¿Qué tan seguido crees que esto podría pasar?',
                'vuln-header': '¿Qué tan probable es que funcione, si lo intentan?',
                'chart-title': 'Cuánto podrías perder cada año (según 10,000 escenarios posibles)',
                'ale-label': 'En promedio, esto te podría costar al año:',
                'median-label': 'En la mitad de los años, perderías menos de:',
                'min-label': 'En el mejor caso, perderías:',
                'max-label': 'En el peor caso, perderías:',
                'p90-label': '9 de cada 10 años, perderías menos que:',
                'cvar-label': 'Si te va mal (el peor 5% de los casos), en promedio perderías:',
            },
        },
        oportunidad: {
            tecnico: {
                'fair-effect-label': 'Efecto / Beneficio:',
                'tef-header': 'Frecuencia de Evento de Oportunidad',
                'vuln-header': 'Probabilidad de Captura (%)',
                'chart-title': 'Distribución de Beneficio Anual',
                'ale-label': 'Beneficio Anual Esperado — Promedio Simulado:',
                'median-label': 'Beneficio Anual Mediano (Percentil 50):',
                'min-label': 'Beneficio Mínimo Simulado:',
                'max-label': 'Beneficio Máximo Simulado:',
                'p90-label': 'Beneficio en el mejor 10% de los casos (P90):',
                'cvar-label': 'Beneficio promedio del mejor 5% de los casos:',
            },
            simple: {
                'fair-effect-label': 'Qué se beneficiaría:',
                'tef-header': '¿Qué tan seguido se presentaría esta oportunidad?',
                'vuln-header': '¿Qué tan probable es aprovecharla, si se presenta?',
                'chart-title': 'Cuánto podrías ganar cada año (según 10,000 escenarios posibles)',
                'ale-label': 'En promedio, esto te podría beneficiar al año:',
                'median-label': 'En la mitad de los años, ganarías más de:',
                'min-label': 'En el peor caso, ganarías:',
                'max-label': 'En el mejor caso, ganarías:',
                'p90-label': '9 de cada 10 años, ganarías más que:',
                'cvar-label': 'Si te va muy bien (mejor 5% de los casos), en promedio ganarías:',
            },
        },
    },

    init() {
        this.load();
        document.getElementById('mode-toggle-btn').addEventListener('click', () => this.toggle());
        this.apply();
    },

    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) this.mode = raw;
        } catch (e) {
            console.error('No se pudo cargar la preferencia de Modo Simple/Técnico:', e);
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, this.mode);
        } catch (e) {
            console.error('No se pudo guardar la preferencia de Modo Simple/Técnico:', e);
        }
    },

    toggle() {
        this.mode = this.mode === 'simple' ? 'tecnico' : 'simple';
        this.save();
        this.apply();
        showToast(
            this.mode === 'simple'
                ? 'Modo Simple activado — mismo cálculo, lenguaje más sencillo.'
                : 'Modo Técnico activado.',
        );
    },

    apply() {
        document.body.classList.toggle('modo-simple', this.mode === 'simple');
        document.body.classList.toggle('modo-tecnico', this.mode === 'tecnico');
        const btn = document.getElementById('mode-toggle-btn');
        btn.innerHTML =
            this.mode === 'simple'
                ? '<i class="fas fa-toggle-off mr-2"></i>Modo Simple (clic para Técnico)'
                : '<i class="fas fa-toggle-on mr-2"></i>Modo Técnico (clic para Simple)';
        this.applyLabels();
    },

    applyLabels() {
        const isSimple = this.mode === 'simple';
        const stepSet = isSimple ? this.STEP_LABELS.simple : this.STEP_LABELS.tecnico;
        Object.entries(stepSet).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        });

        const riskType = (state.fair && state.fair.riskType) || 'amenaza';
        const resultSet = isSimple ? this.RESULT_LABELS[riskType].simple : this.RESULT_LABELS[riskType].tecnico;
        Object.entries(resultSet).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        });

        // Categorías de Magnitud de Pérdida (Paso 3): solo cambia el texto de sus
        // etiquetas, nunca se re-renderiza el formulario completo — así no se pierde lo
        // que el usuario ya haya escrito al cambiar de Modo Simple/Técnico.
        const lossTitles = isSimple ? LOSS_FORM_LABELS.simple : LOSS_FORM_LABELS.tecnico;
        const lossFields = isSimple ? LOSS_FIELD_LABELS.simple : LOSS_FIELD_LABELS.tecnico;
        LOSS_FORMS_KEYS.forEach((key) => {
            const titleEl = document.getElementById(`lm-title-${key}`);
            if (titleEl) titleEl.textContent = lossTitles[key];
            ['min', 'mode', 'max'].forEach((part) => {
                const labelEl = document.getElementById(`lm-${key}-${part}-label`);
                if (labelEl) labelEl.textContent = lossFields[part];
            });
        });

        this.applyProbThresholdLabel();

        // El Análisis de Sensibilidad (Paso 4) sí se re-renderiza completo al cambiar de
        // modo (a diferencia de Magnitud de Pérdida) porque es de solo lectura — no hay
        // ningún dato del usuario que perder, y así usa sensitivityLabel() de una.
        if (state.fair && state.fair.lastSensitivity && App.FairAnalysis && App.FairAnalysis.renderSensitivity) {
            App.FairAnalysis.renderSensitivity(state.fair.lastSensitivity);
        }
    },

    // Aparte de applyLabels() porque su texto lleva un valor calculado (el umbral en
    // dinero) que solo existe después de simular — ver dónde se llama en
    // App.FairWizard.displaySimulationResults().
    applyProbThresholdLabel() {
        const thresholdK = state.fair && state.fair.lastThresholdK;
        const el = document.getElementById('prob-threshold-label');
        if (!el || !thresholdK) return;
        el.textContent =
            this.mode === 'simple'
                ? `¿Qué tan seguido perderías más de ${thresholdK} en un año?`
                : `Prob. de superar ${thresholdK}/año:`;
    },
};

App.UIMode = UIMode;
