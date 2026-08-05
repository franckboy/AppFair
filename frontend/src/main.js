// --- MAIN APPLICATION LOGIC ---
import { App } from './modules/app-namespace.js';
import { state } from './modules/state.js';
import { Modal } from './modules/modal.js';
// Imports por efecto secundario: cada uno se auto-registra en App.X al importarse (ver
// app-namespace.js) — el resto del código en este archivo sigue llamando App.X.metodo()
// exactamente igual que antes de que X se moviera a su propio archivo.
import './modules/api.js';
import './modules/navigation.js';
import './modules/criteria.js';
import './modules/autocomplete.js';
import './modules/risk-catalog.js';
import './modules/asset-catalog.js';
import {
    LOSS_FORMS_KEYS, LOSS_FORM_LABELS, LOSS_FIELD_LABELS, SENSITIVITY_LABELS_SIMPLE,
    sensitivityLabel, sanitizeHTML, getSafeNumber, debounce, updateProgressBar,
    toggleErrorState, showToast, severityToClasses, severityToHex,
} from './modules/utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Main Application Manager ---
    Object.assign(App, {
        async init() {
            this.Api.initConnectionUI();
            const booted = await this.Api.bootstrap();
            if (!booted) return; // Api.bootstrap ya mostró la pantalla de error (boot-gate)

            if (!this.OrgContext.isComplete()) {
                // RIMS RA.1-2015 (5.2): entender la organización es un paso previo obligatorio,
                // no una configuración opcional más — bloquea el resto de la inicialización
                // hasta que se complete una vez (ver #orgcontext-gate).
                this.OrgContext.showGate(() => this.continueInit());
                return;
            }
            this.continueInit();
        },

        continueInit() {
            this.UIMode.init();
            this.Criteria.init();
            this.OrgDefaults.init();
            this.ConfigMenu.init();
            this.Autocomplete.init();
            this.Navigation.init();
            this.QuickAnalysis.init();
            this.RiskCatalog.init();
            this.AssetCatalog.init();
            this.FairAnalysis.init();
            // Página de entrada por defecto — necesario porque OrgContext.showGate() oculta
            // #fairAnalysisPage mientras el gate está abierto (ver App.OrgContext.showGate) y
            // nada más la vuelve a mostrar; sin esto la app queda en blanco hasta que el
            // usuario haga clic en un botón del nav.
            this.Navigation.switchPage('fair');
            this.UIMode.applyLabels(); // vuelve a aplicar por si algún módulo restauró estado que afecta las etiquetas
        }
    });

    // --- Modo Simple / Modo Técnico ---
    // Cambia SOLO el lenguaje que ve el usuario — nunca el cálculo. Los mismos campos, las
    // mismas fórmulas, el mismo Monte Carlo; lo único que cambia es cómo se nombran las cosas
    // y qué secciones avanzadas se muestran (ver la clase CSS .advanced-only).
    App.UIMode = {
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
                'fair-aceptar-description': 'ISO 31000 exige que aceptar un riesgo sea una decisión documentada y deliberada, no la ausencia de una decisión. Escribe la justificación.',
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
                'fair-aceptar-description': 'Si decides no hacer nada, igual tienes que dejarlo por escrito y explicar por qué — no es lo mismo decidir aceptar el riesgo que simplemente no decidir nada.',
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
            showToast(this.mode === 'simple' ? 'Modo Simple activado — mismo cálculo, lenguaje más sencillo.' : 'Modo Técnico activado.');
        },

        apply() {
            document.body.classList.toggle('modo-simple', this.mode === 'simple');
            document.body.classList.toggle('modo-tecnico', this.mode === 'tecnico');
            const btn = document.getElementById('mode-toggle-btn');
            btn.innerHTML = this.mode === 'simple'
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
            LOSS_FORMS_KEYS.forEach(key => {
                const titleEl = document.getElementById(`lm-title-${key}`);
                if (titleEl) titleEl.textContent = lossTitles[key];
                ['min', 'mode', 'max'].forEach(part => {
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
            el.textContent = this.mode === 'simple'
                ? `¿Qué tan seguido perderías más de ${thresholdK} en un año?`
                : `Prob. de superar ${thresholdK}/año:`;
        }
    };

    // --- Menú "Configuración" ---
    // Agrupa Contexto Organizacional, Criterios de Riesgo, Valores por Defecto y Catálogo de
    // Activos — las 4 pantallas que se configuran una vez y rara vez se vuelven a tocar, para no
    // competir visualmente en el nav con las páginas de trabajo diario. Contexto Organizacional
    // SÍ vive aquí (a diferencia de un diseño anterior de esta misma sesión, que le daba su
    // propio botón permanente en el nav) — el gate obligatorio de primer uso (#orgcontext-gate,
    // ver App.OrgContext) no depende de ningún botón, así que separarlo del resto de
    // "Configuración" solo agregaba un botón permanente para algo que, pasada la primera vez,
    // casi nunca se vuelve a abrir.
    App.ConfigMenu = {
        init() {
            document.getElementById('nav-config').addEventListener('click', () => this.open());
        },
        open() {
            Modal.menu('Configuración', [
                { label: 'Contexto Organizacional', icon: 'fa-building', onClick: () => App.OrgContext.openEditor() },
                { label: 'Criterios de Riesgo', icon: 'fa-sliders-h', onClick: () => App.Criteria.openEditor() },
                { label: 'Valores por Defecto', icon: 'fa-user-cog', onClick: () => App.OrgDefaults.openEditor() },
                {
                    label: 'Catálogo de Activos', icon: 'fa-boxes', onClick: () => {
                        App.Navigation.switchPage('assets');
                        App.AssetCatalog.load();
                    },
                },
            ]);
        }
    };

    // --- Valores por Defecto de la Organización ---
    // Datos que casi no cambian entre un análisis y otro (nivel de defensa típico, dueño del
    // riesgo, criterio de calidad de datos). Se capturan una sola vez aquí y se
    // auto-rellenan en cada análisis nuevo, en vez de tener que volver a escribirlos.
    App.OrgDefaults = {
        // Valores de fábrica mientras App.Api.bootstrap() no haya traído los reales del backend.
        defaults: {
            defenseKey: 'estandar',
            owner: '',
            dataSource: 'experto-sin-calibrar',
            dataConfidence: 'medio',
        },

        init() {},

        async save(newDefaults) {
            this.defaults = await App.Api.request('/api/config/org-defaults', { method: 'PUT', body: newDefaults });
        },

        openEditor() {
            const d = this.defaults;
            const defenseOptions = Object.entries(state.quick.defenseProfiles)
                .map(([key, p]) => `<option value="${key}" ${key === d.defenseKey ? 'selected' : ''}>${p.name}</option>`).join('');

            const formHTML = `
                <p class="description-text mb-4">
                    Estos valores se auto-rellenan cada vez que empiezas un análisis nuevo, para que no tengas que
                    volver a escribirlos ni seleccionarlos cada vez. Se guardan en este navegador.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="input-group">
                        <label for="orgdef-defense">Nivel de Defensa Típico:</label>
                        <select id="orgdef-defense" class="form-select">${defenseOptions}</select>
                    </div>
                    <div class="input-group">
                        <label for="orgdef-owner">Dueño del Riesgo por Defecto:</label>
                        <input type="text" id="orgdef-owner" class="form-input" placeholder="Ej. Gerente de Seguridad Patrimonial">
                    </div>
                    <div class="input-group">
                        <label for="orgdef-confidence">Nivel de Confianza por Defecto:</label>
                        <select id="orgdef-confidence" class="form-select">
                            <option value="alto" ${d.dataConfidence === 'alto' ? 'selected' : ''}>Alto</option>
                            <option value="medio" ${d.dataConfidence === 'medio' ? 'selected' : ''}>Medio</option>
                            <option value="bajo" ${d.dataConfidence === 'bajo' ? 'selected' : ''}>Bajo</option>
                        </select>
                    </div>
                    <div class="input-group md:col-span-2">
                        <label for="orgdef-source">Fuente de Datos por Defecto:</label>
                        <select id="orgdef-source" class="form-select">
                            <option value="historico" ${d.dataSource === 'historico' ? 'selected' : ''}>Histórico interno de incidentes</option>
                            <option value="benchmark" ${d.dataSource === 'benchmark' ? 'selected' : ''}>Benchmark / referencia externa del sector</option>
                            <option value="experto-calibrado" ${d.dataSource === 'experto-calibrado' ? 'selected' : ''}>Juicio experto calibrado</option>
                            <option value="experto-sin-calibrar" ${d.dataSource === 'experto-sin-calibrar' ? 'selected' : ''}>Juicio experto sin calibrar</option>
                        </select>
                    </div>
                </div>
            `;
            Modal.title.textContent = 'Valores por Defecto';
            Modal.body.innerHTML = formHTML;
            Modal.footer.innerHTML = `
                <button id="orgdef-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="orgdef-save-btn" class="btn btn-primary">Guardar</button>
            `;
            Modal.modal.classList.remove('hidden');
            // Se asigna vía .value (no interpolado en el HTML) para que el texto del usuario
            // nunca pueda romper el atributo value="..." — sanitizeHTML() no escapa comillas,
            // solo protege contra inyección de etiquetas, así que no basta para este contexto.
            document.getElementById('orgdef-owner').value = d.owner;

            document.getElementById('orgdef-cancel-btn').addEventListener('click', () => Modal.hide());
            document.getElementById('orgdef-save-btn').addEventListener('click', async (e) => {
                const saveBtn = e.target;
                saveBtn.disabled = true;
                try {
                    await this.save({
                        defenseKey: document.getElementById('orgdef-defense').value,
                        owner: document.getElementById('orgdef-owner').value,
                        dataConfidence: document.getElementById('orgdef-confidence').value,
                        dataSource: document.getElementById('orgdef-source').value,
                    });
                    Modal.hide();
                    showToast('Valores por defecto actualizados. Se aplicarán en tu próximo análisis nuevo.');
                } catch (err) {
                    showToast(err.userMessage || 'No se pudo guardar. Intenta de nuevo.');
                } finally {
                    saveBtn.disabled = false;
                }
            });
        }
    };

    // --- Contexto Organizacional (RIMS RA.1-2015, cláusula 5.2 "Entender la organización y sus
    // objetivos") --- Captura una sola vez el contexto de la organización apreciada, para que
    // cada análisis de riesgo se interprete dentro de su misión, apetito de riesgo y partes
    // interesadas, en vez de evaluarse en el vacío.
    App.OrgContext = {
        // Valores de fábrica mientras App.Api.bootstrap() no haya traído los reales del backend.
        context: {
            mision: '',
            naturalezaNegocio: '',
            apetitoRiesgo: 'moderado',
            partesInteresadas: '',
            entornoLegal: '',
            alcanceCadenaSuministro: '',
        },

        async save(newContext) {
            this.context = await App.Api.request('/api/config/org-context', { method: 'PUT', body: newContext });
        },

        // Se considera "completado" si al menos misión o naturaleza del negocio tienen algo
        // escrito — no exige los 6 campos, solo que el usuario haya realmente participado en
        // vez de dejarlo todo en blanco. Usado por el gate obligatorio de primer uso (ver
        // showGate) para decidir si hay que bloquear el resto de la app o no.
        isComplete() {
            const c = this.context;
            return !!(c.mision && c.mision.trim()) || !!(c.naturalezaNegocio && c.naturalezaNegocio.trim());
        },

        // Parametrizado por prefijo de id porque este mismo formulario se usa en dos lugares a
        // la vez potencialmente presentes en el DOM (el modal de edición y el gate de primer
        // uso) — ids duplicados romperían getElementById en el que no sea el primero en el DOM.
        buildFormHTML(prefix) {
            const c = this.context;
            return `
                <div class="input-group">
                    <label for="${prefix}-mision">Misión y Objetivos Estratégicos:</label>
                    <textarea id="${prefix}-mision" class="form-textarea" rows="2">${sanitizeHTML(c.mision)}</textarea>
                </div>
                <div class="input-group">
                    <label for="${prefix}-naturaleza">Naturaleza del Negocio / Actividad:</label>
                    <textarea id="${prefix}-naturaleza" class="form-textarea" rows="2">${sanitizeHTML(c.naturalezaNegocio)}</textarea>
                </div>
                <div class="input-group">
                    <label for="${prefix}-apetito">Apetito por el Riesgo Declarado:</label>
                    <select id="${prefix}-apetito" class="form-select">
                        <option value="conservador" ${c.apetitoRiesgo === 'conservador' ? 'selected' : ''}>Conservador (evitar riesgo activamente)</option>
                        <option value="moderado" ${c.apetitoRiesgo === 'moderado' ? 'selected' : ''}>Moderado (aceptar riesgo calculado por beneficio)</option>
                        <option value="agresivo" ${c.apetitoRiesgo === 'agresivo' ? 'selected' : ''}>Agresivo (buscar oportunidad aun con riesgo alto)</option>
                    </select>
                </div>
                <div class="input-group">
                    <label for="${prefix}-partes">Partes Interesadas Clave:</label>
                    <textarea id="${prefix}-partes" class="form-textarea" rows="2" placeholder="Ej. Clientes BASC/CTPAT, accionistas, personal operativo, autoridades locales">${sanitizeHTML(c.partesInteresadas)}</textarea>
                </div>
                <div class="input-group">
                    <label for="${prefix}-legal">Entorno Legal y Regulatorio Relevante:</label>
                    <textarea id="${prefix}-legal" class="form-textarea" rows="2" placeholder="Ej. Certificación BASC, CTPAT, normativa local de seguridad privada">${sanitizeHTML(c.entornoLegal)}</textarea>
                </div>
                <div class="input-group">
                    <label for="${prefix}-cadena">
                        Alcance de la Cadena de Suministro Cubierta
                        <i class="fas fa-info-circle text-blue-500 cursor-pointer ml-1" title="ISO 28001: define qué tramo de la cadena de suministro internacional cubre tu sistema de seguridad — ej. desde la planta hasta el puerto de embarque, o desde el proveedor hasta el almacén."></i>
                    </label>
                    <textarea id="${prefix}-cadena" class="form-textarea" rows="2" placeholder="Ej. Desde la recepción de materia prima en planta hasta la entrega en el puerto de embarque de Manzanillo">${sanitizeHTML(c.alcanceCadenaSuministro)}</textarea>
                </div>
            `;
        },

        readFormValues(prefix) {
            return {
                mision: document.getElementById(`${prefix}-mision`).value,
                naturalezaNegocio: document.getElementById(`${prefix}-naturaleza`).value,
                apetitoRiesgo: document.getElementById(`${prefix}-apetito`).value,
                partesInteresadas: document.getElementById(`${prefix}-partes`).value,
                entornoLegal: document.getElementById(`${prefix}-legal`).value,
                alcanceCadenaSuministro: document.getElementById(`${prefix}-cadena`).value,
            };
        },

        openEditor() {
            Modal.title.textContent = 'Contexto Organizacional';
            Modal.body.innerHTML = `
                <p class="description-text mb-4">
                    RIMS RA.1-2015 (5.2) pide entender la organización antes de apreciar sus riesgos.
                    Esto se captura una sola vez y aparece como referencia en cada reporte de riesgo.
                </p>
                ${this.buildFormHTML('orgctx')}
            `;
            Modal.footer.innerHTML = `
                <button id="orgctx-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="orgctx-save-btn" class="btn btn-primary">Guardar</button>
            `;
            Modal.modal.classList.remove('hidden');

            document.getElementById('orgctx-cancel-btn').addEventListener('click', () => Modal.hide());
            document.getElementById('orgctx-save-btn').addEventListener('click', async (e) => {
                const saveBtn = e.target;
                saveBtn.disabled = true;
                try {
                    await this.save(this.readFormValues('orgctx'));
                    Modal.hide();
                    showToast('Contexto Organizacional actualizado.');
                } catch (err) {
                    showToast(err.userMessage || 'No se pudo guardar. Intenta de nuevo.');
                } finally {
                    saveBtn.disabled = false;
                }
            });
        },

        // Gate obligatorio de primer uso — ver #orgcontext-gate en el HTML y el comentario ahí.
        // onComplete() se llama justo después de guardar exitosamente, para que App.init()
        // pueda continuar el resto de la inicialización que quedó pausada.
        showGate(onComplete) {
            document.querySelectorAll('.nav-requires-boot').forEach(btn => btn.disabled = true);
            document.querySelectorAll('#fairAnalysisPage, #registerPage, #assetsPage').forEach(el => el.classList.add('hidden'));
            document.getElementById('orgcontext-gate-form').innerHTML = this.buildFormHTML('orgctx-gate');
            document.getElementById('orgcontext-gate').classList.remove('hidden');

            const saveBtn = document.getElementById('orgctx-gate-save-btn');
            const saveHandler = async () => {
                saveBtn.disabled = true;
                try {
                    await this.save(this.readFormValues('orgctx-gate'));
                    document.getElementById('orgcontext-gate').classList.add('hidden');
                    document.querySelectorAll('.nav-requires-boot').forEach(btn => btn.disabled = false);
                    saveBtn.removeEventListener('click', saveHandler);
                    showToast('Contexto Organizacional guardado.');
                    onComplete();
                } catch (err) {
                    showToast(err.userMessage || 'No se pudo guardar. Intenta de nuevo.');
                } finally {
                    saveBtn.disabled = false;
                }
            };
            saveBtn.addEventListener('click', saveHandler);
        }
    };

    // --- Historial de riesgos (/api/risks) ---
    // La "Vista Rápida" (estimado instantáneo de un solo punto: ARO/Vulnerabilidad/Impacto →
    // Riesgo Inherente/Residual/ALE, con su propio Mapa de Riesgo) se eliminó por completo —
    // duplicaba, con menos rigor, lo que FAIR ya calcula: el mismo descuento "capacidad del
    // atacante menos tu defensa" que da Vulnerabilidad en FAIR (ver
    // backend/src/lib/autocalc.js:calculateVulnerability), y un desglose de Magnitud de Pérdida
    // en 9 categorías (Paso 3 de FAIR) en vez de un solo Costo Mín/Máx sin categorizar. Este
    // módulo solo conserva lo que sigue siendo necesario: la lista de riesgos que ya existen en
    // /api/risks (creados antes de este cambio, o vía la API directamente) — para que sigan
    // siendo visibles en la tabla concentrada y se puedan cargar en FAIR, en vez de quedar
    // huérfanos o inaccesibles.
    App.QuickAnalysis = {
        init() {
            this.loadHistory();
        },

        async loadHistory() {
            try {
                const res = await App.Api.request('/api/risks');
                state.quick.history = res.risks;
            } catch (e) {
                showToast(e.userMessage || 'No se pudo cargar el historial de riesgos.');
            }
            // La tabla en sí vive en App.FairRegister (ver #quick-concentrated-table-body),
            // para que Análisis de Riesgo y Registro de Riesgos siempre muestren exactamente lo
            // mismo en vez de dos versiones distintas de la misma información.
            await App.FairRegister.loadRiskRegister();
        },
    };

    // --- FAIR Analysis Module ---
    // ============================================================
    // App.FairWizard — el formulario de 4 pasos (Perfil de Atacante/Defensa,
    // TEF/Vulnerabilidad, Magnitud de Pérdida, Simulación + Tratamiento), sus
    // autocálculos, validaciones y el borrador persistido en localStorage. Si el
    // bug está en algo que el usuario llena/ve mientras arma un análisis FAIR,
    // está aquí.
    // ============================================================
    App.FairWizard = {
        applyOrgDefaults() {
            document.getElementById('fair-defense-profile').value = App.OrgDefaults.defaults.defenseKey;
            document.getElementById('fair-owner').value = App.OrgDefaults.defaults.owner;
            document.getElementById('fair-data-source').value = App.OrgDefaults.defaults.dataSource;
            document.getElementById('fair-data-confidence').value = App.OrgDefaults.defaults.dataConfidence;
            this.updateAttackerDefenseSummary();
        },

        duplicateFromTemplate() {
            let data;
            try {
                const raw = localStorage.getItem('fairAnalysisTemplate');
                if (!raw) {
                    Modal.alert('Aún no tienes ningún análisis FAIR completado (con simulación corrida) para usar como plantilla.', 'Sin plantilla disponible');
                    return;
                }
                data = JSON.parse(raw);
            } catch (e) {
                console.error('No se pudo leer la plantilla guardada:', e);
                return;
            }

            this.resetForm(false);

            document.getElementById('fair-effect').value = data.effect || 'material';
            document.getElementById('fair-risk-type').value = data.riskType || 'amenaza';
            document.getElementById('fair-time-horizon').value = data.timeHorizon || '1';
            this.toggleRiskTypeLabels();
            document.getElementById('fair-owner').value = data.owner || App.OrgDefaults.defaults.owner;
            document.getElementById('fair-data-source').value = data.dataSource || App.OrgDefaults.defaults.dataSource;
            document.getElementById('fair-data-confidence').value = data.dataConfidence || App.OrgDefaults.defaults.dataConfidence;
            if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
            if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
            document.getElementById('fair-deliberate-threat').checked = !!data.isDeliberate;
            document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !data.isDeliberate);
            if (data.deliberateThreatPonderation) {
                document.getElementById('fair-deliberate-ponderation').value = data.deliberateThreatPonderation;
                document.getElementById('fair-deliberate-ponderation-value').textContent = `x${parseFloat(data.deliberateThreatPonderation).toFixed(2)}`;
            }
            this.updateAttackerDefenseSummary();

            if (data.tef) {
                document.getElementById('tef-min').value = data.tef.min;
                document.getElementById('tef-mode').value = data.tef.mode;
                document.getElementById('tef-max').value = data.tef.max;
                // Ya es un dato real restaurado — que la sugerencia automática (todavía en
                // vuelo desde el updateAttackerDefenseSummary() de arriba) no lo pise.
                state.fair.tefManuallyEdited = true;
            }
            if (data.vuln) {
                document.getElementById('vuln-min').value = data.vuln.min;
                document.getElementById('vuln-mode').value = data.vuln.mode;
                document.getElementById('vuln-max').value = data.vuln.max;
                this.setVulnManualOverride(!!data.vulnManualOverride);
            }
            if (data.lossForms) {
                this.setLossMagnitudeManualOverride(!!data.lmManualOverride, true);
                Object.entries(data.lossForms).forEach(([key, vals]) => {
                    const minEl = document.getElementById(`lm-${key}-min`);
                    const modeEl = document.getElementById(`lm-${key}-mode`);
                    const maxEl = document.getElementById(`lm-${key}-max`);
                    if (minEl) minEl.value = vals.min;
                    if (modeEl) modeEl.value = vals.mode;
                    if (maxEl) maxEl.value = vals.max;
                    this.refreshLossMagnitudeCompactDisplay(key);
                });
            }

            this.navigateWizard(1, true);
            showToast('Plantilla aplicada. Revisa el Nombre del Escenario, Activo y Agente de Amenaza — son lo único que casi siempre cambia entre un riesgo y otro.');
        },

        // Guarda lo que ya se llenó en el Paso 1 en /api/risks, SIN pasar por TEF/Vulnerabilidad/
        // Magnitud/Simulación — permite dejar un riesgo anotado y volver después a completarlo,
        // en vez de obligar a terminar los 4 pasos en una sola sesión (antes esto lo cubría
        // Vista Rápida, ya eliminada). Aparece en "Riesgos Guardados" como "Triage" hasta que se
        // corre la simulación (ver App.FairRegister.buildConcentratedList).
        async saveDraftToRisksList() {
            const riskName = document.getElementById('fair-riskName').value.trim();
            if (!riskName) {
                toggleErrorState('fair-riskName', 'El nombre del escenario es obligatorio.');
                return;
            }

            const fullData = {
                riskName,
                riskDescription: document.getElementById('fair-riskDescription').value.trim(),
                asset: document.getElementById('fair-asset').value.trim(),
                threat: document.getElementById('fair-threat').value.trim(),
                effect: document.getElementById('fair-effect').value,
                riskType: document.getElementById('fair-risk-type').value,
                timeHorizon: document.getElementById('fair-time-horizon').value,
                triggeredByRiskName: document.getElementById('fair-triggered-by').value || null,
            };

            const btn = document.getElementById('fair-save-draft-btn');
            btn.disabled = true;
            try {
                if (state.fair.sourceRiskId) {
                    // Ya se había guardado antes en esta misma sesión de edición — actualiza esa
                    // misma entrada en vez de crear una fila duplicada en la tabla.
                    await App.Api.request(`/api/risks/${encodeURIComponent(state.fair.sourceRiskId)}`, {
                        method: 'PUT',
                        body: { name: riskName, fullData },
                    });
                } else {
                    const res = await App.Api.request('/api/risks', {
                        method: 'POST',
                        body: { name: riskName, fullData },
                    });
                    state.fair.sourceRiskId = res.entry.id;
                }
                await App.FairRegister.loadRiskRegister();
                showToast('Riesgo guardado. Puedes completarlo cuando quieras desde "Riesgos Guardados".');
            } catch (e) {
                showToast(e.userMessage || 'No se pudo guardar el riesgo.');
            } finally {
                btn.disabled = false;
            }
        },

        bindEvents() {
            document.getElementById('fair-step1-next').addEventListener('click', () => this.navigateWizard(2));
            document.getElementById('fair-save-draft-btn').addEventListener('click', () => this.saveDraftToRisksList());
            document.getElementById('fair-step2-back').addEventListener('click', () => this.navigateWizard(1));
            document.getElementById('fair-step2-next').addEventListener('click', () => this.navigateWizard(3));
            document.getElementById('fair-step3-back').addEventListener('click', () => this.navigateWizard(2));
            document.getElementById('fair-step3-next').addEventListener('click', () => this.navigateWizard(4));
            document.getElementById('fair-step4-back').addEventListener('click', () => this.navigateWizard(3));
            document.getElementById('run-simulation-btn').addEventListener('click', () => this.runMonteCarloSimulation());
            document.getElementById('fair-reset-btn').addEventListener('click', () => this.resetForm());
            document.getElementById('fair-duplicate-btn').addEventListener('click', () => this.duplicateFromTemplate());
            document.getElementById('fair-resume-banner-btn').addEventListener('click', () => this.restoreFairAnalysis());
            document.getElementById('fair-resume-banner-dismiss-btn').addEventListener('click', () => {
                document.getElementById('fair-resume-banner').classList.add('hidden');
            });
            const debouncedUpdateTreatmentView = debounce(() => this.updateTreatmentView(), 400);
            ['fair-costoControlAnual', 'fair-reduccionALE', 'fair-mitigar-fiabilidad', 'fair-mitigar-retraso', 'fair-seguro-prima', 'fair-seguro-deducible', 'fair-seguro-limite', 'fair-seguro-fiabilidad', 'fair-seguro-retraso', 'fair-evitar-costo', 'fair-evitar-fiabilidad', 'fair-evitar-retraso'].forEach(id => {
                document.getElementById(id).addEventListener('input', debouncedUpdateTreatmentView);
            });
            document.getElementById('fair-seguro-sin-limite').addEventListener('change', (e) => {
                const limiteInput = document.getElementById('fair-seguro-limite');
                limiteInput.disabled = e.target.checked;
                limiteInput.classList.toggle('bg-gray-100', e.target.checked);
                this.updateTreatmentView();
            });
            document.getElementById('fair-aceptar-justificacion').addEventListener('input', () => this.persistFairAnalysis());
            document.getElementById('fair-attacker-profile').addEventListener('change', () => this._trackPendingAutocalc(this.updateAttackerDefenseSummary()));
            document.getElementById('fair-defense-profile').addEventListener('change', () => this._trackPendingAutocalc(this.updateAttackerDefenseSummary()));
            document.getElementById('fair-data-confidence').addEventListener('change', () => {
                this._trackPendingAutocalc(Promise.all([this.updateVulnerabilityAuto(), this.updateAllLossMagnitudeAuto()]));
            });
            document.getElementById('lm-manual-override').addEventListener('change', (e) => {
                this.setLossMagnitudeManualOverride(e.target.checked);
                showToast(e.target.checked ? 'Ahora puedes editar Mín/Máx manualmente en todas las categorías.' : 'Mín/Máx calculados automáticamente de nuevo.');
            });
            document.getElementById('fair-mitigar-defensa-objetivo').addEventListener('change', () => this.updateReduccionALEAuto());
            document.getElementById('fair-reduccionALE-manual-override').addEventListener('change', (e) => {
                const manual = e.target.checked;
                document.getElementById('fair-reduccionALE').readOnly = !manual;
                document.getElementById('fair-reduccionALE').classList.toggle('bg-gray-100', !manual);
                document.getElementById('fair-reduccionALE-explanation').classList.toggle('hidden', manual);
                if (manual) {
                    showToast('Ahora puedes escribir la Reducción de ALE manualmente.');
                } else {
                    this.updateReduccionALEAuto();
                    showToast('Reducción de ALE calculada automáticamente de nuevo.');
                }
                this.updateTreatmentView();
            });
            document.getElementById('vuln-manual-override').addEventListener('change', (e) => {
                const manual = e.target.checked;
                this.setVulnManualOverride(manual);
                if (manual) {
                    showToast('Ahora puedes editar la Vulnerabilidad manualmente.');
                } else {
                    this._trackPendingAutocalc(this.updateVulnerabilityAuto());
                    showToast('Vulnerabilidad calculada automáticamente de nuevo.');
                }
            });
            document.getElementById('fair-deliberate-threat').addEventListener('change', () => {
                this.toggleDeliberateThreatFair();
                this.suggestTefRange();
            });
            document.getElementById('fair-risk-type').addEventListener('change', () => this.toggleRiskTypeLabels());
            document.getElementById('fair-deliberate-ponderation').addEventListener('change', () => this.suggestTefRange());
            document.getElementById('fair-deliberate-ponderation').addEventListener('input', (e) => {
                document.getElementById('fair-deliberate-ponderation-value').textContent = `x${parseFloat(e.target.value).toFixed(2)}`;
            });
            // Si el usuario escribe directamente en TEF, dejamos de pisarlo con la sugerencia
            // automática — la sugerencia es solo un punto de partida, no debe robarle el control
            // a alguien que ya puso su propio dato. .value=... por JS no dispara 'input', así que
            // este listener solo detecta tecleo real del usuario, nunca nuestras propias sugerencias.
            ['tef-min', 'tef-mode', 'tef-max'].forEach(id => {
                document.getElementById(id).addEventListener('input', () => { state.fair.tefManuallyEdited = true; });
            });
            document.getElementById('fair-export-consolidated-btn').addEventListener('click', () => App.FairExport.exportConsolidatedReport());
            document.getElementById('selectAllHistory').addEventListener('change', (e) => App.FairRegister.toggleSelectAll('quick-concentrated-table-body', e.target.checked));
            document.getElementById('fair-deep-analysis-btn').addEventListener('click', () => App.FairRegister.showDeepAnalysis('quick-concentrated-table-body'));
            document.getElementById('fair-deep-analysis-close').addEventListener('click', () => {
                document.getElementById('fair-deep-analysis-panel').classList.add('hidden');
            });
            document.getElementById('fair-register-simulation-close').addEventListener('click', () => {
                document.getElementById('fair-register-simulation').classList.add('hidden');
            });
            // Escopado a Paso 2 (TEF/Vulnerabilidad) a propósito: los campos de Magnitud de
            // Pérdida (Paso 3) ya tienen su propio listener en populateLossMagnitudeForms(),
            // que además espera (await) la respuesta del backend antes de reordenar — si este
            // selector también los agarrara, quedarían con DOS listeners en el mismo 'change' y
            // el segundo (síncrono) reordenaría con min/max viejos antes de que el primero
            // terminara, pisando el valor "Más Probable" que el usuario acaba de escribir.
            document.querySelectorAll('#fair-step-2 .fair-range-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const parentSection = e.target.closest('.fair-section');
                    const prefix = parentSection.querySelector('[data-min="true"]').id.replace('-min', '');
                    this.validateAndFixRange(prefix);
                });
            });
        },

        // Estos 4 factores (Resumen Atacante/Defensa, Vulnerabilidad, Reducción de ALE,
        // Magnitud de Pérdida) los calcula el backend (/api/autocalc/*) — antes se calculaban
        // aquí con una copia local de calculateProfileAverage/getConfidenceSpread.
        async updateAttackerDefenseSummary() {
            const attackerKey = document.getElementById('fair-attacker-profile').value;
            const defenseKey = document.getElementById('fair-defense-profile').value;
            const summaryEl = document.getElementById('fair-attacker-defense-summary');
            summaryEl.innerHTML = '<p class="text-gray-500">Calculando…</p>';

            let data;
            try {
                data = await App.Api.request('/api/autocalc/attacker-defense-summary', { method: 'POST', body: { attackerKey, defenseKey } });
            } catch (err) {
                summaryEl.innerHTML = '<p class="text-red-600">No se pudo calcular. Verifica tu conexión.</p>';
                showToast(err.userMessage || 'No se pudo calcular el resumen de atacante/defensa.');
                return;
            }
            const { attackerProfile, defenseProfile, attackerScore, defenseScore, differential } = data;

            // Guardar para trazabilidad (qué supuestos se usaron) y para la sugerencia de rango
            state.fair.attackerKey = attackerKey;
            state.fair.defenseKey = defenseKey;
            state.fair.attackerScore = attackerScore;
            state.fair.defenseScore = defenseScore;
            state.fair.FAD_raw = differential / 100;

            const rowsHTML = (profile) => Object.entries(profile)
                .filter(([key]) => key !== 'name')
                .map(([key, value]) => `<span class="inline-block mr-3 capitalize">${key}: <strong>${value}%</strong></span>`)
                .join('');

            const diffClass = differential >= 0 ? 'text-red-700' : 'text-green-700';
            const diffText = differential >= 0
                ? 'el atacante supera a tu defensa actual'
                : 'tu defensa actual supera al atacante';

            summaryEl.innerHTML = `
                <p class="mb-1"><strong>Factor de Amenaza (FA):</strong> ${attackerScore.toFixed(1)}% — ${rowsHTML(attackerProfile)}</p>
                <p class="mb-1"><strong>Nivel de Defensa (ENC):</strong> ${defenseScore.toFixed(1)}% — ${rowsHTML(defenseProfile)}</p>
                <p class="mt-2 ${diffClass}"><strong>Diferencial Atacante−Defensa:</strong> ${differential.toFixed(1)} puntos (${diffText})</p>
            `;

            this.suggestTefRange();
            await Promise.all([this.updateVulnerabilityAuto(), this.updateReduccionALEAuto()]);
        },

        // Reducción de ALE (%) al Mitigar: se deriva de comparar tu Nivel de Defensa ACTUAL contra
        // el Nivel de Defensa OBJETIVO que alcanzarías con el control propuesto. No inventa el
        // costo del control (eso sí depende del mundo real), pero sí la reducción porcentual,
        // porque es la misma relación matemática que ya usa Vulnerabilidad.
        async updateReduccionALEAuto() {
            const objetivoSelect = document.getElementById('fair-mitigar-defensa-objetivo');
            if (!objetivoSelect) return;
            if (document.getElementById('fair-reduccionALE-manual-override').checked) return;
            if (!state.fair.defenseKey) return;

            const objetivoKey = objetivoSelect.value;
            const explanationEl = document.getElementById('fair-reduccionALE-explanation');
            explanationEl.textContent = 'Calculando…';

            let data;
            try {
                data = await App.Api.request('/api/autocalc/reduccion-ale', {
                    method: 'POST', body: { currentDefenseKey: state.fair.defenseKey, targetDefenseKey: objetivoKey },
                });
            } catch (err) {
                explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
                return;
            }

            document.getElementById('fair-reduccionALE').value = data.reductionPercent;
            explanationEl.textContent =
                `Calculado como: pasar de tu defensa actual (${data.currentScore.toFixed(0)}%) a "${state.quick.defenseProfiles[objetivoKey].name}" (${data.targetScore.toFixed(0)}%) = ${data.reductionPercent}% de reducción estimada.`;

            if (this.updateTreatmentView) this.updateTreatmentView();
        },

        // Vulnerabilidad = probabilidad de que la amenaza tenga éxito = capacidad del atacante
        // vs. fuerza de tu defensa (FAIR: Threat Capability vs. Resistance Strength). Se calcula
        // sola; el usuario no tiene que adivinar un porcentaje. El ancho del rango (Mín/Máx)
        // se ajusta según el Nivel de Confianza que ya declaraste — confianza baja = rango ancho.
        setVulnManualOverride(isManual) {
            document.getElementById('vuln-manual-override').checked = isManual;
            ['vuln-min', 'vuln-mode', 'vuln-max'].forEach(id => {
                const el = document.getElementById(id);
                el.readOnly = !isManual;
                el.classList.toggle('bg-gray-100', !isManual);
            });
            document.getElementById('vuln-auto-explanation').classList.toggle('hidden', isManual);
        },

        async updateVulnerabilityAuto() {
            if (document.getElementById('vuln-manual-override').checked) return;
            if (!state.fair.attackerKey || !state.fair.defenseKey) return;

            const confidence = document.getElementById('fair-data-confidence').value;
            const explanationEl = document.getElementById('vuln-auto-explanation');
            explanationEl.textContent = 'Calculando…';

            let data;
            try {
                data = await App.Api.request('/api/autocalc/vulnerability', {
                    method: 'POST', body: { attackerKey: state.fair.attackerKey, defenseKey: state.fair.defenseKey, confidence },
                });
            } catch (err) {
                explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
                return;
            }

            document.getElementById('vuln-min').value = data.min;
            document.getElementById('vuln-mode').value = data.mode;
            document.getElementById('vuln-max').value = data.max;

            const confidenceLabel = { alto: 'Alta', medio: 'Media', bajo: 'Baja' }[confidence] || 'Media';
            explanationEl.textContent =
                `Calculado como: Factor de Amenaza (${data.attackerScore.toFixed(0)}%) × [1 − Nivel de Defensa (${data.defenseScore.toFixed(0)}%)] = ${data.mode}%. Rango ±según tu Nivel de Confianza declarado (${confidenceLabel}).`;
        },

        // Conecta la Fecha de Revisión con qué tan grave salió la Evaluación (ISO 31000, 6.6):
        // un riesgo Crítico se revisa pronto, uno Aceptable puede esperar un año. Solo sugiere si
        // el campo está vacío — nunca pisa una fecha que el usuario ya haya elegido a propósito.
        suggestReviewDate() {
            const reviewInput = document.getElementById('fair-review-date');
            if (reviewInput.value) return;

            const level = (state.fair.lastEvaluation && state.fair.lastEvaluation.level) || '';
            let months = 12;
            if (level.includes('Crítico')) {
                months = 3;
            } else if (level.includes('Requiere Tratamiento') || level.includes('Oportunidad Significativa')) {
                months = 6;
            }

            const suggested = new Date();
            suggested.setMonth(suggested.getMonth() + months);
            reviewInput.value = suggested.toISOString().split('T')[0];
            showToast(`Fecha de revisión sugerida a ${months} meses, según la evaluación de este riesgo.`);
        },

        toggleRiskTypeLabels() {
            const isOpportunity = document.getElementById('fair-risk-type').value === 'oportunidad';
            state.fair.riskType = isOpportunity ? 'oportunidad' : 'amenaza';
            App.UIMode.applyLabels();
        },

        toggleDeliberateThreatFair() {
            const checked = document.getElementById('fair-deliberate-threat').checked;
            document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !checked);
            state.fair.isDeliberate = checked;
        },

        // Punto de partida automático para TEF (Paso 2): no hay forma de calcular "cuántas veces
        // al año" con certeza solo a partir de un perfil de atacante — eso depende del contexto
        // real de la organización, que el software no conoce. Por eso esto es una SUGERENCIA que
        // se recalcula sola mientras el usuario no haya tecleado su propio número (ver el listener
        // 'input' en bindEvents que fija tefManuallyEdited), no un cálculo "verdadero" como
        // Vulnerabilidad o Magnitud de Pérdida, que sí son derivables con la info disponible.
        //
        // La Frecuencia depende de qué tan motivado y persistente es el atacante — NO de tu nivel
        // de Defensa. La Defensa ya se aplica en Vulnerabilidad (si el ataque tiene éxito); usarla
        // también aquí contaría el mismo efecto dos veces.
        //
        // El multiplicador escala según la motivación+persistencia del atacante en bruto (0-100),
        // no centrada en 50 — antes, un atacante "por debajo del promedio" (ej. Intruso
        // Oportunista, o el Grupo Organizado que da justo 50) hacía que subir el ponderador de
        // "qué tan deliberada es la amenaza" bajara o no moviera la frecuencia sugerida, mismo
        // problema que el de Riesgo Inherente en Análisis Rápido: marcar una amenaza como
        // deliberada y pesarla más nunca debería sugerir MENOS frecuencia que el punto de partida
        // neutral (BASE_MODE, ponderación=0) — solo puede sugerir igual o más.
        suggestTefRange() {
            if (state.fair.tefManuallyEdited) return;
            const attackerKey = document.getElementById('fair-attacker-profile').value;
            const attackerProfile = state.quick.attackerProfiles[attackerKey];
            const explanationEl = document.getElementById('tef-auto-explanation');
            if (!attackerProfile) return;

            const ponderacion = getSafeNumber(document.getElementById('fair-deliberate-ponderation'));
            const isDeliberate = document.getElementById('fair-deliberate-threat').checked;
            const frequencyFactor = (attackerProfile.motivation + attackerProfile.persistence) / 2;
            const attackerThreatFactor = frequencyFactor / 100;
            const multiplier = isDeliberate ? (1 + (attackerThreatFactor * ponderacion)) : 1;

            const BASE_MODE = 10; // punto de partida neutral (amenaza no deliberada, o ponderación=0)
            const suggestedMode = Math.max(1, Math.round(BASE_MODE * multiplier));

            document.getElementById('tef-min').value = Math.max(1, Math.round(suggestedMode * 0.5));
            document.getElementById('tef-mode').value = suggestedMode;
            document.getElementById('tef-max').value = Math.round(suggestedMode * 1.8);
            explanationEl.textContent = `Sugerido según el Perfil "${attackerProfile.name || attackerKey}"${isDeliberate ? ' y la sensibilidad de ajuste elegida' : ''} — es un punto de partida, no un cálculo exacto. Edítalo si tienes un dato mejor (histórico, benchmark del sector, etc.).`;
        },

        validateAndFixRange(prefix) {
            const minInput = document.getElementById(`${prefix}-min`);
            const modeInput = document.getElementById(`${prefix}-mode`);
            const maxInput = document.getElementById(`${prefix}-max`);
            
            let minVal = getSafeNumber(minInput);
            let modeVal = getSafeNumber(modeInput);
            let maxVal = getSafeNumber(maxInput);

            let values = [minVal, modeVal, maxVal];
            values.sort((a, b) => a - b);
            
            minInput.value = values[0];
            modeInput.value = values[1];
            maxInput.value = values[2];

            if (prefix.startsWith('lm-')) this.refreshLossMagnitudeCompactDisplay(prefix.slice(3));
        },

        receiveData(data) {
            state.fair.pendingRisks = Array.isArray(data) ? data : [data];
            
            const selectionContainer = document.getElementById('fair-selection-container');
            const wizardWrapper = document.getElementById('fair-wizard-wrapper');
            const riskList = document.getElementById('fair-risk-list');
            
            if (state.fair.pendingRisks.length > 1) {
                riskList.innerHTML = '';
                state.fair.pendingRisks.forEach((risk, index) => {
                    const button = document.createElement('button');
                    button.className = 'w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-md transition-colors';
                    button.textContent = risk.riskName || `Riesgo sin nombre ${index + 1}`;
                    button.onclick = () => this.loadRiskIntoForm(index);
                    riskList.appendChild(button);
                });
                selectionContainer.classList.remove('hidden');
                wizardWrapper.classList.add('hidden');
            } else {
                selectionContainer.classList.add('hidden');
                wizardWrapper.classList.remove('hidden');
                this.loadRiskIntoForm(0);
            }
        },

        loadRiskIntoForm(index) {
            const data = state.fair.pendingRisks[index];
            if (!data) return;

            document.getElementById('fair-selection-container').classList.add('hidden');
            document.getElementById('fair-wizard-wrapper').classList.remove('hidden');
            this.resetForm(false);
            // Se guarda DESPUÉS de resetForm(false) a propósito — resetForm también limpia
            // sourceRiskId, y este análisis sí necesita quedar vinculado al riesgo de origen
            // (ver App.FairRegister.saveToRiskRegister y buildConcentratedList).
            state.fair.sourceRiskId = data.quickRiskId || null;
            document.getElementById('fair-riskName').value = data.riskName || '';
            this.populateTriggeredByOptions();
            // Igual que la Descripción/norma de abajo: si el riesgo se armó eligiendo un activo
            // del Catálogo de Activos en Análisis Rápido, ese nombre se transfiere aquí en vez
            // de forzar a re-escribirlo (ver App.AssetCatalog y calculateAll()).
            if (data.asset) document.getElementById('fair-asset').value = data.asset;

            // La Descripción ahora tiene su propio campo en FAIR (fair-riskDescription) — antes
            // se perdía por completo (el usuario veía el wizard como un análisis nuevo, sin
            // ninguna conexión con lo que ya había escrito en Análisis Rápido). La norma del
            // catálogo (si el riesgo se armó con App.RiskCatalog) sigue sin tener un campo
            // propio en FAIR, así que se anota en "Notas / Justificación de los Estimados"
            // (Paso 1, sección Calidad de la Información) — es lo más cercano que existe.
            document.getElementById('fair-riskDescription').value = data.riskDescription || '';
            document.getElementById('fair-data-notes').value = data.catalogStandard
                ? `[Catálogo de Riesgos: ${data.catalogCode ? data.catalogCode + ' — ' : ''}${data.catalogStandard}]`
                : '';
            // Campos propios del Paso 1 de FAIR — un riesgo guardado con "Guardar" (sin pasar
            // por el resto del wizard, ver saveDraftToRisksList) ya los trae; uno de la vieja
            // Vista Rápida nunca los tuvo, así que quedan en su valor por defecto.
            if (data.threat) document.getElementById('fair-threat').value = data.threat;
            document.getElementById('fair-effect').value = data.effect || 'material';
            document.getElementById('fair-risk-type').value = data.riskType || 'amenaza';
            document.getElementById('fair-time-horizon').value = data.timeHorizon || '1';
            this.toggleRiskTypeLabels();
            if (data.triggeredByRiskName) document.getElementById('fair-triggered-by').value = data.triggeredByRiskName;

            if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
            if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
            document.getElementById('fair-deliberate-threat').checked = !!data.isDeliberate;
            document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !data.isDeliberate);
            if (data.deliberateThreatPonderation) {
                document.getElementById('fair-deliberate-ponderation').value = data.deliberateThreatPonderation;
                document.getElementById('fair-deliberate-ponderation-value').textContent = `x${parseFloat(data.deliberateThreatPonderation).toFixed(2)}`;
            }
            this.updateAttackerDefenseSummary();

            // Costo Mín/Máx y ARO solo existen en riesgos de la vieja Vista Rápida (ya
            // eliminada) — un riesgo guardado con "Guardar" desde el Paso 1 de FAIR no tiene
            // ninguno de los dos, así que no hay nada que repartir ni ninguna frecuencia previa
            // que sugerir: TEF/Vulnerabilidad quedan en su sugerencia automática normal (ver
            // updateAttackerDefenseSummary, ya llamado arriba).
            if (data.costoMinImpacto != null && data.costoMaxImpacto != null) {
                // El total de Análisis Rápido nunca llega desglosado por categoría (solo pregunta
                // un costo mínimo/máximo global) — antes esto se metía completo y en silencio en
                // "Costos de Respuesta", una categoría específica que no necesariamente es la
                // correcta. Ahora se le pide al usuario, justo al promover, que decida cómo repartir
                // ese mismo total entre las 9 categorías (ver openLossRedistributionModal). El
                // reparto es un porcentaje del mismo total, así que la suma de las 9 categorías es
                // siempre idéntica al total original: repartir no cambia ningún resultado de la
                // simulación, solo dónde queda registrado.
                const avgCost = (data.costoMinImpacto + data.costoMaxImpacto) / 2;
                this.openLossRedistributionModal(data, avgCost);

                const tefMode = data.ARO_raw > 1 ? Math.round(data.ARO_raw * 5) : 10;
                document.getElementById('tef-min').value = Math.max(1, Math.round(tefMode * 0.2));
                document.getElementById('tef-mode').value = tefMode;
                document.getElementById('tef-max').value = Math.round(tefMode * 2);
                // Ya viene de un dato real (Análisis Rápido) — que la sugerencia automática (todavía
                // en vuelo desde el updateAttackerDefenseSummary() de arriba) no lo pise.
                state.fair.tefManuallyEdited = true;
            }

            // La Vulnerabilidad NO se transfiere de Análisis Rápido: ya quedó calculada arriba
            // (updateAttackerDefenseSummary, línea previa) a partir del Perfil de Atacante/Defensa
            // que sí se transfirió. Sobrescribirla aquí con el valor viejo de Análisis Rápido
            // sería descartar en silencio ese cálculo y mostrar una explicación que ya no
            // correspondería al número mostrado.
            this.navigateWizard(1, true);
        },

        // Abre el wizard completo (incluyendo Tratamiento) para un riesgo YA analizado con
        // FAIR, cargando sus datos guardados en el Registro — a diferencia de "Simular" (un
        // vistazo rápido de solo lectura dentro de la misma página del Registro), esto lleva al
        // usuario al wizard de verdad para poder revisar/ajustar y decidir Mitigar/Transferir/
        // Evitar/Aceptar. Mismo patrón que duplicateFromTemplate(), pero la fuente son los datos
        // reales guardados de ESTE riesgo (no una plantilla genérica del último análisis).
        // Llena "Riesgo Desencadenante" (Paso 1) con los demás riesgos del Registro — excluye el
        // riesgo actual (por nombre) para que no se pueda seleccionar a sí mismo. Se llama cada
        // vez que el Registro se recarga (ver App.FairRegister.loadRiskRegister) y cada vez que
        // se carga un riesgo específico en el formulario, para que la exclusión quede al día con
        // el nombre vigente. Solo organizativo por ahora — no alimenta ningún cálculo; deja lista
        // la relación padre-hijo para poder dibujar un árbol de riesgos en cascada más adelante,
        // sin tener que rediseñar el dato.
        populateTriggeredByOptions() {
            const select = document.getElementById('fair-triggered-by');
            if (!select) return;
            const currentValue = select.value;
            const ownName = document.getElementById('fair-riskName').value.trim();
            const register = state.fair.riskRegister || [];

            select.innerHTML = '';
            const noneOpt = document.createElement('option');
            noneOpt.value = '';
            noneOpt.textContent = '— Ninguno (riesgo independiente) —';
            select.appendChild(noneOpt);

            register.filter(r => r.riskName !== ownName).forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.riskName;
                opt.textContent = r.riskName;
                select.appendChild(opt);
            });

            if (Array.from(select.options).some(opt => opt.value === currentValue)) {
                select.value = currentValue;
            }
        },

        loadRegisteredRiskIntoForm(riskName) {
            const entry = (state.fair.riskRegister || []).find(r => r.riskName === riskName);
            if (!entry) {
                showToast('No se encontró este riesgo en el Registro.');
                return;
            }

            // Por si se venía de la pantalla "elige cuál riesgo" (promoción múltiple desde
            // Análisis Rápido) — sin esto, el wizard podía quedar oculto detrás de esa lista.
            document.getElementById('fair-selection-container').classList.add('hidden');
            document.getElementById('fair-wizard-wrapper').classList.remove('hidden');
            this.resetForm(false);
            // Conserva el vínculo con Análisis Rápido (si lo tiene) — si se vuelve a guardar,
            // sigue siendo la MISMA entrada del Registro, no una nueva sin relación (ver
            // App.FairRegister.buildConcentratedList).
            state.fair.sourceRiskId = entry.sourceRiskId || null;
            // Igual que sourceRiskId: conserva el id propio de esta entrada, para que re-guardar
            // (aunque se renombre el riesgo mientras tanto) siga actualizando esta misma entrada
            // en vez de crear una nueva huérfana (ver findRegisterEntryIndex en el backend).
            state.fair.registerEntryId = entry.id || null;

            document.getElementById('fair-riskName').value = entry.riskName || '';
            document.getElementById('fair-riskDescription').value = entry.description || '';
            this.populateTriggeredByOptions();
            document.getElementById('fair-triggered-by').value = entry.triggeredByRiskName || '';
            if (entry.asset && entry.asset !== '—') document.getElementById('fair-asset').value = entry.asset;
            if (entry.owner && entry.owner !== '—') document.getElementById('fair-owner').value = entry.owner;
            if (entry.securityPlan && entry.securityPlan !== '—') document.getElementById('fair-security-plan').value = entry.securityPlan;
            document.getElementById('fair-risk-type').value = entry.riskType || 'amenaza';
            this.toggleRiskTypeLabels();

            // El Registro no guarda todavía qué Perfil de Atacante/Defensa se usó (solo el
            // resultado: los rangos de TEF/Vulnerabilidad) — el selector se queda en su valor
            // por defecto y su resumen de texto no reflejará el perfil original, pero los
            // números reales (lo que de verdad alimenta la simulación) sí son los guardados.
            this.updateAttackerDefenseSummary();

            if (entry.tef) {
                document.getElementById('tef-min').value = entry.tef.min;
                document.getElementById('tef-mode').value = entry.tef.mode;
                document.getElementById('tef-max').value = entry.tef.max;
                state.fair.tefManuallyEdited = true;
            }
            if (entry.vuln) {
                document.getElementById('vuln-min').value = entry.vuln.min;
                document.getElementById('vuln-mode').value = entry.vuln.mode;
                document.getElementById('vuln-max').value = entry.vuln.max;
                this.setVulnManualOverride(true);
            }
            if (entry.lossMagnitudes) {
                this.setLossMagnitudeManualOverride(true, true);
                Object.entries(entry.lossMagnitudes).forEach(([key, vals]) => {
                    const minEl = document.getElementById(`lm-${key}-min`);
                    const modeEl = document.getElementById(`lm-${key}-mode`);
                    const maxEl = document.getElementById(`lm-${key}-max`);
                    if (minEl) minEl.value = vals.min;
                    if (modeEl) modeEl.value = vals.mode;
                    if (maxEl) maxEl.value = vals.max;
                    this.refreshLossMagnitudeCompactDisplay(key);
                });
            }
            if (entry.seed) document.getElementById('fair-simulation-seed').value = entry.seed;

            this.navigateWizard(1, true);
            showToast(`"${sanitizeHTML(entry.riskName)}" cargado desde el Registro — corre la simulación (Paso 4) para ver resultados y tratamiento actualizados.`);
        },

        // Al promover desde Análisis Rápido, el total estimado (Costo Mín/Máx) no viene
        // desglosado por categoría de pérdida — Análisis Rápido es una herramienta de triage
        // rápido para muchos riesgos (la mayoría nunca se promueve), así que pedir ese desglose
        // ahí arriba sería innecesario para la mayoría de los casos. En vez de eso se pide aquí,
        // justo en el momento en que empieza a importar. El reparto es un porcentaje del mismo
        // total (min/modo/max), así que la suma de las 9 categorías siempre es idéntica al
        // total original — repartir no altera ningún resultado de la simulación, solo dónde
        // queda registrado. "Dejar todo en Costos de Respuesta" conserva el comportamiento
        // anterior para quien no quiera detenerse a repartir.
        openLossRedistributionModal(data, avgCost) {
            const currency = 'USD';
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
            const total = { min: data.costoMinImpacto, mode: avgCost, max: data.costoMaxImpacto };
            const keys = LOSS_FORMS_KEYS;
            const defaultPct = {};
            keys.forEach(k => { defaultPct[k] = k === 'respuesta' ? 100 : 0; });

            Modal.title.textContent = 'Distribuir el Impacto Estimado';
            Modal.body.innerHTML = `
                <p class="description-text mb-3">
                    Análisis Rápido estimó un impacto total de <strong>${fmt(total.min)} — ${fmt(total.max)}</strong>
                    (más probable: ${fmt(total.mode)}) sin desglosarlo por tipo de pérdida. Reparte ese mismo
                    total entre las categorías de Magnitud de Pérdida de FAIR (debe sumar 100%) — la suma total
                    no cambia, solo dónde queda registrada.
                </p>
                <div id="lm-redistribute-rows" class="space-y-2"></div>
                <p class="text-sm mt-3">Suma actual: <span id="lm-redistribute-sum">100</span>%
                    (<span id="lm-redistribute-sum-amount">${fmt(total.mode)}</span>)
                    <span id="lm-redistribute-sum-warning" class="text-red-600 hidden ml-2">(debe sumar 100%)</span>
                </p>
            `;
            const rowsEl = Modal.body.querySelector('#lm-redistribute-rows');
            keys.forEach(k => {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-2';
                row.innerHTML = `
                    <label for="lm-redistribute-${k}" class="text-sm" style="flex:1">${sanitizeHTML(LOSS_FORM_LABELS.tecnico[k])}</label>
                    <input type="number" id="lm-redistribute-${k}" class="form-input" style="width:70px" min="0" max="100" value="${defaultPct[k]}">
                    <span class="text-sm">%</span>
                    <span id="lm-redistribute-${k}-amount" class="text-sm text-gray-500" style="width:90px; text-align:right">${fmt(total.mode * defaultPct[k] / 100)}</span>
                `;
                rowsEl.appendChild(row);
            });
            Modal.footer.innerHTML = `
                <button id="lm-redistribute-skip-btn" class="btn btn-secondary">Dejar todo en "Costos de Respuesta"</button>
                <button id="lm-redistribute-confirm-btn" class="btn btn-primary">Confirmar Distribución</button>
            `;
            Modal.modal.classList.remove('hidden');

            const inputs = keys.map(k => document.getElementById(`lm-redistribute-${k}`));
            const amountEls = keys.map(k => document.getElementById(`lm-redistribute-${k}-amount`));
            const sumEl = document.getElementById('lm-redistribute-sum');
            const sumAmountEl = document.getElementById('lm-redistribute-sum-amount');
            const warnEl = document.getElementById('lm-redistribute-sum-warning');
            const confirmBtn = document.getElementById('lm-redistribute-confirm-btn');

            // Cada input de % muestra al lado, en vivo, cuánto dinero representa — antes el
            // total solo aparecía en $ arriba y el reparto se pedía en %, así que el usuario
            // tenía que calcular la conversión a mano para saber cuánto le estaba tocando a
            // cada categoría.
            const recomputeSum = () => {
                let sum = 0;
                inputs.forEach((inp, i) => {
                    const pct = getSafeNumber(inp);
                    sum += pct;
                    amountEls[i].textContent = fmt(total.mode * pct / 100);
                });
                sumEl.textContent = sum;
                sumAmountEl.textContent = fmt(total.mode * sum / 100);
                const ok = Math.abs(sum - 100) < 0.001;
                warnEl.classList.toggle('hidden', ok);
                confirmBtn.disabled = !ok;
            };
            inputs.forEach(inp => inp.addEventListener('input', recomputeSum));
            recomputeSum();

            const applyDistribution = (pctByKey) => {
                keys.forEach(k => {
                    const pct = (pctByKey[k] || 0) / 100;
                    document.getElementById(`lm-${k}-min`).value = (total.min * pct).toFixed(0);
                    document.getElementById(`lm-${k}-mode`).value = (total.mode * pct).toFixed(0);
                    document.getElementById(`lm-${k}-max`).value = (total.max * pct).toFixed(0);
                    this.refreshLossMagnitudeCompactDisplay(k);
                });
            };

            document.getElementById('lm-redistribute-skip-btn').addEventListener('click', () => {
                applyDistribution(defaultPct);
                Modal.hide();
            });
            confirmBtn.addEventListener('click', () => {
                if (confirmBtn.disabled) return;
                const pctByKey = {};
                keys.forEach((k, i) => { pctByKey[k] = getSafeNumber(inputs[i]); });
                applyDistribution(pctByKey);
                Modal.hide();
            });
        },

        // Registra la promesa de un autocálculo disparado por un listener "fire and forget"
        // (change de un <select>/checkbox no se espera con await) para que navigateWizard()
        // pueda esperarla antes de validar, en vez de validar contra datos todavía viejos.
        _trackPendingAutocalc(promise) {
            state.fair.pendingAutocalc = promise;
            promise.finally(() => {
                if (state.fair.pendingAutocalc === promise) state.fair.pendingAutocalc = null;
            });
            return promise;
        },

        async navigateWizard(step, force = false) {
            if (state.fair.pendingAutocalc) {
                try { await state.fair.pendingAutocalc; } catch (e) { /* el propio autocálculo ya avisó del error */ }
            }
            // stepValidations solo tiene entradas para 1-3 (avanzar hacia el Paso 4 es lo único
            // que necesita validarse) — el Paso 4 no tiene validador, así que sin este chequeo
            // "Anterior" desde ahí llamaba a undefined() y tronaba.
            const validator = state.fair.stepValidations[state.fair.currentStep];
            if (!force && validator && !validator()) {
                this.displayFairValidationErrors();
                return;
            }
            state.fair.currentStep = step;
            document.querySelectorAll('#fairAnalysisPage .wizard-step').forEach(section => section.classList.add('hidden'));
            document.getElementById(`fair-step-${step}`).classList.remove('hidden');
            updateProgressBar('fair-progress-bar', step, 4);
        },

        displayFairValidationErrors() {
            document.querySelectorAll('.input-error, .error-message').forEach(el => {
                el.classList.remove('input-error');
                el.classList.add('hidden');
            });
            
            const currentStep = state.fair.currentStep;
            
            if (currentStep === 1) {
                if (!document.getElementById('fair-riskName').value.trim()) {
                    toggleErrorState('fair-riskName', 'El nombre del escenario es obligatorio.');
                }
            } else if (currentStep === 2) {
                const checkRange = (prefix) => {
                    const min = getSafeNumber(document.getElementById(`${prefix}-min`));
                    const mode = getSafeNumber(document.getElementById(`${prefix}-mode`));
                    const max = getSafeNumber(document.getElementById(`${prefix}-max`));
                    if (min > mode || mode > max) {
                        toggleErrorState(`${prefix}-min`, 'Rango numérico inválido (Min ≤ Modo ≤ Max)');
                        toggleErrorState(`${prefix}-mode`, '');
                        toggleErrorState(`${prefix}-max`, '');
                    }
                };
                checkRange('tef');
                checkRange('vuln');
            } else if (currentStep === 3) {
                const lossFormsKeys = LOSS_FORMS_KEYS;
                for (const key of lossFormsKeys) {
                    const min = getSafeNumber(document.getElementById(`lm-${key}-min`));
                    const mode = getSafeNumber(document.getElementById(`lm-${key}-mode`));
                    const max = getSafeNumber(document.getElementById(`lm-${key}-max`));
                    if (min > mode || mode > max) {
                        const warningEl = document.getElementById(`lm-warning-${key}`);
                        warningEl.textContent = 'Rango numérico inválido (Min ≤ Modo ≤ Max)';
                        warningEl.classList.remove('hidden');
                        document.getElementById(`lm-${key}-min`).classList.add('input-error');
                        document.getElementById(`lm-${key}-mode`).classList.add('input-error');
                        document.getElementById(`lm-${key}-max`).classList.add('input-error');
                    } else {
                        document.getElementById(`lm-${key}-min`).classList.remove('input-error');
                        document.getElementById(`lm-${key}-mode`).classList.remove('input-error');
                        document.getElementById(`lm-${key}-max`).classList.remove('input-error');
                        // mode === 0 es una categoría que no aplica a este riesgo (el usuario la
                        // dejó en blanco a propósito) — no es una "incertidumbre eliminada" que
                        // valga la pena advertir. Sin este filtro, cada categoría sin usar
                        // mostraba la misma advertencia (hasta 7-8 a la vez en un caso típico).
                        const warningEl = document.getElementById(`lm-warning-${key}`);
                        if (mode !== 0 && min === mode && mode === max) {
                            // Se fija el texto aquí (no solo la visibilidad) porque este mismo
                            // <span> se reutiliza para el mensaje de "rango inválido" de arriba —
                            // sin esto, una vez que esa rama lo pisaba una vez, este mensaje se
                            // quedaba con el texto equivocado para siempre (bug reportado: un
                            // rango válido mostraba "Rango numérico inválido").
                            warningEl.textContent = 'Advertencia: Min, Modo y Max son iguales. Esto elimina la incertidumbre para este factor.';
                            warningEl.classList.remove('hidden');
                        } else {
                            warningEl.classList.add('hidden');
                        }
                    }
                }
            }
        },

        // El Mín/Máx son un cálculo derivado de "caso típico" (ver _applyLossMagnitudeAuto) —
        // pedirlos como 3 cajas de texto completas por categoría (9 categorías) era mucho scroll
        // para 2 valores que el usuario ni siquiera puede tocar en el caso normal. Por default
        // (automático) solo se pide el dato principal y Mín/Máx se muestran como texto compacto
        // al lado; las 3 cajas editables completas solo aparecen si activa "Editar manualmente"
        // (ver setLossMagnitudeManualOverride).
        populateLossMagnitudeForms() {
            const container = document.getElementById('loss-magnitude-forms');
            const isSimple = App.UIMode.mode === 'simple';
            const titles = isSimple ? LOSS_FORM_LABELS.simple : LOSS_FORM_LABELS.tecnico;
            const fieldLabels = isSimple ? LOSS_FIELD_LABELS.simple : LOSS_FIELD_LABELS.tecnico;
            container.innerHTML = LOSS_FORMS_KEYS.map(key => `
                <div class="fair-section bg-gray-50">
                    <h5 class="font-semibold text-gray-700" id="lm-title-${key}">${titles[key]}</h5>
                    <div class="input-group mt-2">
                        <label for="lm-${key}-mode" id="lm-${key}-mode-label">${fieldLabels.mode}</label>
                        <input type="number" id="lm-${key}-mode" class="form-input fair-range-input" data-mode="true" data-key="${key}" value="0" min="0" oninput="validity.valid||(value='');">
                    </div>
                    <p class="text-sm text-gray-500 mt-1" id="lm-${key}-compact-summary">Mín: $0 · Máx: $0</p>
                    <div class="hidden grid grid-cols-1 md:grid-cols-2 gap-4 mt-2" id="lm-${key}-minmax-full">
                        <div class="input-group">
                            <label for="lm-${key}-min" id="lm-${key}-min-label">${fieldLabels.min}</label>
                            <input type="number" id="lm-${key}-min" class="form-input fair-range-input bg-gray-100" data-min="true" data-key="${key}" value="0" min="0" readonly oninput="validity.valid||(value='');">
                        </div>
                        <div class="input-group">
                            <label for="lm-${key}-max" id="lm-${key}-max-label">${fieldLabels.max}</label>
                            <input type="number" id="lm-${key}-max" class="form-input fair-range-input bg-gray-100" data-max="true" data-key="${key}" value="0" min="0" readonly oninput="validity.valid||(value='');">
                        </div>
                    </div>
                    <span id="lm-warning-${key}" class="range-warning hidden">Advertencia: Min, Modo y Max son iguales. Esto elimina la incertidumbre para este factor.</span>
                </div>`
            ).join('');
            this.refreshAllLossMagnitudeCompactDisplays();
            document.querySelectorAll('.fair-range-input').forEach(input => {
                if (input.dataset.key) {
                    input.addEventListener('change', async () => {
                        let autocalcOk = true;
                        if (input.dataset.mode) {
                            // Hay que esperar a que el backend devuelva min/max antes de
                            // reordenar — si no, validateAndFixRange ordena con el min/max
                            // viejo (aún no actualizado) y termina pisando el "Más Probable"
                            // que el usuario acaba de escribir. Se registra en
                            // pendingAutocalc para que navigateWizard() también la espere si
                            // el usuario da clic en "Siguiente" antes de que esto termine.
                            autocalcOk = await this._trackPendingAutocalc(this.updateLossMagnitudeAuto(input.dataset.key));
                        }
                        // Si el cálculo falló, Mín/Máx quedaron con su valor viejo/sin relación
                        // con el "Modo" que se acaba de escribir — reordenar esos 3 números junto
                        // con el nuevo Modo no tiene sentido y, peor, puede pisar el Modo recién
                        // tecleado con ese valor viejo (ver el mensaje de error que ya se mostró
                        // en el resumen compacto en su lugar).
                        if (autocalcOk) this.validateAndFixRange(`lm-${input.dataset.key}`);
                        this.displayFairValidationErrors();
                    });
                }
            });
        },

        // Refleja el valor actual de los inputs Mín/Máx (ocultos en modo automático, ver arriba)
        // en el resumen compacto de una sola línea — se llama cada vez que esos inputs cambian
        // de valor por cualquier vía (autocálculo, restaurar borrador, plantilla, Análisis Rápido).
        // Reconstruye el texto completo (no solo el de un <span> hijo) a propósito: mientras el
        // cálculo está en vuelo o si falla, este mismo elemento se pisa con "Calculando…" o un
        // mensaje de error (ver _applyLossMagnitudeAuto) — si esto dependiera de un <span> hijo
        // fijo, ese pisado lo destruiría y el resumen se quedaría trabado en "Calculando…" para
        // siempre, aunque el cálculo ya hubiera terminado bien.
        refreshLossMagnitudeCompactDisplay(key) {
            const summaryEl = document.getElementById(`lm-${key}-compact-summary`);
            if (!summaryEl) return;
            const currency = 'USD';
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
            const min = fmt(getSafeNumber(document.getElementById(`lm-${key}-min`)));
            const max = fmt(getSafeNumber(document.getElementById(`lm-${key}-max`)));
            summaryEl.textContent = `Mín: ${min} · Máx: ${max}`;
        },

        refreshAllLossMagnitudeCompactDisplays() {
            LOSS_FORMS_KEYS.forEach(key => this.refreshLossMagnitudeCompactDisplay(key));
        },

        // Mismo criterio que Vulnerabilidad: el usuario solo da el valor "Más Probable" y el
        // Mínimo/Máximo se derivan según su Nivel de Confianza declarado (POST
        // /api/autocalc/loss-magnitude, en batch para las 9 categorías a la vez).
        // Devuelven `true` si Mín/Máx quedaron actualizados con un cálculo real (o si no había
        // nada que calcular), `false` si el cálculo falló y Mín/Máx se quedaron en su valor
        // viejo/sin relación con el "Modo" recién editado — el llamador (el listener de
        // 'change' en populateLossMagnitudeForms) usa esto para decidir si tiene sentido
        // reordenar Min/Modo/Max con validateAndFixRange (ver ahí el porqué).
        async updateLossMagnitudeAuto(key) {
            if (document.getElementById('lm-manual-override').checked) return true;
            const modeEl = document.getElementById(`lm-${key}-mode`);
            if (!modeEl) return true;
            return await this._applyLossMagnitudeAuto([key]);
        },

        async updateAllLossMagnitudeAuto() {
            if (document.getElementById('lm-manual-override').checked) return true;
            return await this._applyLossMagnitudeAuto(LOSS_FORMS_KEYS);
        },

        async _applyLossMagnitudeAuto(keys) {
            const confidence = document.getElementById('fair-data-confidence').value;
            const items = keys
                .map(key => ({ key, mode: getSafeNumber(document.getElementById(`lm-${key}-mode`)) }))
                .filter(item => document.getElementById(`lm-${item.key}-mode`));
            if (items.length === 0) return true;

            // Mientras el cálculo está en vuelo (o si falla — ej. el backend gratuito de Render
            // tardando en "despertar"), el resumen compacto de Mín/Máx no debe quedarse en
            // silencio mostrando "$0 · $0" como si fuera un resultado real: eso es indistinguible
            // de un error de cálculo. Mismo patrón que "Calculando…" en Vulnerabilidad/Resumen
            // Atacante-Defensa.
            items.forEach(({ key }) => {
                const summaryEl = document.getElementById(`lm-${key}-compact-summary`);
                if (summaryEl && !summaryEl.classList.contains('hidden')) summaryEl.textContent = 'Calculando…';
            });

            let data;
            try {
                data = await App.Api.request('/api/autocalc/loss-magnitude', { method: 'POST', body: { items, confidence } });
            } catch (err) {
                showToast(err.userMessage || 'No se pudo calcular la Magnitud de Pérdida automáticamente.');
                items.forEach(({ key }) => {
                    const summaryEl = document.getElementById(`lm-${key}-compact-summary`);
                    if (summaryEl && !summaryEl.classList.contains('hidden')) {
                        summaryEl.innerHTML = '<span class="text-red-600">No se pudo calcular — revisa tu conexión o activa "Ajustar manualmente".</span>';
                    }
                });
                return false;
            }
            // Bug real: si mientras esta petición estaba en vuelo se activó "Ajustar
            // manualmente" (ej. al restaurar un riesgo guardado — ver
            // App.FairWizard.loadRegisteredRiskIntoForm/loadRiskIntoForm, que llaman a
            // resetForm() y ESO dispara un autocálculo con los modos todavía en 0 antes de
            // escribir los valores reales), este resultado ya no aplica. Sin este guardián, el
            // cálculo automático pisaba en silencio valores reales recién restaurados apenas
            // llegaba la respuesta — a diferencia de Vulnerabilidad/TEF, que sí revisan su
            // propio override antes de escribir (ver updateVulnerabilityAuto/suggestTefRange).
            if (document.getElementById('lm-manual-override').checked) return true;
            Object.entries(data).forEach(([key, range]) => {
                const minEl = document.getElementById(`lm-${key}-min`);
                const maxEl = document.getElementById(`lm-${key}-max`);
                if (minEl) minEl.value = range.min;
                if (maxEl) maxEl.value = range.max;
                this.refreshLossMagnitudeCompactDisplay(key);
            });
            return true;
        },

        // Alterna entre el resumen compacto de una línea (automático — la caja de Mín/Máx
        // completa se esconde, solo se ve el texto calculado) y las 3 cajas editables completas
        // (manual — el usuario necesita poder tocar las 3). El input de "caso típico" (Modo)
        // siempre es visible y editable en ambos modos, arriba de esto.
        // `skipAutocalc` lo usan restoreFairAnalysis/duplicateFromTemplate: ahí los valores
        // exactos de Mín/Máx ya vienen guardados y se van a escribir a continuación — disparar
        // un recálculo aquí leería el campo "Modo" todavía en 0 (no restaurado aún) y esa
        // respuesta, al llegar, pisaría los valores recién restaurados con un 0/0 fantasma.
        setLossMagnitudeManualOverride(isManual, skipAutocalc = false) {
            document.getElementById('lm-manual-override').checked = isManual;
            document.querySelectorAll('#loss-magnitude-forms input[data-min="true"], #loss-magnitude-forms input[data-max="true"]').forEach(el => {
                el.readOnly = !isManual;
                el.classList.toggle('bg-gray-100', !isManual);
            });
            LOSS_FORMS_KEYS.forEach(key => {
                const fullBox = document.getElementById(`lm-${key}-minmax-full`);
                const compactSummary = document.getElementById(`lm-${key}-compact-summary`);
                if (fullBox) fullBox.classList.toggle('hidden', !isManual);
                if (compactSummary) compactSummary.classList.toggle('hidden', isManual);
            });
            if (!isManual && !skipAutocalc) {
                this.refreshAllLossMagnitudeCompactDisplays();
                this._trackPendingAutocalc(this.updateAllLossMagnitudeAuto());
            }
        },
        
        resetForm(confirm = true) {
            const doReset = () => {
                state.fair.sourceRiskId = null;
                state.fair.registerEntryId = null;
                document.getElementById('fair-riskName').value = '';
                document.getElementById('fair-riskDescription').value = '';
                document.getElementById('fair-asset').value = '';
                state.quick.currentRiskId = null;
                state.quick.selectedCatalogRef = null;
                state.quick.selectedAssetRef = null;
                document.getElementById('fair-threat').value = '';
                document.getElementById('fair-effect').value = 'material';
                document.getElementById('fair-risk-type').value = 'amenaza';
                document.getElementById('fair-time-horizon').value = '1';
                this.populateTriggeredByOptions();
                document.getElementById('fair-triggered-by').value = '';
                this.toggleRiskTypeLabels();
                document.getElementById('fair-owner').value = App.OrgDefaults.defaults.owner;
                document.getElementById('fair-review-date').value = '';
                document.getElementById('fair-assessor').value = '';
                document.getElementById('fair-assessment-date').value = '';
                document.getElementById('fair-assessment-location').value = '';
                document.getElementById('fair-data-source').value = App.OrgDefaults.defaults.dataSource;
                document.getElementById('fair-data-confidence').value = App.OrgDefaults.defaults.dataConfidence;
                document.getElementById('fair-data-notes').value = '';
                document.getElementById('fair-security-plan').value = '';
                document.getElementById('fair-simulation-seed').value = '0';
                document.getElementById('fair-seed-used').textContent = '';
                document.getElementById('fair-review-history-body').innerHTML = '';
                document.getElementById('fair-review-history-container').classList.add('hidden');
                document.getElementById('fair-sensitivity-list').innerHTML = '';
                document.getElementById('fair-sensitivity-container').classList.add('hidden');
                state.fair.lastSensitivity = null;
                document.getElementById('tef-min').value = '5';
                document.getElementById('tef-mode').value = '10';
                document.getElementById('tef-max').value = '18';
                document.getElementById('tef-auto-explanation').textContent = '';
                state.fair.tefManuallyEdited = false;
                document.getElementById('vuln-min').value = '10';
                document.getElementById('vuln-mode').value = '25';
                document.getElementById('vuln-max').value = '50';
                this.setVulnManualOverride(false);
                document.getElementById('fair-attacker-profile').value = 'empleado-desleal';
                document.getElementById('fair-defense-profile').value = App.OrgDefaults.defaults.defenseKey;
                document.getElementById('fair-deliberate-threat').checked = false;
                document.getElementById('fair-deliberate-ponderation').value = '0.7';
                document.getElementById('fair-deliberate-ponderation-value').textContent = 'x0.70';
                document.getElementById('fair-deliberate-ponderation-container').classList.add('hidden');
                this.updateAttackerDefenseSummary();
                document.querySelectorAll('#loss-magnitude-forms input').forEach(input => input.value = '0');
                this.setLossMagnitudeManualOverride(false);
                document.querySelectorAll('.range-warning').forEach(el => el.classList.add('hidden'));
                document.querySelectorAll('.error-message').forEach(el => el.classList.add('hidden'));
                document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
                document.getElementById('simulation-results-container').classList.add('hidden');
                document.getElementById('fair-roi-section').classList.add('hidden');
                document.getElementById('fair-costoControlAnual').value = '0';
                document.getElementById('fair-reduccionALE').value = '0';
                document.getElementById('fair-mitigar-defensa-objetivo').value = 'basica';
                document.getElementById('fair-reduccionALE-manual-override').checked = false;
                document.getElementById('fair-reduccionALE').readOnly = true;
                document.getElementById('fair-reduccionALE').classList.add('bg-gray-100');
                document.getElementById('fair-reduccionALE-explanation').classList.remove('hidden');
                document.getElementById('fair-seguro-prima').value = '0';
                document.getElementById('fair-seguro-deducible').value = '0';
                document.getElementById('fair-seguro-limite').value = '0';
                document.getElementById('fair-seguro-sin-limite').checked = false;
                document.getElementById('fair-seguro-limite').disabled = false;
                document.getElementById('fair-seguro-limite').classList.remove('bg-gray-100');
                document.getElementById('fair-evitar-costo').value = '0';
                document.getElementById('fair-mitigar-fiabilidad').value = 'media';
                document.getElementById('fair-mitigar-retraso').value = '0';
                document.getElementById('fair-seguro-fiabilidad').value = 'media';
                document.getElementById('fair-seguro-retraso').value = '0';
                document.getElementById('fair-evitar-fiabilidad').value = 'alta';
                document.getElementById('fair-evitar-retraso').value = '0';
                document.getElementById('fair-aceptar-justificacion').value = '';
                state.fair.lastAnnualLosses = null;
                state.fair.lastEvaluation = null;
                state.fair.lastSeed = null;
                state.fair.reviewHistory = [];
                localStorage.removeItem('fairLastAnalysis');
                document.getElementById('fair-resume-banner').classList.add('hidden');
                if (state.fair.fairResultsChart) {
                    state.fair.fairResultsChart.destroy();
                    state.fair.fairResultsChart = null;
                }
                this.navigateWizard(1, true);
            };

            if (confirm) {
                Modal.confirm("¿Está seguro de que desea borrar todos los datos del análisis FAIR y empezar de nuevo?", doReset);
            } else {
                doReset();
            }
        },

        // La simulación Monte Carlo completa (10,000 escenarios, triangular, sensibilidad Pearson)
        // corre en el backend (POST /api/simulate) — antes se corría aquí mismo con mulberry32 +
        // muestreo triangular locales, duplicando el motor de cálculo del backend.
        async runMonteCarloSimulation() {
            const loader = document.getElementById('simulation-loader'),
                  resultsContainer = document.getElementById('simulation-results-container'),
                  runBtn = document.getElementById('run-simulation-btn');

            // Nota: no se revalida aquí — los pasos 1-3 ya se validaron al avanzar entre ellos
            // (navigateWizard). stepValidations no tiene una entrada "4" porque este es el
            // último paso, no hay "siguiente" que revisar.

            loader.classList.remove('hidden');
            resultsContainer.classList.add('hidden');
            runBtn.disabled = true;

            const iterations = state.config.SIMULATION_ITERATIONS;
            document.querySelector('#simulation-loader p').textContent = `Ejecutando ${iterations.toLocaleString('es-MX')} simulaciones en el servidor...`;

            const seed = getSafeNumber(document.getElementById('fair-simulation-seed'));
            const tef = {
                min: getSafeNumber(document.getElementById('tef-min')), mode: getSafeNumber(document.getElementById('tef-mode')), max: getSafeNumber(document.getElementById('tef-max')),
            };
            const vuln = {
                min: getSafeNumber(document.getElementById('vuln-min')), mode: getSafeNumber(document.getElementById('vuln-mode')), max: getSafeNumber(document.getElementById('vuln-max')),
            };
            const lossMagnitudes = {};
            LOSS_FORMS_KEYS.forEach(key => {
                lossMagnitudes[key] = {
                    min: getSafeNumber(document.getElementById(`lm-${key}-min`)),
                    mode: getSafeNumber(document.getElementById(`lm-${key}-mode`)),
                    max: getSafeNumber(document.getElementById(`lm-${key}-max`)),
                };
            });
            const riskType = document.getElementById('fair-risk-type').value;
            const currency = 'USD';

            try {
                const result = await App.Api.request('/api/simulate', {
                    method: 'POST',
                    body: { iterations, seed, tef, vuln, lossMagnitudes, riskType, currency, riskCriteria: state.config.riskCriteria },
                });
                await this.displaySimulationResults(result);
            } catch (error) {
                console.error("Simulation Error:", error);
                Modal.alert(error.userMessage || "Error al ejecutar la simulación. Por favor, revise sus entradas.", "Error de Simulación");
            } finally {
                loader.classList.add('hidden');
                resultsContainer.classList.remove('hidden');
                runBtn.disabled = false;
            }
        },

        renderSensitivity(sensitivity) {
            const container = document.getElementById('fair-sensitivity-list');
            if (!sensitivity || sensitivity.length === 0) {
                document.getElementById('fair-sensitivity-container').classList.add('hidden');
                return;
            }
            const top = sensitivity.slice(0, 8);
            const maxAbs = Math.max(...top.map(s => Math.abs(s.correlation)), 0.0001);
            container.innerHTML = top.map(s => {
                const pct = Math.max(2, Math.round((Math.abs(s.correlation) / maxAbs) * 100));
                const color = s.correlation >= 0 ? '#3B82F6' : '#EF4444';
                return `
                    <div class="mb-2">
                        <div class="flex justify-between text-sm"><span>${sensitivityLabel(s)}</span><span>${(s.correlation * 100).toFixed(1)}%</span></div>
                        <div class="w-full bg-gray-200 rounded h-2"><div class="h-2 rounded" style="width:${pct}%; background-color:${color};"></div></div>
                    </div>`;
            }).join('');
            document.getElementById('fair-sensitivity-container').classList.remove('hidden');
        },

        // Traduce el `verdict` que ya calculó el backend (POST /api/treatment/evaluate) al
        // mismo texto/emoji/clase que mostraba la UI — el backend no sabe nada de CSS/emojis,
        // solo devuelve `{verdict, rosi, message}`. ROSI = (Pérdida Evitada - Costo) / Costo × 100.
        renderInvestmentVerdict(rosiElementId, verdictElementId, verdictData) {
            const rosiEl = document.getElementById(rosiElementId);
            const verdictEl = document.getElementById(verdictElementId);
            const { verdict, rosi, message } = verdictData;

            rosiEl.textContent = (rosi === null || rosi === undefined)
                ? (verdict === 'conviene' ? 'Sin costo capturado' : '—')
                : `${rosi >= 0 ? '+' : ''}${rosi.toFixed(0)}%`;

            const styles = {
                conviene: { cls: 'bg-green-100 text-green-800', prefix: '✅ Esta opción SÍ conviene: ' },
                no_conviene: { cls: 'bg-red-100 text-red-800', prefix: '❌ Esta opción NO conviene: ' },
                neutro: { cls: 'bg-gray-100 text-gray-700', prefix: '⚖️ ' },
                sin_datos: { cls: '', prefix: '' },
            };
            const style = styles[verdict] || styles.sin_datos;
            verdictEl.className = `mt-3 p-2 rounded text-sm font-semibold ${style.cls}`;
            verdictEl.textContent = message ? `${style.prefix}${message}` : '';
        },

        async updateTreatmentView() {
            // Mitigar/Transferir/Evitar/Aceptar (ISO 31000, 6.5) asumen que la base es una
            // PÉRDIDA a reducir — aplicado a una Oportunidad, "Evitar" mostraría como "beneficio
            // neto" el beneficio que en realidad se pierde al no perseguirla (matemática al
            // revés), y "Mitigar" invitaría a reducir a propósito lo que es tu beneficio. Se
            // reemplaza toda la sección por una nota, en vez de mostrar esos números.
            const riskType = document.getElementById('fair-risk-type').value;
            const roiContent = document.getElementById('fair-roi-content');
            const opportunityNote = document.getElementById('fair-roi-opportunity-note');
            if (riskType === 'oportunidad') {
                roiContent.classList.add('hidden');
                opportunityNote.classList.remove('hidden');
                this.persistFairAnalysis();
                return;
            }
            roiContent.classList.remove('hidden');
            opportunityNote.classList.add('hidden');

            const currency = 'USD';
            const formatCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(value);
            const aleActual = state.fair.simulatedALE || 0;
            document.getElementById('fair-treat-ale-base').textContent = formatCurrency(aleActual);

            const mitigar = {
                cost: getSafeNumber(document.getElementById('fair-costoControlAnual')),
                reductionPercent: getSafeNumber(document.getElementById('fair-reduccionALE')),
                reliability: document.getElementById('fair-mitigar-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-mitigar-retraso')),
            };
            const transferir = {
                premium: getSafeNumber(document.getElementById('fair-seguro-prima')),
                deductible: getSafeNumber(document.getElementById('fair-seguro-deducible')),
                limit: getSafeNumber(document.getElementById('fair-seguro-limite')),
                unlimited: document.getElementById('fair-seguro-sin-limite').checked,
                reliability: document.getElementById('fair-seguro-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-seguro-retraso')),
            };
            const evitar = {
                cost: getSafeNumber(document.getElementById('fair-evitar-costo')),
                reliability: document.getElementById('fair-evitar-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-evitar-retraso')),
            };

            let result;
            try {
                result = await App.Api.request('/api/treatment/evaluate', {
                    method: 'POST',
                    body: { currentALE: aleActual, annualLosses: state.fair.lastAnnualLosses || undefined, mitigar, transferir, evitar, currency },
                });
            } catch (err) {
                showToast(err.userMessage || 'No se pudo calcular el tratamiento del riesgo.');
                return;
            }

            const fiabilidadLabel = { alta: 'Alta', media: 'Media', baja: 'Baja' };

            // 1. Mitigar
            document.getElementById('fair-roi-costo').textContent = formatCurrency(result.mitigar.cost);
            document.getElementById('fair-roi-ale-despues').textContent = formatCurrency(result.mitigar.residualALE);
            document.getElementById('fair-roi-ale-evitada').textContent = formatCurrency(result.mitigar.avoidedLoss);
            const mitigarEl = document.getElementById('fair-roi-resultado');
            mitigarEl.textContent = formatCurrency(result.mitigar.netBenefit);
            mitigarEl.className = `font-bold ${result.mitigar.netBenefit > 0 ? 'text-green-700' : result.mitigar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
            this.renderInvestmentVerdict('fair-roi-rosi', 'fair-mitigar-verdict', result.mitigar.verdict);

            // 2. Transferir / Compartir (seguro) — el backend lo aplica a cada escenario simulado
            // (annualLosses), no al promedio, para un cálculo preciso.
            document.getElementById('fair-seguro-costo').textContent = formatCurrency(result.transferir.cost);
            document.getElementById('fair-seguro-residual').textContent = formatCurrency(result.transferir.residualALE);
            document.getElementById('fair-seguro-evitada').textContent = formatCurrency(result.transferir.avoidedLoss);
            const seguroEl = document.getElementById('fair-seguro-beneficio');
            seguroEl.textContent = formatCurrency(result.transferir.netBenefit);
            seguroEl.className = `font-bold ${result.transferir.netBenefit > 0 ? 'text-green-700' : result.transferir.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
            this.renderInvestmentVerdict('fair-seguro-rosi', 'fair-seguro-verdict', result.transferir.verdict);

            // 3. Evitar
            document.getElementById('fair-evitar-costo-display').textContent = formatCurrency(result.evitar.cost);
            document.getElementById('fair-evitar-evitada').textContent = formatCurrency(result.evitar.avoidedLoss);
            const evitarEl = document.getElementById('fair-evitar-beneficio');
            evitarEl.textContent = formatCurrency(result.evitar.netBenefit);
            evitarEl.className = `font-bold ${result.evitar.netBenefit > 0 ? 'text-green-700' : result.evitar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
            this.renderInvestmentVerdict('fair-evitar-rosi', 'fair-evitar-verdict', result.evitar.verdict);

            // 4. Aceptar / Retener
            const aceptarSuffix = App.UIMode.mode === 'simple' ? '(= lo que perderías si no haces nada)' : '(= ALE actual)';
            document.getElementById('fair-aceptar-residual').textContent = `${formatCurrency(result.aceptar.residualALE)} ${aceptarSuffix}`;

            // Recomendación: la calcula el backend (estrategia activa con mayor beneficio neto,
            // considerando también Fiabilidad y Retraso — Broder, 1984, Cap. 5).
            const recEl = document.getElementById('fair-treatment-recommendation');
            const rec = result.recommendation;
            const stratNames = { mitigar: 'Mitigar', transferir: 'Transferir (Seguro)', evitar: 'Evitar' };
            if (rec.strategy === 'aceptar') {
                recEl.innerHTML = `<p>${sanitizeHTML(rec.reason)}</p>`;
            } else {
                const stratData = result[rec.strategy];
                let advertencia = '';
                if (stratData.reliability === 'baja') {
                    advertencia = ` <strong class="text-orange-700">Atención:</strong> esta opción tiene Fiabilidad Baja — el beneficio neto calculado podría no materializarse si el control falla o no funciona como se espera.`;
                } else if (stratData.delayDays > 90) {
                    advertencia = ` <strong class="text-orange-700">Atención:</strong> el tiempo de implementación es de ${stratData.delayDays} días — el riesgo actual sigue expuesto mientras tanto.`;
                }
                recEl.innerHTML = `<p><strong>Estrategia con mayor beneficio neto: ${stratNames[rec.strategy]}</strong> (${formatCurrency(rec.netBenefit)}/año). Fiabilidad: ${fiabilidadLabel[stratData.reliability] || stratData.reliability}, Tiempo de implementación: ${stratData.delayDays} días.${advertencia} Compara igual el resto de las filas antes de decidir.</p>`;
            }

            this.persistFairAnalysis();
        },

        async displaySimulationResults(result) {
            const { summary, evaluation, sensitivity, annualLosses } = result;
            state.fair.simulatedALE = summary.average;
            state.fair.lastAnnualLosses = annualLosses;
            state.fair.lastEvaluation = evaluation;
            state.fair.lastSeed = result.usedSeed;

            const currency = 'USD';
            const currencySymbol = '$';
            const formatCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

            document.getElementById('ale-result').textContent = formatCurrency(summary.average);
            document.getElementById('median-loss-result').textContent = formatCurrency(summary.median);
            document.getElementById('min-loss-result').textContent = formatCurrency(summary.min);
            document.getElementById('max-loss-result').textContent = formatCurrency(summary.max);
            document.getElementById('percentile-90-result').textContent = `> ${formatCurrency(summary.p90)}`;
            document.getElementById('cvar-95-result').textContent = formatCurrency(summary.cvar95);

            // Evaluación del Riesgo (ISO 31000): ya viene calculada por el backend contra los
            // Criterios de Riesgo guardados — solo se traduce `severity` a clases Tailwind.
            const banner = document.getElementById('fair-evaluation-banner');
            banner.className = `p-4 rounded-lg mb-6 border-l-4 ${severityToClasses(evaluation.severity)}`;
            banner.innerHTML = `
                <p class="font-bold text-lg">Evaluación: ${evaluation.level}</p>
                <p class="text-sm mt-1">${evaluation.justification}</p>
            `;
            this.suggestReviewDate();

            document.getElementById('fair-seed-used').textContent = `Semilla usada: ${result.usedSeed} (anótala para reproducir exactamente esta corrida)`;

            // Análisis de Sensibilidad (RIMS RA.1-2015, 6.3.4.3)
            state.fair.lastSensitivity = sensitivity;
            this.renderSensitivity(sensitivity);

            // Historial de Revisiones (ISO 31000, cláusula 6.6 — Monitoreo): cada corrida de
            // este mismo análisis queda registrada, para ver cómo cambió el riesgo entre revisiones.
            if (!Array.isArray(state.fair.reviewHistory)) state.fair.reviewHistory = [];
            state.fair.reviewHistory.push({
                date: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }),
                ale: formatCurrency(summary.average),
                evaluationLevel: evaluation.level,
            });
            if (state.fair.reviewHistory.length > 20) state.fair.reviewHistory.shift();
            const historyBody = document.getElementById('fair-review-history-body');
            historyBody.innerHTML = state.fair.reviewHistory.map(entry =>
                `<tr class="border-b"><td class="py-1">${entry.date}</td><td>${entry.ale}</td><td>${entry.evaluationLevel}</td></tr>`
            ).join('');
            document.getElementById('fair-review-history-container').classList.toggle('hidden', state.fair.reviewHistory.length < 2);

            // Se guarda en state para que App.UIMode.applyLabels() pueda recalcular este texto
            // si el usuario cambia de Modo Simple/Técnico DESPUÉS de simular — si no, se
            // quedaría con la redacción de cuando corrió la simulación hasta la próxima corrida.
            state.fair.lastThresholdK = `${currencySymbol}${(summary.exceedanceThreshold / 1000)}k`;
            App.UIMode.applyProbThresholdLabel();
            document.getElementById('prob-threshold-result').textContent = `${summary.probExceedance.toFixed(1)}%`;
            await App.FairRegister.saveToRiskRegister(summary, evaluation);

            document.getElementById('fair-roi-section').classList.remove('hidden');
            this.updateTreatmentView();

            const ctx = document.getElementById('fair-results-chart').getContext('2d');
            const numBins = 20;
            const maxLoss = summary.max;
            const binWidth = maxLoss > 0 ? maxLoss / numBins : 1;
            const labels = [];
            for (let i = 0; i < numBins; i++) {
                labels.push(`${(i * binWidth / 1000).toFixed(0)}k`);
            }
            const binCounts = new Array(numBins).fill(0);
            annualLosses.forEach(loss => {
                const binIndex = Math.min(Math.floor(loss / binWidth), numBins - 1);
                binCounts[binIndex]++;
            });
            if (state.fair.fairResultsChart) {
                state.fair.fairResultsChart.destroy();
            }
            state.fair.fairResultsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Frecuencia de Pérdida Anual',
                        data: binCounts,
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Nº de Simulaciones' }
                        },
                        x: {
                            title: { display: true, text: `Pérdida Anual Estimada (miles de ${currency})` },
                            ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: (context) => `Rango de Pérdida: ~${context[0].label}`,
                                label: (context) => `Simulaciones: ${context.parsed.y}`
                            }
                        }
                    }
                }
            });

            this.persistFairAnalysis();
        },

        persistFairAnalysis() {
            try {
                const chart = state.fair.fairResultsChart;
                if (!chart) return;
                const lossFormsKeys = LOSS_FORMS_KEYS;
                const lossForms = {};
                lossFormsKeys.forEach(key => {
                    lossForms[key] = {
                        min: document.getElementById(`lm-${key}-min`).value,
                        mode: document.getElementById(`lm-${key}-mode`).value,
                        max: document.getElementById(`lm-${key}-max`).value,
                    };
                });

                const data = {
                    timestamp: Date.now(),
                    // Bug real: sin esto, "Reanudar análisis guardado" (ver checkForResumableAnalysis/
                    // restoreFairAnalysis) restauraba todos los campos del formulario pero NO el id
                    // que identifica esta entrada en el Registro — al volver a correr la simulación
                    // después de reanudar, saveToRiskRegister() generaba un id nuevo (por no
                    // encontrar ninguno en memoria) y el backend lo trataba como un riesgo distinto,
                    // duplicando la entrada en vez de actualizar la original. Mismo problema de
                    // identidad que loadRegisteredRiskIntoForm() ya resuelve para el botón
                    // "Analizar" de la tabla — aquí faltaba para el botón "Reanudar".
                    registerEntryId: state.fair.registerEntryId || null,
                    sourceRiskId: state.fair.sourceRiskId || null,
                    riskName: document.getElementById('fair-riskName').value,
                    riskDescription: document.getElementById('fair-riskDescription').value,
                    asset: document.getElementById('fair-asset').value,
                    threat: document.getElementById('fair-threat').value,
                    effect: document.getElementById('fair-effect').value,
                    riskType: document.getElementById('fair-risk-type').value,
                    timeHorizon: document.getElementById('fair-time-horizon').value,
                    owner: document.getElementById('fair-owner').value,
                    reviewDate: document.getElementById('fair-review-date').value,
                    assessor: document.getElementById('fair-assessor').value,
                    assessmentDate: document.getElementById('fair-assessment-date').value,
                    assessmentLocation: document.getElementById('fair-assessment-location').value,
                    dataSource: document.getElementById('fair-data-source').value,
                    dataConfidence: document.getElementById('fair-data-confidence').value,
                    dataNotes: document.getElementById('fair-data-notes').value,
                    securityPlan: document.getElementById('fair-security-plan').value,
                    attackerKey: document.getElementById('fair-attacker-profile').value,
                    defenseKey: document.getElementById('fair-defense-profile').value,
                    isDeliberate: document.getElementById('fair-deliberate-threat').checked,
                    deliberateThreatPonderation: document.getElementById('fair-deliberate-ponderation').value,
                    tef: {
                        min: document.getElementById('tef-min').value,
                        mode: document.getElementById('tef-mode').value,
                        max: document.getElementById('tef-max').value,
                    },
                    vuln: {
                        min: document.getElementById('vuln-min').value,
                        mode: document.getElementById('vuln-mode').value,
                        max: document.getElementById('vuln-max').value,
                    },
                    vulnManualOverride: document.getElementById('vuln-manual-override').checked,
                    lossForms: lossForms,
                    lmManualOverride: document.getElementById('lm-manual-override').checked,
                    costoControlAnual: document.getElementById('fair-costoControlAnual').value,
                    reduccionALE: document.getElementById('fair-reduccionALE').value,
                    mitigarDefensaObjetivo: document.getElementById('fair-mitigar-defensa-objetivo').value,
                    reduccionALEManualOverride: document.getElementById('fair-reduccionALE-manual-override').checked,
                    seguroPrima: document.getElementById('fair-seguro-prima').value,
                    seguroDeducible: document.getElementById('fair-seguro-deducible').value,
                    seguroLimite: document.getElementById('fair-seguro-limite').value,
                    seguroSinLimite: document.getElementById('fair-seguro-sin-limite').checked,
                    evitarCosto: document.getElementById('fair-evitar-costo').value,
                    mitigarFiabilidad: document.getElementById('fair-mitigar-fiabilidad').value,
                    mitigarRetraso: document.getElementById('fair-mitigar-retraso').value,
                    seguroFiabilidad: document.getElementById('fair-seguro-fiabilidad').value,
                    seguroRetraso: document.getElementById('fair-seguro-retraso').value,
                    evitarFiabilidad: document.getElementById('fair-evitar-fiabilidad').value,
                    evitarRetraso: document.getElementById('fair-evitar-retraso').value,
                    aceptarJustificacion: document.getElementById('fair-aceptar-justificacion').value,
                    lastSeed: state.fair.lastSeed || null,
                    reviewHistory: state.fair.reviewHistory || [],
                    results: {
                        ale: document.getElementById('ale-result').textContent,
                        median: document.getElementById('median-loss-result').textContent,
                        min: document.getElementById('min-loss-result').textContent,
                        max: document.getElementById('max-loss-result').textContent,
                        p90: document.getElementById('percentile-90-result').textContent,
                        cvar95: document.getElementById('cvar-95-result').textContent,
                        probThresholdLabel: document.getElementById('prob-threshold-label').textContent,
                        probThresholdValue: document.getElementById('prob-threshold-result').textContent,
                        simulatedALE: state.fair.simulatedALE,
                        chartLabels: chart.data.labels,
                        chartData: chart.data.datasets[0].data,
                        currency: 'USD',
                        evaluation: state.fair.lastEvaluation || null,
                        sensitivity: state.fair.lastSensitivity || null,
                        annualLosses: state.fair.lastAnnualLosses || null,
                    },
                };
                localStorage.setItem('fairLastAnalysis', JSON.stringify(data));
                // Plantilla reutilizable: a diferencia de fairLastAnalysis, esta NO se borra al
                // reiniciar el formulario — sirve como base para "Duplicar como Plantilla".
                localStorage.setItem('fairAnalysisTemplate', JSON.stringify(data));
            } catch (e) {
                console.error('No se pudo guardar el análisis FAIR en el navegador:', e);
            }
        },

        // Muestra, sin restaurar nada todavía, el aviso de "tienes un análisis guardado" en el
        // Paso 1 — se llama en cada carga del módulo (App.FairAnalysis.init). Restaurar los
        // campos y saltar al Paso 4 solo ocurre si el usuario hace clic en "Reanudar" (ver
        // bindEvents): así el asistente siempre abre en el Paso 1 salvo acción explícita.
        checkForResumableAnalysis() {
            const banner = document.getElementById('fair-resume-banner');
            try {
                const raw = localStorage.getItem('fairLastAnalysis');
                if (!raw) { banner.classList.add('hidden'); return; }
                const data = JSON.parse(raw);
                const name = data.riskName || 'Riesgo sin nombre';
                const date = data.timestamp ? new Date(data.timestamp).toLocaleString('es-ES') : '';
                document.getElementById('fair-resume-banner-text').textContent =
                    `Tienes un análisis FAIR guardado en este navegador: "${name}"${date ? ' (' + date + ')' : ''}. ¿Deseas continuar donde lo dejaste?`;
                banner.classList.remove('hidden');
            } catch (e) {
                banner.classList.add('hidden');
            }
        },

        restoreFairAnalysis() {
            try {
                const raw = localStorage.getItem('fairLastAnalysis');
                if (!raw) return false;
                const data = JSON.parse(raw);

                // Restaura la identidad de esta entrada en el Registro (ver persistFairAnalysis)
                // ANTES que nada más — si el usuario vuelve a simular tras reanudar, el próximo
                // guardado debe reconocerse como una actualización de la misma entrada, no crear
                // una segunda con el mismo nombre.
                state.fair.registerEntryId = data.registerEntryId || null;
                state.fair.sourceRiskId = data.sourceRiskId || null;

                document.getElementById('fair-riskName').value = data.riskName || '';
                document.getElementById('fair-riskDescription').value = data.riskDescription || '';
                document.getElementById('fair-asset').value = data.asset || '';
                document.getElementById('fair-threat').value = data.threat || '';
                document.getElementById('fair-effect').value = data.effect || 'material';
                document.getElementById('fair-risk-type').value = data.riskType || 'amenaza';
                document.getElementById('fair-time-horizon').value = data.timeHorizon || '1';
                this.toggleRiskTypeLabels();
                document.getElementById('fair-owner').value = data.owner || App.OrgDefaults.defaults.owner;
                document.getElementById('fair-review-date').value = data.reviewDate || '';
                document.getElementById('fair-assessor').value = data.assessor || '';
                document.getElementById('fair-assessment-date').value = data.assessmentDate || '';
                document.getElementById('fair-assessment-location').value = data.assessmentLocation || '';
                document.getElementById('fair-data-source').value = data.dataSource || 'experto-sin-calibrar';
                document.getElementById('fair-data-confidence').value = data.dataConfidence || 'medio';
                document.getElementById('fair-data-notes').value = data.dataNotes || '';
                document.getElementById('fair-security-plan').value = data.securityPlan || '';
                document.getElementById('fair-attacker-profile').value = data.attackerKey || 'empleado-desleal';
                document.getElementById('fair-defense-profile').value = data.defenseKey || 'estandar';
                document.getElementById('fair-deliberate-threat').checked = !!data.isDeliberate;
                document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !data.isDeliberate);
                const ponderacion = parseFloat(data.deliberateThreatPonderation) || 0.7;
                document.getElementById('fair-deliberate-ponderation').value = ponderacion;
                document.getElementById('fair-deliberate-ponderation-value').textContent = `x${ponderacion.toFixed(2)}`;
                this.updateAttackerDefenseSummary();

                if (data.tef) {
                    document.getElementById('tef-min').value = data.tef.min;
                    document.getElementById('tef-mode').value = data.tef.mode;
                    document.getElementById('tef-max').value = data.tef.max;
                    // Ya es un dato real restaurado — que la sugerencia automática (todavía en
                    // vuelo desde el updateAttackerDefenseSummary() de arriba) no lo pise.
                    state.fair.tefManuallyEdited = true;
                }
                if (data.vuln) {
                    document.getElementById('vuln-min').value = data.vuln.min;
                    document.getElementById('vuln-mode').value = data.vuln.mode;
                    document.getElementById('vuln-max').value = data.vuln.max;
                    this.setVulnManualOverride(!!data.vulnManualOverride);
                }
                if (data.lossForms) {
                    this.setLossMagnitudeManualOverride(!!data.lmManualOverride, true);
                    Object.entries(data.lossForms).forEach(([key, vals]) => {
                        const minEl = document.getElementById(`lm-${key}-min`);
                        const modeEl = document.getElementById(`lm-${key}-mode`);
                        const maxEl = document.getElementById(`lm-${key}-max`);
                        if (minEl) minEl.value = vals.min;
                        if (modeEl) modeEl.value = vals.mode;
                        if (maxEl) maxEl.value = vals.max;
                        this.refreshLossMagnitudeCompactDisplay(key);
                    });
                }
                document.getElementById('fair-costoControlAnual').value = data.costoControlAnual || '0';
                document.getElementById('fair-reduccionALE').value = data.reduccionALE || '0';
                document.getElementById('fair-mitigar-defensa-objetivo').value = data.mitigarDefensaObjetivo || 'basica';
                document.getElementById('fair-reduccionALE-manual-override').checked = !!data.reduccionALEManualOverride;
                document.getElementById('fair-reduccionALE').readOnly = !data.reduccionALEManualOverride;
                document.getElementById('fair-reduccionALE').classList.toggle('bg-gray-100', !data.reduccionALEManualOverride);
                document.getElementById('fair-reduccionALE-explanation').classList.toggle('hidden', !!data.reduccionALEManualOverride);
                document.getElementById('fair-seguro-prima').value = data.seguroPrima || '0';
                document.getElementById('fair-seguro-deducible').value = data.seguroDeducible || '0';
                document.getElementById('fair-seguro-limite').value = data.seguroLimite || '0';
                document.getElementById('fair-seguro-sin-limite').checked = !!data.seguroSinLimite;
                document.getElementById('fair-seguro-limite').disabled = !!data.seguroSinLimite;
                document.getElementById('fair-seguro-limite').classList.toggle('bg-gray-100', !!data.seguroSinLimite);
                document.getElementById('fair-evitar-costo').value = data.evitarCosto || '0';
                document.getElementById('fair-mitigar-fiabilidad').value = data.mitigarFiabilidad || 'media';
                document.getElementById('fair-mitigar-retraso').value = data.mitigarRetraso || '0';
                document.getElementById('fair-seguro-fiabilidad').value = data.seguroFiabilidad || 'media';
                document.getElementById('fair-seguro-retraso').value = data.seguroRetraso || '0';
                document.getElementById('fair-evitar-fiabilidad').value = data.evitarFiabilidad || 'alta';
                document.getElementById('fair-evitar-retraso').value = data.evitarRetraso || '0';
                document.getElementById('fair-aceptar-justificacion').value = data.aceptarJustificacion || '';

                if (data.results) {
                    document.getElementById('ale-result').textContent = data.results.ale;
                    document.getElementById('median-loss-result').textContent = data.results.median;
                    document.getElementById('min-loss-result').textContent = data.results.min;
                    document.getElementById('max-loss-result').textContent = data.results.max;
                    document.getElementById('percentile-90-result').textContent = data.results.p90;
                    document.getElementById('cvar-95-result').textContent = data.results.cvar95;
                    document.getElementById('prob-threshold-label').textContent = data.results.probThresholdLabel;
                    document.getElementById('prob-threshold-result').textContent = data.results.probThresholdValue;
                    state.fair.simulatedALE = data.results.simulatedALE || 0;
                    state.fair.lastAnnualLosses = data.results.annualLosses || null;

                    if (data.results.evaluation) {
                        state.fair.lastEvaluation = data.results.evaluation;
                        const banner = document.getElementById('fair-evaluation-banner');
                        banner.className = `p-4 rounded-lg mb-6 border-l-4 ${severityToClasses(data.results.evaluation.severity)}`;
                        banner.innerHTML = `
                            <p class="font-bold text-lg">Evaluación: ${data.results.evaluation.level}</p>
                            <p class="text-sm mt-1">${data.results.evaluation.justification}</p>
                        `;
                    }

                    if (data.results.sensitivity) {
                        state.fair.lastSensitivity = data.results.sensitivity;
                        this.renderSensitivity(data.results.sensitivity);
                    }

                    if (data.lastSeed) {
                        state.fair.lastSeed = data.lastSeed;
                        document.getElementById('fair-seed-used').textContent = `Semilla usada: ${data.lastSeed} (anótala para reproducir exactamente esta corrida)`;
                    }
                    if (Array.isArray(data.reviewHistory)) {
                        state.fair.reviewHistory = data.reviewHistory;
                        document.getElementById('fair-review-history-body').innerHTML = data.reviewHistory.map(entry =>
                            `<tr class="border-b"><td class="py-1">${entry.date}</td><td>${entry.ale}</td><td>${entry.evaluationLevel}</td></tr>`
                        ).join('');
                        document.getElementById('fair-review-history-container').classList.toggle('hidden', data.reviewHistory.length < 2);
                    }

                    document.getElementById('simulation-results-container').classList.remove('hidden');
                    document.getElementById('fair-roi-section').classList.remove('hidden');

                    const ctx = document.getElementById('fair-results-chart').getContext('2d');
                    if (state.fair.fairResultsChart) state.fair.fairResultsChart.destroy();
                    const currency = data.results.currency || 'USD';
                    state.fair.fairResultsChart = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels: data.results.chartLabels,
                            datasets: [{
                                label: 'Frecuencia de Pérdida Anual',
                                data: data.results.chartData,
                                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                                borderColor: 'rgba(54, 162, 235, 1)',
                                borderWidth: 1
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            scales: {
                                y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                                x: { title: { display: true, text: `Pérdida Anual Estimada (miles de ${currency})` }, ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 } }
                            },
                            plugins: {
                                tooltip: {
                                    callbacks: {
                                        title: (context) => `Rango de Pérdida: ~${context[0].label}`,
                                        label: (context) => `Simulaciones: ${context.parsed.y}`
                                    }
                                }
                            }
                        }
                    });

                    this.updateTreatmentView();
                    this.navigateWizard(4, true);
                    showToast('Se restauró tu último análisis FAIR guardado en este navegador.');
                }
                document.getElementById('fair-resume-banner').classList.add('hidden');
                return true;
            } catch (e) {
                console.error('No se pudo restaurar el análisis FAIR guardado:', e);
                return false;
            }
        }

    };

    // ============================================================
    // App.FairRegister — el Registro de Riesgos consolidado: guardar/borrar
    // cada riesgo ya simulado, y el dashboard (mapa de calor, Pareto,
    // sensibilidad consolidada, interpretación general, re-simular un riesgo
    // guardado). Si el bug está en la página "Registro de Riesgos", está aquí.
    // ============================================================
    App.FairRegister = {

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
                // El selector "Riesgo Desencadenante" (Paso 1 de FAIR) vive fuera de esta
                // página — se refresca aquí, no solo cuando se dibuja el Registro, para que
                // tenga la lista al día sin importar por dónde haya entrado el usuario.
                App.FairWizard.populateTriggeredByOptions();
                state.fair.registerPareto = registerData.pareto || null;
                state.fair.registerConsolidatedSensitivity = registerData.consolidatedSensitivity || [];
                state.fair.registerHeatmapZones = registerData.heatmapZones || [];
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
        classifyAleAgainstCriteria(ale) {
            const criteria = state.config.riskCriteria;
            if (!criteria || typeof ale !== 'number') return null;
            if (ale > criteria.aleCritico) return 'critico';
            if (ale > criteria.aleAceptable) return 'alto';
            return 'bajo';
        },

        // La clasificación (Bajo/Medio/Alto/Crítico) no se repite aquí — ya la muestra la
        // columna "Evaluación" (evaluateFairThreat, en el backend); tener una "Categoría" aparte
        // solo duplicaba esa misma severidad con otro formato.
        // Solo aplica a riesgos tipo Amenaza: uno de tipo Oportunidad es un beneficio esperado,
        // no una pérdida, y no tiene un "Riesgo Inherente/Residual" con el mismo sentido.
        computeFairRiskEquivalents(entry) {
            if (!entry || entry.riskType === 'oportunidad' || typeof entry.ale !== 'number') return null;
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
            const vulnMode = entry.vuln && entry.vuln.mode;
            const inherentAle = (vulnMode && vulnMode > 0) ? entry.ale * (100 / vulnMode) : null;

            return {
                residualMoney: fmt(entry.ale),
                residualSeverity: entry.severity || null,
                inherentMoney: inherentAle != null ? fmt(inherentAle) : null,
                inherentSeverity: inherentAle != null ? this.classifyAleAgainstCriteria(inherentAle) : null,
                controlEffectiveness: vulnMode != null ? `${(100 - vulnMode).toFixed(1)}%` : null,
            };
        },

        buildConcentratedList(risks, register) {
            const merged = risks.map(risk => {
                const fairEntry = register.find(r => r.sourceRiskId === risk.id) || null;
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
                    riesgoInherente: fairEquiv ? fairEquiv.inherentMoney : (risk.ri || null),
                    riesgoInherenteSeverity: fairEquiv ? fairEquiv.inherentSeverity : null,
                    riesgoResidual: fairEquiv ? fairEquiv.residualMoney : (risk.rrt || null),
                    riesgoResidualSeverity: fairEquiv ? fairEquiv.residualSeverity : null,
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

            const linkedRiskIds = new Set(merged.map(item => item.id));
            register.forEach(reg => {
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
                        riesgoResidual: fairEquiv ? fairEquiv.residualMoney : null,
                        riesgoResidualSeverity: fairEquiv ? fairEquiv.residualSeverity : null,
                        controlEffectiveness: fairEquiv ? fairEquiv.controlEffectiveness : null,
                        asset: reg.asset,
                        fairEntry: reg,
                    });
                }
            });

            merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            merged.forEach((item, i) => { item.number = i + 1; });
            return merged;
        },

        // --- Registro de Riesgos (RIMS RA.1-2015, 6.4.4.3): cada riesgo FAIR ya analizado queda
        // guardado aquí automáticamente al correr su simulación, para poder verlos todos juntos
        // en un mapa de calor — en vez de que cada análisis viva aislado del resto.
        // Guarda/actualiza este riesgo en el Registro del backend justo después de una
        // simulación exitosa (PUT /api/register/:riskName). Idempotente por id/sourceRiskId
        // cuando se conocen (ver findRegisterEntryIndex en el backend) — riskName en la URL es
        // solo el punto de entrada, no la identidad real de la entrada.
        async saveToRiskRegister(summary, evaluation) {
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
            LOSS_FORMS_KEYS.forEach((key) => { lossMagnitudes[key] = readRange(`lm-${key}`); });

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

            // Igual que en updateTreatmentView() — se leen tal cual, sin importar si esa función
            // ya corrió o no (los campos existen en el DOM de todas formas). Se guardan aquí
            // para que el Informe Consolidado pueda reconstruir la Sección 9 (Tratamiento) de
            // CUALQUIER riesgo guardado, no solo el que esté abierto en este momento.
            const mitigar = {
                cost: getSafeNumber(document.getElementById('fair-costoControlAnual')),
                reductionPercent: getSafeNumber(document.getElementById('fair-reduccionALE')),
                reliability: document.getElementById('fair-mitigar-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-mitigar-retraso')),
            };
            const transferir = {
                premium: getSafeNumber(document.getElementById('fair-seguro-prima')),
                deductible: getSafeNumber(document.getElementById('fair-seguro-deducible')),
                limit: getSafeNumber(document.getElementById('fair-seguro-limite')),
                unlimited: document.getElementById('fair-seguro-sin-limite').checked,
                reliability: document.getElementById('fair-seguro-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-seguro-retraso')),
            };
            const evitar = {
                cost: getSafeNumber(document.getElementById('fair-evitar-costo')),
                reliability: document.getElementById('fair-evitar-fiabilidad').value,
                delayDays: getSafeNumber(document.getElementById('fair-evitar-retraso')),
            };
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
                        owner: document.getElementById('fair-owner').value.trim() || '—',
                        ale: summary.average,
                        cvar95: summary.cvar95,
                        median: summary.median,
                        min: summary.min,
                        max: summary.max,
                        p90: summary.p90,
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
                        securityPlan: document.getElementById('fair-security-plan').value.trim() || '—',
                        tef: readRange('tef'),
                        vuln: readRange('vuln'),
                        lossMagnitudes,
                        seed: state.fair.lastSeed || null,
                        riskType: document.getElementById('fair-risk-type').value,
                        // Vincula esta entrada del Registro con el riesgo de Análisis Rápido del
                        // que salió (si vino de ahí) — ver App.FairWizard.loadRiskIntoForm y
                        // App.FairRegister.buildConcentratedList.
                        sourceRiskId: state.fair.sourceRiskId || null,
                        // Riesgo en cascada (Paso 1, "Riesgo Desencadenante") — solo organizativo
                        // por ahora, ver el campo en el HTML para el detalle.
                        triggeredByRiskName: document.getElementById('fair-triggered-by').value || null,
                        description: document.getElementById('fair-riskDescription').value.trim() || null,
                        // A partir de aquí: campos que antes solo vivían en este formulario (o en
                        // el Reporte individual, leídos directo del DOM) — se guardan para que el
                        // Informe Consolidado pueda reconstruir el reporte completo de CUALQUIER
                        // riesgo del Registro, no solo el que esté abierto ahora mismo.
                        threat: document.getElementById('fair-threat').value.trim() || '—',
                        effect: document.getElementById('fair-effect').value,
                        timeHorizon: document.getElementById('fair-time-horizon').value,
                        reviewDate: document.getElementById('fair-review-date').value || null,
                        dataSource: document.getElementById('fair-data-source').value,
                        dataConfidence: document.getElementById('fair-data-confidence').value,
                        dataNotes: document.getElementById('fair-data-notes').value.trim() || null,
                        assessor: document.getElementById('fair-assessor').value.trim() || null,
                        assessmentDate: document.getElementById('fair-assessment-date').value || null,
                        assessmentLocation: document.getElementById('fair-assessment-location').value.trim() || null,
                        attackerProfileName: attackerProfile.name || null,
                        attackerScore: state.fair.attackerScore || null,
                        defenseProfileName: defenseProfile.name || null,
                        defenseScore: state.fair.defenseScore || null,
                        mitigar, transferir, evitar,
                        aceptarJustificacion: document.getElementById('fair-aceptar-justificacion').value.trim() || null,
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
            const threatRegister = register.filter(r => r.riskType !== 'oportunidad');
            const opportunityCount = register.length - threatRegister.length;

            // Las zonas del mapa de calor (colores + rangos) ya vienen del backend en la
            // respuesta de GET /api/register — solo falta el color del texto, que es
            // puramente presentación (blanco sobre fondos oscuros, negro sobre claros).
            const textColorByLevel = { 'Bajo': '#000', 'Medio': '#000', 'Alto': '#fff', 'Crítico': '#fff' };
            const canvas = document.getElementById('fair-register-chart');
            const matrixBackgroundPlugin = {
                id: 'fairRegisterMatrixBackground',
                beforeDatasetsDraw(chart) {
                    const { ctx, scales: { x, y } } = chart;
                    ctx.save();
                    const zones = state.fair.registerHeatmapZones || [];
                    zones.forEach(zone => {
                        ctx.fillStyle = zone.color;
                        ctx.fillRect(x.getPixelForValue(zone.x[0]), y.getPixelForValue(zone.y[1]), x.getPixelForValue(zone.x[1]) - x.getPixelForValue(zone.x[0]), y.getPixelForValue(zone.y[0]) - y.getPixelForValue(zone.y[1]));
                    });
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    zones.forEach(zone => {
                        const midX = x.getPixelForValue((zone.x[0] + zone.x[1]) / 2);
                        const midY = y.getPixelForValue((zone.y[0] + zone.y[1]) / 2);
                        ctx.fillStyle = textColorByLevel[zone.level] || '#000';
                        ctx.fillText(zone.level, midX, midY);
                    });
                    ctx.restore();
                }
            };

            // Cada punto lleva su número (1, 2, 3...) encima, en el mismo orden que el registro
            // — así se puede identificar cuál riesgo es cuál sin adivinar por posición o color.
            // Se dibuja después de los puntos (afterDatasetsDraw) para que quede legible arriba,
            // no debajo del círculo morado.
            const pointNumberPlugin = {
                id: 'fairRegisterPointNumbers',
                afterDatasetsDraw(chart) {
                    const { ctx, scales: { x, y } } = chart;
                    ctx.save();
                    ctx.font = 'bold 11px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#fff';
                    threatRegister.forEach((r, i) => {
                        ctx.fillText(String(i + 1), x.getPixelForValue(r.impactPercent), y.getPixelForValue(r.probabilityPercent));
                    });
                    ctx.restore();
                }
            };
            document.getElementById('fair-register-legend').innerHTML = `
                <p class="font-semibold text-gray-700 mb-2">Riesgos en el mapa</p>
                <ol class="space-y-1">
                    ${threatRegister.map((r, i) => `<li><span style="display:inline-block;width:8px;height:8px;border-radius:9999px;margin-right:4px;background-color:${severityToHex(r.severity)}"></span><strong>${i + 1}.</strong> ${sanitizeHTML(r.riskName)}</li>`).join('')}
                </ol>
                ${opportunityCount > 0 ? `<p class="text-xs text-gray-500 mt-2">${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'} no se muestra${opportunityCount === 1 ? '' : 'n'} aquí — un beneficio esperado no es un riesgo a tratar. Están en la tabla de abajo.</p>` : ''}`;

            if (state.fair.registerChart) state.fair.registerChart.destroy();
            state.fair.registerChart = new Chart(canvas, {
                type: 'scatter',
                data: {
                    datasets: [{
                        label: 'Riesgos FAIR',
                        // Antes cada punto era del mismo morado fijo sin importar qué tan grave
                        // fuera el riesgo — el color solo venía del fondo por cuadrante (zona),
                        // no del punto en sí. Ahora cada punto usa el mismo color que ya tiene su
                        // badge de Evaluación en la tabla/PDF (severity: crítico/alto/medio/bajo).
                        data: threatRegister.map(r => ({ x: r.impactPercent, y: r.probabilityPercent, name: r.riskName, level: r.evaluationLevel })),
                        pointBackgroundColor: threatRegister.map(r => severityToHex(r.severity)),
                        pointBorderColor: 'white',
                        pointRadius: 10,
                        pointHoverRadius: 13,
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { title: { display: true, text: 'Impacto (ALE como % del umbral Crítico)' }, min: 0, max: 100, ticks: { stepSize: 25 } },
                        y: { title: { display: true, text: 'Probabilidad de superar el umbral de excedencia (%)' }, min: 0, max: 100, ticks: { stepSize: 25 } },
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.dataIndex + 1}. ${context.raw.name}: Impacto ${context.raw.x.toFixed(0)}%, Probabilidad ${context.raw.y.toFixed(0)}% — ${context.raw.level}`
                            }
                        }
                    }
                },
                plugins: [matrixBackgroundPlugin, pointNumberPlugin]
            });

            this.renderParetoChart();
            this.renderConsolidatedSensitivity();
        },

        // Dibuja la tabla concentrada (#quick-concentrated-table-body, en Análisis de Riesgo) —
        // antes se dibujaba TAMBIÉN en Registro de Riesgos, en una copia idéntica del mismo DOM;
        // se quitó esa copia (ver #registerPage en el HTML) para no tener la misma información
        // dos veces. Une lo que ya pasó por FAIR con lo que todavía está solo en Vista Rápida
        // (ver buildConcentratedList), e incluye tanto las columnas del viejo Historial (Riesgo
        // Inherente/Residual/Categoría, por RRt%) como las del Registro (Etapa/Impacto/CVaR/
        // Evaluación, por FAIR) — ningún dato se pierde al fusionar las dos tablas que existían
        // antes por separado.
        renderConcentratedTable(list) {
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
            const formatDate = (d) => d ? new Date(d).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
            const bodies = ['quick-concentrated-table-body']
                .map(id => document.getElementById(id))
                .filter(Boolean);

            if (list.length === 0) {
                bodies.forEach(tb => { tb.innerHTML = '<tr><td colspan="13" class="text-center py-4 text-gray-500">No hay riesgos guardados.</td></tr>'; });
                return;
            }

            const rowsHTML = list.map(item => {
                const stageBadge = item.stage === 'fair'
                    ? `<span class="px-2 py-1 rounded text-xs bg-blue-50 text-blue-700 border-l-4 border-blue-500">Analizado (FAIR)</span>`
                    : `<span class="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 border-l-4 border-gray-400">Triage</span>`;

                const evalCell = item.fairEntry
                    ? `<span class="px-2 py-1 rounded text-xs border-l-4 ${item.fairEntry.evaluationClasses}">${item.fairEntry.evaluationLevel}</span>`
                    : '—';

                // Mismo Criterio ALE que ya usa "Evaluación" — cada monto se colorea según ESE
                // mismo umbral (ver computeFairRiskEquivalents), para que un riesgo "Crítico" se
                // vea igual de rojo en Inherente/Residual/Impacto que en Evaluación, no distinto.
                const moneyBadge = (text, severity) => (text && severity)
                    ? `<span class="px-2 py-1 rounded text-xs border-l-4 ${severityToClasses(severity)}">${text}</span>`
                    : (text || '—');

                const inherenteCell = moneyBadge(item.riesgoInherente, item.riesgoInherenteSeverity);
                const residualCell = moneyBadge(item.riesgoResidual, item.riesgoResidualSeverity);
                const impactCell = item.fairEntry
                    ? moneyBadge(fmt(item.fairEntry.ale), item.fairEntry.severity)
                    : (item.quickAle || '—');
                const cvarCell = item.fairEntry ? fmt(item.fairEntry.cvar95) : '—';
                const dateCell = formatDate(item.fairEntry ? item.fairEntry.date : item.createdAt);

                // Selecciona uno o más riesgos (cualquier etapa) para verlos en "Análisis
                // Profundo" — ver showDeepAnalysis(). rowKey es estable: el id de la entrada de
                // FAIR si ya existe, o el id del riesgo de Análisis Rápido si todavía no.
                const checkboxCell = item.rowKey
                    ? `<input type="checkbox" class="concentrated-checkbox" data-id="${item.rowKey}" />`
                    : '';

                // "Analizar" abre el wizard completo de FAIR (pasos 1-4, incluyendo Tratamiento)
                // para ESTE riesgo — a diferencia de "Simular" (un vistazo rápido de solo lectura
                // sin salir del Registro). Es la vista de detalle por riesgo.
                const actionsCell = item.stage === 'fair'
                    ? `<button class="btn btn-primary text-xs" data-analyze-fair="${sanitizeHTML(item.fairEntry.riskName)}"><i class="fas fa-balance-scale mr-1"></i>Analizar</button>
                        <button class="btn btn-secondary text-xs ml-1" data-simulate-risk="${sanitizeHTML(item.fairEntry.riskName)}" ${item.fairEntry.tef && item.fairEntry.vuln && item.fairEntry.lossMagnitudes ? '' : 'disabled title="Este riesgo se guardó antes de esta función — vuelve a correr su simulación desde Análisis FAIR para poder verla aquí."'}>
                            <i class="fas fa-chart-bar mr-1"></i>Simular
                        </button>
                        <button class="inline-flex items-center justify-center p-2 text-red-600 hover:text-red-800 text-sm ml-2" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-risk="${sanitizeHTML(item.fairEntry.riskName)}" data-delete-source-id="${item.id || ''}" data-delete-entry-id="${item.fairEntry.id || ''}"><i class="fas fa-trash"></i></button>`
                    : `<button class="btn btn-primary text-xs" data-analyze-quick="${item.id}" ${item.fullData ? '' : 'disabled title="No se encontró la información completa de este riesgo."'}><i class="fas fa-balance-scale mr-1"></i>Analizar con FAIR</button>
                        <button class="inline-flex items-center justify-center p-2 text-red-600 hover:text-red-800 text-sm ml-2" title="Eliminar riesgo" aria-label="Eliminar riesgo" data-delete-quick="${item.id}"><i class="fas fa-trash"></i></button>`;

                return `
                    <tr class="border-b">
                        <td class="py-2 text-center">${checkboxCell}</td>
                        <td class="text-center text-gray-500">${item.number}</td>
                        <td>${sanitizeHTML(item.riskName)}</td>
                        <td>${stageBadge}</td>
                        <td>${inherenteCell}</td>
                        <td>${item.controlEffectiveness || '—'}</td>
                        <td>${residualCell}</td>
                        <td>${sanitizeHTML(item.asset)}</td>
                        <td>${impactCell}</td>
                        <td>${cvarCell}</td>
                        <td>${evalCell}</td>
                        <td>${dateCell}</td>
                        <td class="whitespace-nowrap">${actionsCell}</td>
                    </tr>`;
            }).join('');

            bodies.forEach(tb => { tb.innerHTML = rowsHTML; });

            document.querySelectorAll('[data-delete-risk]').forEach(btn => {
                btn.addEventListener('click', () => this.deleteConcentratedRisk({ riskName: btn.dataset.deleteRisk, sourceId: btn.dataset.deleteSourceId || null, entryId: btn.dataset.deleteEntryId || null }));
            });
            document.querySelectorAll('[data-simulate-risk]').forEach(btn => {
                btn.addEventListener('click', () => this.simulateRegisteredRisk(btn.dataset.simulateRisk));
            });
            document.querySelectorAll('[data-delete-quick]').forEach(btn => {
                btn.addEventListener('click', () => this.deleteConcentratedRisk({ riskName: null, sourceId: btn.dataset.deleteQuick }));
            });
            document.querySelectorAll('[data-analyze-fair]').forEach(btn => {
                btn.addEventListener('click', () => {
                    App.Navigation.switchPage('fair');
                    App.FairWizard.loadRegisteredRiskIntoForm(btn.dataset.analyzeFair);
                });
            });
            document.querySelectorAll('[data-analyze-quick]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = (state.fair.concentratedRisks || []).find(x => x.id === btn.dataset.analyzeQuick);
                    if (!item || !item.fullData) {
                        showToast('No se encontró la información de este riesgo.');
                        return;
                    }
                    App.Navigation.switchPage('fair');
                    App.FairAnalysis.receiveData([item.fullData]);
                });
            });
            document.querySelectorAll('.concentrated-checkbox').forEach(cb => {
                cb.addEventListener('change', () => this.updateDeepAnalysisBtnState());
            });
            this.updateDeepAnalysisBtnState();
        },

        toggleSelectAll(tbodyId, checked) {
            document.querySelectorAll(`#${tbodyId} .concentrated-checkbox`).forEach(cb => { cb.checked = checked; });
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
            const selectedKeys = Array.from(document.querySelectorAll(`#${tbodyId} .concentrated-checkbox:checked`)).map(cb => cb.dataset.id);
            const selectedItems = (state.fair.concentratedRisks || []).filter(item => selectedKeys.includes(String(item.rowKey)));
            if (selectedItems.length === 0) return;

            document.getElementById('fair-deep-analysis-body').innerHTML = selectedItems.map(item => this.buildDeepAnalysisCard(item)).join('');
            document.getElementById('fair-deep-analysis-panel').classList.remove('hidden');
            document.getElementById('fair-deep-analysis-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        buildDeepAnalysisCard(item) {
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
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
                            ${hasLegacyEstimate ? `
                            <li><strong>Riesgo Inherente:</strong> ${item.riesgoInherente ?? '—'}</li>
                            <li><strong>Riesgo Residual:</strong> ${item.riesgoResidual ?? '—'}</li>
                            <li><strong>ALE estimado:</strong> ${item.quickAle || '—'}</li>` : ''}
                        </ul>
                    </div>`;
            }

            const rangeRow = (label, range, suffix = '') => range
                ? `<tr><td class="py-1 pr-3 text-gray-600">${label}</td><td class="py-1 pr-3">${range.min}${suffix}</td><td class="py-1 pr-3 font-semibold">${range.mode}${suffix}</td><td class="py-1">${range.max}${suffix}</td></tr>`
                : '';
            const lossRows = entry.lossMagnitudes
                ? LOSS_FORMS_KEYS.map((key) => {
                    const f = entry.lossMagnitudes[key];
                    if (!f) return '';
                    return `<tr><td class="py-1 pr-3 text-gray-600">${LOSS_FORM_LABELS.tecnico[key]}</td><td class="py-1 pr-3">${fmt(f.min)}</td><td class="py-1 pr-3 font-semibold">${fmt(f.mode)}</td><td class="py-1">${fmt(f.max)}</td></tr>`;
                }).join('')
                : '';
            const sensitivityHTML = (entry.sensitivity || []).slice(0, 5)
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
                        <li><strong>Pérdida Anual Esperada (ALE):</strong> ${fmt(entry.ale)}</li>
                        <li><strong>CVaR 95%:</strong> ${fmt(entry.cvar95)}</li>
                        ${item.riesgoInherente ? `<li><strong>Riesgo Inherente (sin controles):</strong> ${item.riesgoInherente}</li>` : ''}
                        ${item.controlEffectiveness ? `<li><strong>Efectividad de Controles:</strong> ${item.controlEffectiveness}</li>` : ''}
                        <li><strong>Fecha del análisis:</strong> ${entry.date ? new Date(entry.date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</li>
                        ${entry.evaluationJustification ? `<li><strong>Justificación:</strong> ${sanitizeHTML(entry.evaluationJustification)}</li>` : ''}
                    </ul>
                    ${(entry.tef || entry.vuln) ? `
                    <table class="w-full text-sm mb-3">
                        <thead><tr class="text-left text-gray-500"><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr></thead>
                        <tbody>
                            ${rangeRow('Frecuencia de Evento de Amenaza (contactos/año)', entry.tef)}
                            ${rangeRow('Vulnerabilidad', entry.vuln, '%')}
                        </tbody>
                    </table>` : ''}
                    ${lossRows ? `
                    <h5 class="text-sm font-semibold text-gray-800 mb-1">Magnitud de Pérdida</h5>
                    <table class="w-full text-sm mb-3">
                        <thead><tr class="text-left text-gray-500"><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr></thead>
                        <tbody>${lossRows}</tbody>
                    </table>` : ''}
                    ${sensitivityHTML ? `
                    <h5 class="text-sm font-semibold text-gray-800 mb-1">Variables más influyentes</h5>
                    <ul class="text-sm text-gray-700 list-disc list-inside">${sensitivityHTML}</ul>` : ''}
                </div>`;
        },

        // El Pareto 80-20 (ordenado, con % acumulado) ya viene calculado del backend
        // (GET /api/register → pareto) — aquí solo se dibuja.
        renderParetoChart() {
            const pareto = state.fair.registerPareto;
            if (!pareto) return;
            const formatCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

            document.getElementById('fair-pareto-summary').textContent =
                `${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount} riesgo(s) concentran el 80% de tu exposición total (${formatCurrency(pareto.totalExposure)}/año). Prioriza el tratamiento en esos primero.`;

            const canvas = document.getElementById('fair-pareto-chart');
            if (state.fair.paretoChart) state.fair.paretoChart.destroy();
            state.fair.paretoChart = new Chart(canvas, {
                // Chart.js exige un "type" a nivel raíz incluso en gráficos mixtos (cada dataset
                // ya trae el suyo) — sin esto no lanza error, simplemente no dibuja nada, que es
                // justo lo que pasaba aquí.
                type: 'bar',
                data: {
                    labels: pareto.risks.map(r => r.riskName),
                    datasets: [
                        {
                            type: 'bar',
                            label: 'Pérdida Anual Esperada',
                            data: pareto.risks.map(r => r.ale),
                            backgroundColor: 'rgba(124, 58, 237, 0.6)',
                            yAxisID: 'y',
                        },
                        {
                            type: 'line',
                            label: '% Acumulado',
                            data: pareto.risks.map(r => r.cumulativePercent),
                            borderColor: '#B22222',
                            backgroundColor: '#B22222',
                            yAxisID: 'y1',
                            tension: 0.1,
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Pérdida Anual Esperada' }, ticks: { callback: (v) => formatCurrency(v) } },
                        y1: { position: 'right', beginAtZero: true, max: 100, title: { display: true, text: '% Acumulado' }, grid: { drawOnChartArea: false } },
                        x: { ticks: { maxRotation: 45, minRotation: 45 } },
                    },
                    plugins: { legend: { position: 'bottom' } }
                }
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
            const maxVal = Math.max(...averaged.map(a => a.averageCorrelation), 0.0001);
            container.innerHTML = averaged.map(a => {
                const pct = Math.max(2, Math.round((a.averageCorrelation / maxVal) * 100));
                return `
                    <div class="mb-2">
                        <div class="flex justify-between text-sm"><span>${sensitivityLabel(a)}</span><span>${(a.averageCorrelation * 100).toFixed(1)}%</span></div>
                        <div class="w-full bg-gray-200 rounded h-2"><div class="h-2 rounded bg-purple-600" style="width:${pct}%;"></div></div>
                    </div>`;
            }).join('');
        },

        // Re-simula un riesgo ya guardado usando sus inputs originales (tef/vuln/lossMagnitudes)
        // y su semilla — misma reproducibilidad exacta que documenta /api/simulate. Siempre a
        // 10,000 iteraciones (tope único para todas las simulaciones, ver backend/validate.js).
        async simulateRegisteredRisk(riskName) {
            const risk = (state.fair.riskRegister || []).find(r => r.riskName === riskName);
            if (!risk || !risk.tef || !risk.vuln || !risk.lossMagnitudes) {
                showToast('Este riesgo no tiene los datos guardados para re-simular. Vuelve a correrlo desde Análisis FAIR.');
                return;
            }

            const section = document.getElementById('fair-register-simulation');
            const loading = document.getElementById('fair-register-simulation-loading');
            const body = document.getElementById('fair-register-simulation-body');
            document.getElementById('fair-register-simulation-title').textContent = `Simulación Detallada: ${risk.riskName}`;
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

            const formatCurrency = (v) => `$${Math.round(v).toLocaleString('en-US')}`;
            document.getElementById('fair-register-sim-ale').textContent = formatCurrency(result.summary.average);
            document.getElementById('fair-register-sim-median').textContent = formatCurrency(result.summary.median);
            document.getElementById('fair-register-sim-p90').textContent = formatCurrency(result.summary.p90);
            document.getElementById('fair-register-sim-cvar').textContent = formatCurrency(result.summary.cvar95);

            const sensContainer = document.getElementById('fair-register-sim-sensitivity');
            const top = (result.sensitivity || []).slice(0, 5);
            const maxAbs = Math.max(...top.map(s => Math.abs(s.correlation)), 0.0001);
            sensContainer.innerHTML = top.map(s => {
                const pct = Math.max(2, Math.round((Math.abs(s.correlation) / maxAbs) * 100));
                const color = s.correlation >= 0 ? '#3B82F6' : '#EF4444';
                return `
                    <div class="mb-2">
                        <div class="flex justify-between text-sm"><span>${sensitivityLabel(s)}</span><span>${(s.correlation * 100).toFixed(1)}%</span></div>
                        <div class="w-full bg-gray-200 rounded h-2"><div class="h-2 rounded" style="width:${pct}%; background-color:${color};"></div></div>
                    </div>`;
            }).join('');

            // Histograma — mismo binning que el de Análisis FAIR (ver runMonteCarloSimulation).
            const ctx = document.getElementById('fair-register-sim-chart').getContext('2d');
            const numBins = 20;
            const maxLoss = result.summary.max;
            const binWidth = maxLoss > 0 ? maxLoss / numBins : 1;
            const labels = [];
            for (let i = 0; i < numBins; i++) labels.push(`${(i * binWidth / 1000).toFixed(0)}k`);
            const binCounts = new Array(numBins).fill(0);
            result.annualLosses.forEach(loss => {
                const binIndex = Math.min(Math.floor(loss / binWidth), numBins - 1);
                binCounts[binIndex]++;
            });
            if (state.fair.registerSimChart) state.fair.registerSimChart.destroy();
            state.fair.registerSimChart = new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Frecuencia de Pérdida Anual', data: binCounts, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                        x: { title: { display: true, text: 'Pérdida Anual Estimada (miles de USD)' }, ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 } },
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
            const threatRegister = register.filter(r => r.riskType !== 'oportunidad');
            const opportunityCount = register.length - threatRegister.length;
            threatRegister.forEach(r => {
                if (r.severity && bySeverity[r.severity] !== undefined) bySeverity[r.severity]++;
            });
            const formatCurrency = (v) => `$${Math.round(v).toLocaleString('en-US')}`;

            const parts = [];
            if (threatRegister.length > 0) {
                parts.push(`Tienes <strong>${threatRegister.length}</strong> amenaza${threatRegister.length === 1 ? '' : 's'} guardada${threatRegister.length === 1 ? '' : 's'}: ` +
                    Object.entries(bySeverity).filter(([, n]) => n > 0).map(([sev, n]) => `${n} en nivel <strong>${severityLabels[sev]}</strong>`).join(', ') +
                    (opportunityCount > 0 ? ` (+ ${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'}, ver tabla abajo).` : '.'));
            } else {
                parts.push(`Tienes <strong>${opportunityCount}</strong> oportunidad${opportunityCount === 1 ? '' : 'es'} guardada${opportunityCount === 1 ? '' : 's'} y ninguna amenaza — ver tabla abajo.`);
            }

            if (pareto && pareto.risks.length > 0) {
                const topNames = pareto.risks.slice(0, pareto.riskCountFor80Percent).map(r => sanitizeHTML(r.riskName));
                const exposicionTexto = `el 80% de tu exposición total (${formatCurrency(pareto.totalExposure)}/año)`;
                parts.push(`<strong>${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount}</strong> riesgo${pareto.riskCountFor80Percent === 1 ? '' : 's'} (${topNames.join(', ')}) concentra${pareto.riskCountFor80Percent === 1 ? '' : 'n'} ${exposicionTexto} — prioriza el tratamiento ahí antes que en los demás.`);
            }

            const topSensitivity = (state.fair.registerConsolidatedSensitivity || [])[0];
            if (topSensitivity) {
                parts.push(`La variable que más mueve tus resultados, en promedio, es <strong>"${sensitivityLabel(topSensitivity)}"</strong> — mejorar la calidad de ese dato es donde más rendiría tu esfuerzo.`);
            }

            container.innerHTML = parts.map(p => `<p class="mb-2">${p}</p>`).join('');
        },

    };

    // ============================================================
    // App.FairExport — arma el HTML imprimible y dispara window.print() para el Informe
    // Consolidado (único PDF de la app: portafolio + detalle completo de cada riesgo). Antes
    // había dos reportes separados (uno de un solo riesgo, leído del formulario en pantalla, y
    // uno consolidado con solo una tarjeta resumida por riesgo) — se fusionaron en uno solo
    // porque el Registro ya guarda todo lo necesario (ver App.FairRegister.saveToRiskRegister)
    // para reconstruir el detalle completo de CUALQUIER riesgo guardado, no solo el que esté
    // abierto en el wizard. Si el bug está en el PDF exportado, está aquí.
    // ============================================================
    App.FairExport = {

        // Mismos labels que los <select> del Paso 1/2 — se necesitan aquí porque el riesgo del
        // que se arma cada sección del reporte puede NO ser el que está abierto en el wizard
        // (viene del Registro guardado), así que no hay <select> del que leer el texto visible.
        EFFECT_LABELS: {
            material: 'Pérdida o Daño Material',
            personas: 'Impacto a la Integridad de las Personas',
            operativo: 'Interrupción Operativa',
            reputacional: 'Daño Reputacional',
        },
        DATA_SOURCE_LABELS: {
            historico: 'Histórico interno de incidentes',
            benchmark: 'Benchmark / referencia externa del sector',
            'experto-calibrado': 'Juicio experto calibrado (rangos de 3 puntos)',
            'experto-sin-calibrar': 'Juicio experto sin calibrar',
        },
        DATA_CONFIDENCE_LABELS: { alto: 'Alto', medio: 'Medio', bajo: 'Bajo' },
        RELIABILITY_LABELS: { alta: 'Alta', media: 'Media', baja: 'Baja' },

        // Redibuja, fuera de pantalla, el histograma de un riesgo YA guardado (a partir de
        // chartLabels/chartData del Registro — ver saveToRiskRegister) para poder incluirlo en
        // el reporte de CUALQUIER riesgo, no solo el que tiene el <canvas> real visible ahora
        // mismo. animation:false porque toDataURL() se llama en el siguiente frame — con
        // animación encendida capturaría un fotograma a medio dibujar (barras incompletas).
        renderOffscreenHistogram(labels, data) {
            return new Promise((resolve) => {
                const canvas = document.createElement('canvas');
                canvas.width = 700;
                canvas.height = 350;
                canvas.style.position = 'fixed';
                canvas.style.left = '-9999px';
                document.body.appendChild(canvas);
                const chart = new Chart(canvas, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{ label: 'Frecuencia de Pérdida Anual', data, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }],
                    },
                    options: {
                        responsive: false, animation: false,
                        scales: {
                            y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                            x: { title: { display: true, text: 'Pérdida Anual Estimada' }, ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 } },
                        },
                    },
                });
                requestAnimationFrame(() => {
                    const img = canvas.toDataURL('image/png');
                    chart.destroy();
                    canvas.remove();
                    resolve(img);
                });
            });
        },

        // El detalle técnico completo de UN riesgo del Registro (Alcance, Gobernanza, Perfil de
        // Atacante/Defensa, Frecuencia/Vulnerabilidad, Magnitud de Pérdida, Simulación,
        // Evaluación, Sensibilidad, Tratamiento) — antes esto era el reporte de un solo riesgo,
        // aparte del Informe Consolidado; ahora es una sección más dentro de ese mismo informe,
        // una por cada riesgo guardado (ver exportConsolidatedReport). Async porque recalcula el
        // Tratamiento (POST /api/treatment/evaluate) y puede regenerar el histograma.
        async buildFullRiskReportSection(r, index) {
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
            const riskTypeLabel = r.riskType === 'oportunidad' ? 'Oportunidad (riesgo positivo)' : 'Amenaza (riesgo negativo)';
            const evalBadge = `<span class="px-2 py-1 rounded text-xs border-l-4 ${r.evaluationClasses}">${r.evaluationLevel}</span>`;

            const chartImg = (r.chartLabels && r.chartData) ? await this.renderOffscreenHistogram(r.chartLabels, r.chartData) : '';

            const lossRowsHTML = r.lossMagnitudes
                ? LOSS_FORMS_KEYS.map((key) => {
                    const f = r.lossMagnitudes[key];
                    if (!f) return '';
                    return `<tr><td>${LOSS_FORM_LABELS.tecnico[key]}</td><td>${fmt(f.min)}</td><td>${fmt(f.mode)}</td><td>${fmt(f.max)}</td></tr>`;
                }).join('')
                : '<tr><td colspan="4">Este riesgo se guardó antes de que se registrara este desglose.</td></tr>';

            // Tratamiento: no se guardó ya calculado (para no duplicar la lógica de negocio del
            // backend) — se guardaron los INSUMOS (mitigar/transferir/evitar, ver
            // saveToRiskRegister) y se recalcula aquí contra el ALE actual de este riesgo. Sin
            // los 10,000 resultados crudos de la simulación (no se guardan, ver chartLabels más
            // arriba), "Transferir" se evalúa de forma conservadora — ver evaluateTreatmentStrategies.
            let treatmentHTML = '';
            if (r.riskType === 'oportunidad') {
                treatmentHTML = `<p>El análisis de Mitigar/Transferir/Evitar/Aceptar (ISO 31000, cláusula 6.5) está diseñado para reducir una pérdida y no aplica a una Oportunidad.</p>`;
            } else if (r.mitigar && r.transferir && r.evitar) {
                let result = null;
                try {
                    result = await App.Api.request('/api/treatment/evaluate', {
                        method: 'POST',
                        body: { currentALE: r.ale, mitigar: r.mitigar, transferir: r.transferir, evitar: r.evitar, currency: 'USD' },
                    });
                } catch (e) { /* se muestra el mensaje de "sin datos" de abajo */ }
                treatmentHTML = result ? `
                    <table>
                        <tr><th>Estrategia</th><th>Costo Anual</th><th>Pérdida Residual</th><th>Beneficio Neto</th><th>Fiabilidad</th><th>Implementación</th></tr>
                        <tr><td>Mitigar</td><td>${fmt(result.mitigar.cost)}</td><td>${fmt(result.mitigar.residualALE)}</td><td>${fmt(result.mitigar.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.mitigar.reliability] || '—'}</td><td>${result.mitigar.delayDays} días</td></tr>
                        <tr><td>Transferir (Seguro)</td><td>${fmt(result.transferir.cost)}</td><td>${fmt(result.transferir.residualALE)}</td><td>${fmt(result.transferir.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.transferir.reliability] || '—'}</td><td>${result.transferir.delayDays} días</td></tr>
                        <tr><td>Evitar</td><td>${fmt(result.evitar.cost)}</td><td>${fmt(0)}</td><td>${fmt(result.evitar.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.evitar.reliability] || '—'}</td><td>${result.evitar.delayDays} días</td></tr>
                        <tr><td>Aceptar / Retener</td><td>${fmt(0)}</td><td>${fmt(r.ale)}</td><td>—</td><td>—</td><td>—</td></tr>
                    </table>
                    <p style="margin-top:8px; font-size:12px;"><strong>Justificación de aceptación (si aplica):</strong> ${sanitizeHTML(r.aceptarJustificacion) || '—'}</p>`
                    : '<p>No se pudo calcular el tratamiento de este riesgo.</p>';
            } else {
                treatmentHTML = '<p>Este riesgo se guardó antes de que existiera esta sección — vuelve a correr su simulación desde Análisis FAIR para completarla.</p>';
            }

            return `
                <div class="print-section">
                    <h2>${index}. ${sanitizeHTML(r.riskName)}</h2>
                    <h3>Alcance del Riesgo</h3>
                    <table>
                        <tr><td><strong>Activo Afectado</strong></td><td>${sanitizeHTML(r.asset) || '—'}</td></tr>
                        <tr><td><strong>Agente de Amenaza</strong></td><td>${sanitizeHTML(r.threat) || '—'}</td></tr>
                        <tr><td><strong>Efecto / Pérdida</strong></td><td>${this.EFFECT_LABELS[r.effect] || r.effect || '—'}</td></tr>
                        <tr><td><strong>Tipo de Riesgo</strong></td><td>${riskTypeLabel}</td></tr>
                        <tr><td><strong>Horizonte Temporal</strong></td><td>${r.timeHorizon || '1'} año(s)</td></tr>
                    </table>
                    <h3>Gobernanza y Calidad de la Información</h3>
                    <table>
                        <tr><td><strong>Dueño del Riesgo</strong></td><td>${sanitizeHTML(r.owner) || '—'}</td></tr>
                        <tr><td><strong>Próxima Fecha de Revisión</strong></td><td>${r.reviewDate || '—'}</td></tr>
                        <tr><td><strong>Fuente de los Datos</strong></td><td>${this.DATA_SOURCE_LABELS[r.dataSource] || '—'}</td></tr>
                        <tr><td><strong>Nivel de Confianza</strong></td><td>${this.DATA_CONFIDENCE_LABELS[r.dataConfidence] || '—'}</td></tr>
                        <tr><td><strong>Notas / Justificación</strong></td><td>${sanitizeHTML(r.dataNotes) || '—'}</td></tr>
                        <tr><td><strong>Plan de Seguridad / Medidas Vigentes</strong></td><td>${sanitizeHTML(r.securityPlan) || '—'}</td></tr>
                        <tr><td><strong>Apreciador / Analista Responsable</strong></td><td>${sanitizeHTML(r.assessor) || '—'}</td></tr>
                        <tr><td><strong>Fecha de esta Apreciación</strong></td><td>${r.assessmentDate || '—'}</td></tr>
                        <tr><td><strong>Lugar / Ubicación Apreciada</strong></td><td>${sanitizeHTML(r.assessmentLocation) || '—'}</td></tr>
                    </table>
                    ${(r.attackerProfileName || r.defenseProfileName) ? `
                    <h3>Perfil de Atacante y Defensa</h3>
                    <table>
                        <tr><td>Perfil de Atacante</td><td>${sanitizeHTML(r.attackerProfileName) || '—'}${r.attackerScore != null ? ` (Factor de Amenaza: ${r.attackerScore.toFixed(1)}%)` : ''}</td></tr>
                        <tr><td>Nivel de Defensa</td><td>${sanitizeHTML(r.defenseProfileName) || '—'}${r.defenseScore != null ? ` (${r.defenseScore.toFixed(1)}%)` : ''}</td></tr>
                    </table>` : ''}
                    ${(r.tef || r.vuln) ? `
                    <h3>Frecuencia y Vulnerabilidad</h3>
                    <table>
                        <tr><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr>
                        ${r.tef ? `<tr><td>Frecuencia de Evento de Amenaza (contactos/año)</td><td>${r.tef.min}</td><td>${r.tef.mode}</td><td>${r.tef.max}</td></tr>` : ''}
                        ${r.vuln ? `<tr><td>Vulnerabilidad (%)</td><td>${r.vuln.min}%</td><td>${r.vuln.mode}%</td><td>${r.vuln.max}%</td></tr>` : ''}
                    </table>` : ''}
                    <h3>Magnitud de Pérdida por Categoría</h3>
                    <table>
                        <tr><th>Categoría</th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr>
                        ${lossRowsHTML}
                    </table>
                    <h3>Resultados de la Simulación Monte Carlo${r.seed ? ` (semilla: ${r.seed})` : ''}</h3>
                    <table>
                        <tr><td>Pérdida Anual Promedio (ALE)</td><td>${fmt(r.ale)}</td></tr>
                        ${r.median != null ? `<tr><td>Pérdida Anual Mediana (P50)</td><td>${fmt(r.median)}</td></tr>` : ''}
                        ${r.min != null ? `<tr><td>Pérdida Mínima Simulada</td><td>${fmt(r.min)}</td></tr>` : ''}
                        ${r.max != null ? `<tr><td>Pérdida Máxima Simulada</td><td>${fmt(r.max)}</td></tr>` : ''}
                        ${r.p90 != null ? `<tr><td>Peor 10% de los casos (P90)</td><td>> ${fmt(r.p90)}</td></tr>` : ''}
                        <tr><td>CVaR 95% (Expected Shortfall)</td><td>${fmt(r.cvar95)}</td></tr>
                    </table>
                    ${chartImg ? `<img src="${chartImg}" alt="Distribución de Pérdida Anual" style="max-width:100%;">` : ''}
                    <h3>Evaluación del Riesgo (contra Criterios de Riesgo definidos)</h3>
                    <table>
                        <tr><td><strong>Clasificación</strong></td><td>${evalBadge}</td></tr>
                        <tr><td><strong>Justificación</strong></td><td>${sanitizeHTML(r.evaluationJustification) || ''}</td></tr>
                    </table>
                    <h3>Análisis de Sensibilidad</h3>
                    <table>
                        <tr><th>Variable</th><th>Correlación con el resultado</th></tr>
                        ${(r.sensitivity || []).slice(0, 8).map((s) => `<tr><td>${sanitizeHTML(s.name)}</td><td>${(s.correlation * 100).toFixed(1)}%</td></tr>`).join('')}
                    </table>
                    <h3>Comparación de Estrategias de Tratamiento (ISO 31000 / Broder, 1984)</h3>
                    ${treatmentHTML}
                </div>`;
        },

        async exportConsolidatedReport() {
            const register = state.fair.riskRegister;
            if (!register || register.length === 0) {
                Modal.alert('Aún no tienes ningún riesgo guardado en el Registro.', 'Nada que exportar');
                return;
            }
            const formatCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
            const ctx = App.OrgContext.context;

            // 'oportunidad' se excluye de la exposición total y del mapa de calor — su "ale" es
            // un beneficio esperado, no una pérdida (mismo criterio que calculateParetoAnalysis
            // en el backend; ver también renderRiskRegister).
            const threatRegister = register.filter(r => r.riskType !== 'oportunidad');
            const opportunityCount = register.length - threatRegister.length;
            const totalALE = threatRegister.reduce((sum, r) => sum + r.ale, 0);
            const criticos = threatRegister.filter(r => r.evaluationLevel.includes('Crítico')).length;
            const exposicionTotalTexto = formatCurrency(totalALE);

            const heatmapImg = document.getElementById('fair-register-chart').toDataURL('image/png');
            const paretoImg = document.getElementById('fair-pareto-chart').toDataURL('image/png');
            const sensitivityHTML = document.getElementById('fair-consolidated-sensitivity-list').innerHTML;
            // Mismo orden que los puntos numerados del mapa de calor (ver renderRiskRegister) —
            // solo amenazas, para que el número en el mapa corresponda al mismo riesgo aquí.
            const heatmapLegendHTML = threatRegister.map((r, i) => `<li>${i + 1}. ${sanitizeHTML(r.riskName)}</li>`).join('');

            // El backend guarda ale/cvar95 como números crudos (no strings ya formateados) — el
            // formateo es presentación, se hace aquí por entrada.
            const formatEntryCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
            const formatEntryDate = (r) => new Date(r.date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });

            // Mismo badge de color que ya se ve en pantalla en la tabla del Registro
            // (r.evaluationClasses ya viene calculado por entrada, ver PUT /api/register) — antes
            // el PDF solo mostraba el texto de evaluationLevel plano, sin el color.
            const evalBadgeHTML = (r) => `<span class="px-2 py-1 rounded text-xs border-l-4 ${r.evaluationClasses}">${r.evaluationLevel}</span>`;
            const riskRowsHTML = register.map(r =>
                `<tr><td>${sanitizeHTML(r.riskName)}</td><td>${sanitizeHTML(r.asset)}</td><td>${sanitizeHTML(r.owner)}</td><td>${formatEntryCurrency(r.ale)}</td><td>${formatEntryCurrency(r.cvar95)}</td><td>${evalBadgeHTML(r)}</td><td>${formatEntryDate(r)}</td></tr>`
            ).join('');

            // Detalle técnico completo de cada riesgo (Alcance, Gobernanza, Perfil de Atacante/
            // Defensa, Frecuencia/Vulnerabilidad, Magnitud de Pérdida, Simulación, Evaluación,
            // Sensibilidad, Tratamiento) — antes esto era un reporte aparte por cada riesgo
            // (App.FairExport.exportFairReport, ya eliminado); ahora es una sección de este mismo
            // informe, una por riesgo (ver buildFullRiskReportSection). Secuencial (no
            // Promise.all) para no disparar N peticiones simultáneas a /api/treatment/evaluate.
            const riskDetailSections = [];
            for (let i = 0; i < register.length; i++) {
                riskDetailSections.push(await this.buildFullRiskReportSection(register[i], i + 1));
            }
            const riskDetailHTML = riskDetailSections.join('');

            const reportHTML = `
                <div class="print-section">
                    <h1>Informe Consolidado de Riesgos (FAIR)</h1>
                    <p>Generado: ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                <div class="print-section">
                    <h2>Contexto Organizacional</h2>
                    <table>
                        <tr><td><strong>Misión y Objetivos</strong></td><td>${sanitizeHTML(ctx.mision) || '—'}</td></tr>
                        <tr><td><strong>Naturaleza del Negocio</strong></td><td>${sanitizeHTML(ctx.naturalezaNegocio) || '—'}</td></tr>
                        <tr><td><strong>Apetito por el Riesgo</strong></td><td>${ctx.apetitoRiesgo}</td></tr>
                        <tr><td><strong>Partes Interesadas Clave</strong></td><td>${sanitizeHTML(ctx.partesInteresadas) || '—'}</td></tr>
                        <tr><td><strong>Entorno Legal/Regulatorio</strong></td><td>${sanitizeHTML(ctx.entornoLegal) || '—'}</td></tr>
                        <tr><td><strong>Alcance de la Cadena de Suministro Cubierta</strong></td><td>${sanitizeHTML(ctx.alcanceCadenaSuministro) || '—'}</td></tr>
                    </table>
                </div>
                <div class="print-section">
                    <h2>Resumen Ejecutivo</h2>
                    <table>
                        <tr><td><strong>Riesgos Analizados</strong></td><td>${register.length}${opportunityCount > 0 ? ` (${threatRegister.length} amenaza${threatRegister.length === 1 ? '' : 's'}, ${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'})` : ''}</td></tr>
                        <tr><td><strong>Exposición Total (suma de ALE de las amenazas)</strong></td><td>${exposicionTotalTexto}</td></tr>
                        <tr><td><strong>Amenazas en nivel Crítico</strong></td><td>${criticos}</td></tr>
                    </table>
                </div>
                <div class="print-section">
                    <h2>Registro de Riesgos</h2>
                    <table>
                        <tr><th>Riesgo</th><th>Activo</th><th>Dueño</th><th>ALE</th><th>CVaR 95%</th><th>Evaluación</th><th>Fecha</th></tr>
                        ${riskRowsHTML}
                    </table>
                </div>
                <div class="print-section">
                    <h2>Mapa de Calor Consolidado</h2>
                    <table style="border:none;">
                        <tr>
                            <td style="width:65%; vertical-align:top; border:none; padding:0;"><img src="${heatmapImg}" alt="Mapa de calor consolidado" style="max-width:100%;"></td>
                            <td style="width:35%; vertical-align:top; border:none; padding:0 0 0 12px;">
                                <strong style="font-size:12px;">Riesgos:</strong>
                                <ol style="margin:4px 0 0 16px; padding:0; font-size:11px;">${heatmapLegendHTML}</ol>
                            </td>
                        </tr>
                    </table>
                </div>
                <div class="print-section">
                    <h2>Análisis 80-20 (Pareto)</h2>
                    <p style="font-size:12px;">${document.getElementById('fair-pareto-summary').textContent}</p>
                    <img src="${paretoImg}" alt="Análisis de Pareto">
                </div>
                <div class="print-section">
                    <h2>Sensibilidad Consolidada</h2>
                    ${sensitivityHTML}
                </div>
                ${riskDetailHTML}
                <div class="print-section">
                    <h2>Interpretación General</h2>
                    ${document.getElementById('fair-register-interpretation').innerHTML}
                </div>
                <div class="print-section" style="margin-top:24px; border-top:1px solid #999; padding-top:8px;">
                    <p style="font-size:11px; color:#555;">Este documento contiene información confidencial de análisis de riesgo. Su distribución debe limitarse a las personas autorizadas por la organización apreciada.</p>
                </div>
            `;

            document.getElementById('fair-print-report').innerHTML = reportHTML;
            window.print();
        },

    };

    // App.FairAnalysis — fachada delgada: solo orquesta el orden de arranque y
    // reexpone (sin lógica propia) los 3 métodos que otros módulos (App.UIMode,
    // App.Navigation, App.QuickAnalysis) siguen llamando por este nombre. Toda
    // la lógica real vive en FairWizard/FairRegister/FairExport de arriba.
    App.FairAnalysis = {
        init() {
            App.FairWizard.populateLossMagnitudeForms();
            App.FairWizard.bindEvents();
            App.FairRegister.loadRiskRegister(false);
            App.FairWizard.applyOrgDefaults();
            App.FairWizard.checkForResumableAnalysis();
        },
        loadRiskRegister(render = true) { return App.FairRegister.loadRiskRegister(render); },
        renderSensitivity(sensitivity) { return App.FairWizard.renderSensitivity(sensitivity); },
        receiveData(data) { return App.FairWizard.receiveData(data); },
    };

    // Start the application
    App.init();
});
