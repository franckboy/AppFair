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
            'fair-mitigar-transferir-title': '5. Mitigar + Transferir (combinado)',
            'fair-mitigar-transferir-desc':
                'Combina las dos estrategias de arriba en capas: primero se intenta mitigar, y lo que quede expuesto (funcione o no la mitigación) se decide aparte si conviene también transferir. Aparece solo cuando ya capturaste un costo real en Mitigar y una prima real en Transferir. La Pérdida Residual de acá es un promedio esperado entre los distintos caminos posibles del plan (no un número garantizado como en las 4 opciones de arriba).',
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
            'fair-mitigar-transferir-title': '5. Poner un control Y contratar un seguro (combinado)',
            'fair-mitigar-transferir-desc':
                'Combina las dos opciones de arriba en pasos: primero intentas el control, y lo que te quede expuesto (funcione o no el control) decides aparte si también lo cubres con el seguro. Aparece solo cuando ya escribiste cuánto cuesta el control Y cuánto pagarías por el seguro. Lo que "te quedaría expuesto" acá es un promedio entre los distintos caminos posibles del plan, no un número garantizado como en las 4 opciones de arriba.',
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

    // Etiquetas estáticas FUERA del wizard FAIR (Tratamiento, Gestión de Riesgos, Registro de
    // Riesgos, Árbol de Cascada) — mismo patrón que STEP_LABELS/RESULT_LABELS de arriba (un
    // diccionario id→texto que applyLabels() aplica con textContent), pero para ids que viven en
    // HTML estático de esas páginas (nunca se destruyen/reconstruyen), a diferencia de las tablas
    // y paneles armados por JS (esos usan shortMetricLabel() en utils.js, adentro de su propia
    // función de render, porque su HTML sí se reconstruye cada vez que cambia el riesgo elegido).
    STATIC_LABELS: {
        tecnico: {
            'quick-concentrated-th-cvar': 'CVaR 95%',
            'fair-register-sim-cvar-label': 'CVaR 95%:',
            'fair-roi-cvar-label': 'Pérdida Residual (CVaR95):',
            'fair-evitar-cvar-label': 'Pérdida Residual (CVaR95):',
            'fair-aceptar-cvar-label': 'Pérdida Residual (CVaR95):',
            'riskmgmt-portfolio-ale-label': 'ALE Residual:',
            'riskmgmt-portfolio-cvar-label': 'CVaR95 Residual:',
            'riskmgmt-residual-pareto-title': 'Concentración del Riesgo Residual (Pareto) — después del Tratamiento',
            'riskmgmt-residual-pareto-th-ale': 'ALE Residual',
            'riskmgmt-residual-ale-label': 'ALE:',
            'riskmgmt-residual-cvar-label': 'CVaR95:',
            'fair-register-pareto-title': 'Análisis 80-20 (Pareto) — sobre el Riesgo Actual',
            'fair-sensitivity-title': 'Análisis de Sensibilidad',
            'fair-sensitivity-desc':
                'Qué tanto influye cada variable en el resultado final (correlación con la pérdida simulada). Enfoca tu esfuerzo de mejorar datos en las variables de arriba — son las que más mueven el resultado.',
            'fair-inherente-label': 'Riesgo Inherente (sin ningún control):',
            'risk-tree-family-sim-cvar-label': 'CVaR 95%:',
            'fair-treat-ale-acronym': ' (ALE)',
            'risk-tree-page-desc':
                'Visualiza las relaciones entre riesgos. Cada riesgo conserva su propio cálculo ALE.',
            'fair-register-sim-p90-label': 'Peor 10% de los casos (P90):',
            'risk-tree-family-sim-p90-label': 'Peor 10% de los casos (P90):',
        },
        simple: {
            'quick-concentrated-th-cvar': 'Peor Caso (5%)',
            'fair-register-sim-cvar-label': 'Peor Caso Típico (5%):',
            'fair-roi-cvar-label': 'Pérdida Residual en un Mal Año:',
            'fair-evitar-cvar-label': 'Pérdida Residual en un Mal Año:',
            'fair-aceptar-cvar-label': 'Pérdida Residual en un Mal Año:',
            'riskmgmt-portfolio-ale-label': 'Pérdida Promedio Residual:',
            'riskmgmt-portfolio-cvar-label': 'Peor Caso Típico Residual:',
            'riskmgmt-residual-pareto-title': 'Los Riesgos Que Más Pesan Después de Tratarlos',
            'riskmgmt-residual-pareto-th-ale': 'Pérdida Promedio Residual',
            'riskmgmt-residual-ale-label': 'Pérdida Promedio:',
            'riskmgmt-residual-cvar-label': 'Peor Caso Típico:',
            'fair-register-pareto-title': 'Los Riesgos Que Más Pesan Hoy (antes de tratarlos)',
            'fair-sensitivity-title': '¿Qué Es lo Que Más Cambia Tu Resultado?',
            'fair-sensitivity-desc':
                'Mejora primero la información de estos factores — son los que más mueven tu estimado.',
            'fair-inherente-label': 'Si no hicieras NADA para protegerte, esto te costaría al año:',
            'risk-tree-family-sim-cvar-label': 'Peor Caso Típico (5%):',
            'fair-treat-ale-acronym': '',
            'risk-tree-page-desc':
                'Visualiza cómo un riesgo puede desencadenar a otro. Cada riesgo conserva su propio estimado de pérdida.',
            'fair-register-sim-p90-label': 'De cada 10 años, en el peor:',
            'risk-tree-family-sim-p90-label': 'De cada 10 años, en el peor:',
        },
    },

    // Tooltips (atributo title=, no textContent) con jerga técnica cruda — hueco real que el
    // "test de jerga" (simple-mode-no-jargon.spec.js) no puede detectar porque lee innerText,
    // que nunca incluye el contenido de atributos title. Mismo patrón que STATIC_LABELS de
    // arriba (diccionario id→texto, tecnico/simple), pero aplicado con el.title en vez de
    // el.textContent — ver applyLabels().
    STATIC_TITLES: {
        tecnico: {
            'fair-mitigar-defensa-objetivo-info':
                'A qué nivel de defensa subirías con este control. La Reducción de ALE se calcula sola comparando tu nivel actual contra este objetivo.',
            'riskmgmt-portfolio-info':
                'Suma del ALE/CVaR95 VIGENTE de cada Amenaza del Registro: el residual de su decisión de Tratamiento si ya se adoptó una estrategia, o el ACTUAL (con el Nivel de Defensa vigente) si todavía no. También muestra el waterfall completo — Riesgo Inherente (sin ningún control) → Actual → Residual — y la Efectividad de Controles en dólares reales. El CVaR95 total es una cota conservadora (nunca subestima) — sumar los CVaR95 de riesgos independientes no es matemáticamente exacto.',
            'riskmgmt-residual-pareto-info':
                'A diferencia del Pareto de Registro de Riesgos (sobre el ALE ACTUAL, antes de decidir nada), este ordena por el ALE RESIDUAL vigente de cada Amenaza — útil para notar una estrategia ya adoptada que resultó insuficiente, o qué riesgo sin tratar es ahora el más urgente.',
        },
        simple: {
            'fair-mitigar-defensa-objetivo-info':
                'A qué nivel de defensa subirías con este control. La reducción de tu pérdida promedio se calcula sola comparando tu nivel actual contra este objetivo.',
            'riskmgmt-portfolio-info':
                'Suma de la pérdida VIGENTE de cada Amenaza del Registro: el resultado de su decisión de Tratamiento si ya se adoptó una estrategia, o el actual (con el Nivel de Defensa vigente) si todavía no. También muestra el camino completo — si no hicieras nada → actual → con tratamiento — y cuánto ayudan tus controles en dólares reales. El peor caso total es una cifra conservadora (nunca subestima) — sumar el peor caso de riesgos independientes no es matemáticamente exacto.',
            'riskmgmt-residual-pareto-info':
                'A diferencia de la vista de Registro de Riesgos (que ordena por la pérdida ACTUAL, antes de decidir nada), esto ordena por la pérdida VIGENTE de cada Amenaza (después de tratamiento, si ya se decidió uno) — útil para notar una estrategia ya adoptada que resultó insuficiente, o qué riesgo sin tratar es ahora el más urgente.',
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

        // Etiquetas estáticas fuera del wizard (Tratamiento/Gestión de Riesgos/Registro/Cascada)
        // — se aplican SIEMPRE (no dependen de qué página esté visible ahora mismo), igual que
        // las de arriba: si el id no existe en el DOM en este momento, simplemente no pasa nada.
        const staticSet = isSimple ? this.STATIC_LABELS.simple : this.STATIC_LABELS.tecnico;
        Object.entries(staticSet).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        });

        const staticTitleSet = isSimple ? this.STATIC_TITLES.simple : this.STATIC_TITLES.tecnico;
        Object.entries(staticTitleSet).forEach(([id, text]) => {
            const el = document.getElementById(id);
            if (el) el.title = text;
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
