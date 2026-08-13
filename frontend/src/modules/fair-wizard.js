import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import {
    LOSS_FORMS_KEYS,
    LOSS_FORM_LABELS,
    LOSS_FIELD_LABELS,
    buildHistogramBins,
    computeSuggestedTef,
    formatCurrency,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    showToast,
    simpleEvaluationMessage,
    sortTriangularRange,
    toggleErrorState,
    updateProgressBar,
} from './utils.js';

// --- FAIR Analysis Module ---
// ============================================================
// App.FairWizard — el formulario de 4 pasos (Perfil de Atacante/Defensa,
// TEF/Vulnerabilidad, Magnitud de Pérdida, Simulación + Tratamiento), sus
// autocálculos, validaciones y el borrador persistido en localStorage. Si el
// bug está en algo que el usuario llena/ve mientras arma un análisis FAIR,
// está aquí.
// ============================================================
export const FairWizard = {
    // Guardianes contra condición de carrera de red: si el usuario dispara dos autocálculos
    // seguidos para el MISMO cómputo (ej. cambia el Perfil de Atacante dos veces rápido, o
    // edita "Modo" de una categoría de pérdida dos veces antes de que responda la primera), no
    // hay garantía de que las respuestas HTTP lleguen en el mismo orden en que se pidieron — la
    // más vieja puede llegar DESPUÉS que la más nueva y pisar en silencio un resultado ya
    // correcto con uno desactualizado. Cada función de autocálculo de abajo captura un id antes
    // de pedir la red y, al volver, solo escribe si su id sigue siendo el más reciente para ese
    // mismo cómputo — si no, la respuesta es vieja y se descarta sin avisar (una llamada más
    // nueva ya se está encargando, o ya terminó). _lossMagnitudeRequestIds es por CLAVE (una
    // por cada una de las 9 categorías de pérdida) en vez de un solo id global, porque editar
    // dos categorías DISTINTAS casi al mismo tiempo son cómputos independientes — descartar la
    // respuesta de una por culpa de la otra sería un bug nuevo, no el arreglo de uno viejo.
    _attackerDefenseRequestId: 0,
    _vulnRequestId: 0,
    _nextLossMagnitudeRequestId: 0,
    _lossMagnitudeRequestIds: {},

    applyOrgDefaults() {
        document.getElementById('fair-defense-profile').value = App.OrgDefaults.defaults.defenseKey;
        document.getElementById('fair-data-source').value = App.OrgDefaults.defaults.dataSource;
        document.getElementById('fair-data-confidence').value = App.OrgDefaults.defaults.dataConfidence;
        this.updateAttackerDefenseSummary();
    },

    duplicateFromTemplate() {
        let data;
        try {
            const raw = localStorage.getItem('fairAnalysisTemplate');
            if (!raw) {
                Modal.alert(
                    'Aún no tienes ningún análisis FAIR completado (con simulación corrida) para usar como plantilla.',
                    'Sin plantilla disponible',
                );
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
        document.getElementById('fair-data-source').value = data.dataSource || App.OrgDefaults.defaults.dataSource;
        document.getElementById('fair-data-confidence').value =
            data.dataConfidence || App.OrgDefaults.defaults.dataConfidence;
        if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
        if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
        const esDeliberada = this.inferDeliberateThreat(data);
        document.getElementById('fair-deliberate-threat').checked = esDeliberada;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !esDeliberada);
        this.applyDeliberateThreatMode();
        if (data.deliberateThreatPonderation) {
            document.getElementById('fair-deliberate-ponderation').value = data.deliberateThreatPonderation;
            document.getElementById('fair-deliberate-ponderation-value').textContent =
                `x${parseFloat(data.deliberateThreatPonderation).toFixed(2)}`;
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
        showToast(
            'Plantilla aplicada. Revisa el Nombre del Escenario, Activo y Agente de Amenaza — son lo único que casi siempre cambia entre un riesgo y otro.',
        );
    },

    // Apetito de Riesgo por riesgo (state.fair.riskCriteriaOverride, null = usa los criterios
    // globales de state.config.riskCriteria) — mismo patrón que los botones "Elegir del
    // Catálogo de..." de este mismo paso: abre un modal prellenado en vez de mandar al usuario
    // a la pantalla aparte de "Criterios de Riesgo" y forzarlo a volver. Se envía como
    // riskCriteria a /api/simulate (que YA soportaba sobreescribir los criterios guardados para
    // una sola corrida, ver runMonteCarloSimulation) y se persiste junto con el resto del
    // análisis (ver saveToRiskRegister/saveDraftToRisksList/persistFairAnalysis) para que
    // sobreviva a un re-simulado posterior de este mismo riesgo.
    openCriteriaOverrideEditor() {
        const global = state.config.riskCriteria || {};
        const current = state.fair.riskCriteriaOverride;
        const percentValue = current ? current.aleAceptablePercent : global.aleAceptablePercent;
        const criticoValue = current ? current.aleCritico : global.aleCritico;
        const formHTML = `
            <p class="description-text mb-4">
                Por defecto este riesgo usa los criterios globales de la organización (Pérdida Anual
                Aceptable ${global.aleAceptablePercent}% de un ALE Crítico de $${(global.aleCritico || 0).toLocaleString('en-US')}).
                Aquí puedes definir un Apetito de Riesgo distinto SOLO para este riesgo.
            </p>
            <p id="criteria-override-form-error" class="text-red-600 text-sm mb-3 hidden"></p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="input-group">
                    <label for="crit-override-percent">Pérdida Anual Aceptable (%):</label>
                    <input type="number" id="crit-override-percent" class="form-input" value="${percentValue}" min="1" max="99">
                </div>
                <div class="input-group">
                    <label for="crit-override-critico">ALE Crítico (desde) — no puede superar el global ($${(global.aleCritico || 0).toLocaleString('en-US')}):</label>
                    <input type="number" id="crit-override-critico" class="form-input" value="${criticoValue}" min="0" max="${global.aleCritico || ''}">
                </div>
            </div>
        `;
        Modal.title.textContent = 'Criterios de Riesgo — Solo para este riesgo';
        Modal.body.innerHTML = formHTML;
        Modal.footer.innerHTML = `
            ${current ? '<button id="criteria-override-reset-btn" class="btn btn-secondary">Usar Criterios Globales</button>' : ''}
            <button id="criteria-override-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="criteria-override-save-btn" class="btn btn-primary">Guardar para este Riesgo</button>
        `;
        Modal.modal.classList.remove('hidden');

        document.getElementById('criteria-override-cancel-btn').addEventListener('click', () => Modal.hide());
        const resetBtn = document.getElementById('criteria-override-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                state.fair.riskCriteriaOverride = null;
                this.updateCriteriaOverrideStatus();
                Modal.hide();
                showToast('Este riesgo vuelve a usar los criterios globales de la organización.');
            });
        }
        document.getElementById('criteria-override-save-btn').addEventListener('click', () => {
            const percent = getSafeNumber(document.getElementById('crit-override-percent'));
            const critico = getSafeNumber(document.getElementById('crit-override-critico'));
            const errorEl = document.getElementById('criteria-override-form-error');
            if (!(percent > 0 && percent < 100) || !(critico > 0)) {
                errorEl.textContent =
                    'La Pérdida Anual Aceptable (%) debe estar entre 0 y 100, y el ALE Crítico debe ser mayor que 0.';
                errorEl.classList.remove('hidden');
                return;
            }
            // El override individual puede ser más restrictivo que el global (menos tolerancia
            // para este riesgo en particular), pero nunca más permisivo — "mi máximo global es
            // $1M, pero para este riesgo mi máximo es $2M" se contradice a sí mismo, porque el
            // global YA es el techo absoluto de lo que la organización está dispuesta a perder
            // (el backend valida lo mismo, ver validateRiskCriteriaOverride).
            if (typeof global.aleCritico === 'number' && critico > global.aleCritico) {
                errorEl.textContent = `El ALE Crítico de este riesgo no puede superar el ALE Crítico global ($${global.aleCritico.toLocaleString('en-US')}).`;
                errorEl.classList.remove('hidden');
                return;
            }
            state.fair.riskCriteriaOverride = { aleAceptablePercent: percent, aleCritico: critico };
            this.updateCriteriaOverrideStatus();
            Modal.hide();
            showToast('Criterios personalizados guardados para este riesgo.');
        });
    },

    updateCriteriaOverrideStatus() {
        const el = document.getElementById('fair-criteria-override-status');
        const override = state.fair.riskCriteriaOverride;
        const isSimple = App.UIMode.mode === 'simple';
        if (override) {
            el.textContent = isSimple
                ? `Usa criterios propios: aceptas hasta ${override.aleAceptablePercent}% de una pérdida crítica de $${override.aleCritico.toLocaleString('en-US')} al año.`
                : `Usa criterios propios: Pérdida Anual Aceptable ${override.aleAceptablePercent}% de un ALE Crítico de $${override.aleCritico.toLocaleString('en-US')}.`;
        } else {
            el.textContent = isSimple
                ? 'Usa el mismo criterio de riesgo de toda la organización.'
                : 'Usa los criterios globales (Pérdida Anual Aceptable/ALE Crítico) de la organización.';
        }
    },

    // Línea fija bajo "Nombre del Riesgo" con la norma de la amenaza elegida del catálogo (ver
    // App.RiskCatalog.useSelected) — a diferencia de la info del propio picker (que desaparece
    // al cerrar el modal), esta queda visible mientras se sigue llenando el resto del Paso 1, y
    // es lo que App.FairRegister.saveToRiskRegister manda como catalogStandard/catalogCode.
    showCatalogStandardLine() {
        const el = document.getElementById('fair-catalog-standard-line');
        if (!el) return;
        if (!state.fair.catalogStandard) {
            el.classList.add('hidden');
            return;
        }
        el.textContent = `Norma de referencia: ${state.fair.catalogStandard}`;
        el.classList.remove('hidden');
    },

    // Pinta state.fair.reviewHistory en la tabla del Paso 4 — separado de displaySimulationResults
    // para poder llamarlo también al retomar un riesgo ya guardado (loadRegisteredRiskIntoForm),
    // sin tener que volver a simular primero solo para ver el historial que ya tenía.
    renderReviewHistoryTable() {
        const history = state.fair.reviewHistory || [];
        document.getElementById('fair-review-history-body').innerHTML = history
            .map(
                (entry) =>
                    `<tr class="border-b"><td class="py-1">${entry.date}</td><td>${entry.ale}</td><td>${entry.evaluationLevel}</td></tr>`,
            )
            .join('');
        document.getElementById('fair-review-history-container').classList.toggle('hidden', history.length < 2);
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
            // Mismo vínculo real que saveToRiskRegister — permite a App.AssetCatalog reconocer
            // este borrador como vinculado a un activo aunque todavía no llegue a simularse.
            assetId: state.quick.selectedAssetRef ? state.quick.selectedAssetRef.id : null,
            threat: document.getElementById('fair-threat').value.trim(),
            effect: document.getElementById('fair-effect').value,
            riskType: document.getElementById('fair-risk-type').value,
            timeHorizon: document.getElementById('fair-time-horizon').value,
            triggeredBy: (() => {
                this.syncTriggeredByDraftFromDom();
                return state.fair.triggeredByDraft.filter((t) => t.riskName);
            })(),
            riskCriteriaOverride: state.fair.riskCriteriaOverride || null,
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
        document.getElementById('fair-triggered-by-add-btn').addEventListener('click', () => {
            this.syncTriggeredByDraftFromDom();
            state.fair.triggeredByDraft.push({ riskName: '', probability: null });
            this.renderTriggeredByRows();
        });
        document
            .getElementById('open-criteria-override-btn-fair')
            .addEventListener('click', () => this.openCriteriaOverrideEditor());
        document.getElementById('fair-step2-back').addEventListener('click', () => this.navigateWizard(1));
        document.getElementById('fair-step2-next').addEventListener('click', () => this.navigateWizard(3));
        document.getElementById('fair-step3-back').addEventListener('click', () => this.navigateWizard(2));
        document.getElementById('fair-step3-next').addEventListener('click', () => this.navigateWizard(4));
        document.getElementById('fair-step4-back').addEventListener('click', () => this.navigateWizard(3));
        document.getElementById('run-simulation-btn').addEventListener('click', () => this.runMonteCarloSimulation());
        document.getElementById('nash-calculate-btn').addEventListener('click', () => this.calculateNashEquilibrium());
        document.getElementById('fair-reset-btn').addEventListener('click', () => this.resetForm());
        document.getElementById('fair-duplicate-btn').addEventListener('click', () => this.duplicateFromTemplate());
        document.getElementById('fair-resume-banner-btn').addEventListener('click', () => this.restoreFairAnalysis());
        document.getElementById('fair-resume-banner-dismiss-btn').addEventListener('click', () => {
            document.getElementById('fair-resume-banner').classList.add('hidden');
        });
        document
            .getElementById('fair-attacker-profile')
            .addEventListener('change', () => this._trackPendingAutocalc(this.updateAttackerDefenseSummary()));
        document
            .getElementById('fair-defense-profile')
            .addEventListener('change', () => this._trackPendingAutocalc(this.updateAttackerDefenseSummary()));
        document.getElementById('fair-data-confidence').addEventListener('change', () => {
            this._trackPendingAutocalc(
                Promise.all([this.updateVulnerabilityAuto(), this.updateAllLossMagnitudeAuto()]),
            );
        });
        document.getElementById('lm-manual-override').addEventListener('change', (e) => {
            this.setLossMagnitudeManualOverride(e.target.checked);
            showToast(
                e.target.checked
                    ? 'Ahora puedes editar Mín/Máx manualmente en todas las categorías.'
                    : 'Mín/Máx calculados automáticamente de nuevo.',
            );
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
            document.getElementById('fair-deliberate-ponderation-value').textContent =
                `x${parseFloat(e.target.value).toFixed(2)}`;
        });
        // Si el usuario escribe directamente en TEF, dejamos de pisarlo con la sugerencia
        // automática — la sugerencia es solo un punto de partida, no debe robarle el control
        // a alguien que ya puso su propio dato. .value=... por JS no dispara 'input', así que
        // este listener solo detecta tecleo real del usuario, nunca nuestras propias sugerencias.
        ['tef-min', 'tef-mode', 'tef-max'].forEach((id) => {
            document.getElementById(id).addEventListener('input', () => {
                state.fair.tefManuallyEdited = true;
            });
        });
        document
            .getElementById('fair-export-consolidated-btn')
            .addEventListener('click', () => App.FairExport.exportConsolidatedReport());
        document.getElementById('fair-treat-this-risk-btn').addEventListener('click', () => {
            const riskName = document.getElementById('fair-riskName').value.trim();
            App.Navigation.switchPage('treatment');
            App.Treatment.load(riskName);
        });
        document.getElementById('fair-manage-this-risk-btn').addEventListener('click', () => {
            const riskName = document.getElementById('fair-riskName').value.trim();
            App.Navigation.switchPage('riskmgmt');
            App.RiskManagement.load(riskName);
        });
        document
            .getElementById('selectAllHistory')
            .addEventListener('change', (e) =>
                App.FairRegister.toggleSelectAll('quick-concentrated-table-body', e.target.checked),
            );
        // Filtros por Etapa/Evaluación de Riesgos Guardados (ver renderConcentratedTable, que lee
        // estos mismos selects) — re-dibuja con el filtro nuevo sin volver a pedir nada al
        // backend, la lista completa ya vive en memoria (state.fair.concentratedRisks).
        ['quick-concentrated-filter-stage', 'quick-concentrated-filter-eval'].forEach((id) => {
            document
                .getElementById(id)
                .addEventListener('change', () =>
                    App.FairRegister.renderConcentratedTable(state.fair.concentratedRisks),
                );
        });
        document
            .getElementById('fair-deep-analysis-btn')
            .addEventListener('click', () => App.FairRegister.showDeepAnalysis('quick-concentrated-table-body'));
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
        document.querySelectorAll('#fair-step-2 .fair-range-input').forEach((input) => {
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

        const requestId = ++this._attackerDefenseRequestId;
        let data;
        try {
            data = await App.Api.request('/api/autocalc/attacker-defense-summary', {
                method: 'POST',
                body: { attackerKey, defenseKey },
            });
        } catch (err) {
            if (requestId !== this._attackerDefenseRequestId) return; // ver el guardián documentado arriba, junto a FairWizard
            summaryEl.innerHTML = '<p class="text-red-600">No se pudo calcular. Verifica tu conexión.</p>';
            showToast(err.userMessage || 'No se pudo calcular el resumen de atacante/defensa.');
            return;
        }
        if (requestId !== this._attackerDefenseRequestId) return; // respuesta vieja, ya superada por otra más nueva
        const { attackerProfile, defenseProfile, attackerScore, defenseScore } = data;

        // Guardar para trazabilidad (qué supuestos se usaron) y para la sugerencia de rango
        state.fair.attackerKey = attackerKey;
        state.fair.defenseKey = defenseKey;
        state.fair.attackerScore = attackerScore;
        state.fair.defenseScore = defenseScore;

        const rowsHTML = (profile) =>
            Object.entries(profile)
                .filter(([key]) => key !== 'name')
                .map(
                    ([key, value]) =>
                        `<span class="inline-block mr-3 capitalize">${key}: <strong>${value}%</strong></span>`,
                )
                .join('');

        // Sin comparación numérica entre los dos (ej. una resta) a propósito — Vulnerabilidad no
        // es una resta desde el modelo TCap vs. RS (ver updateVulnerabilityAuto abajo), así que
        // mostrar aquí un "diferencial" invitaba a la misma lectura ingenua que ya se corrigió en
        // el cálculo real. Esto es solo referencia de qué trae cada perfil elegido.
        summaryEl.innerHTML =
            App.UIMode.mode === 'simple'
                ? `
            <p class="mb-1"><strong>Qué tan motivado/capaz es el atacante:</strong> ${attackerScore.toFixed(0)}%</p>
            <p class="mb-1"><strong>Qué tan preparada está tu defensa:</strong> ${defenseScore.toFixed(0)}%</p>
        `
                : `
            <p class="mb-1"><strong>Factor de Amenaza (FA):</strong> ${attackerScore.toFixed(1)}% — ${rowsHTML(attackerProfile)}</p>
            <p class="mb-1"><strong>Nivel de Defensa (ENC):</strong> ${defenseScore.toFixed(1)}% — ${rowsHTML(defenseProfile)}</p>
        `;

        this.suggestTefRange();
        await this.updateVulnerabilityAuto();
    },

    // Vulnerabilidad = probabilidad de que la amenaza tenga éxito = capacidad del atacante
    // vs. fuerza de tu defensa (FAIR: Threat Capability vs. Resistance Strength). Se calcula
    // sola; el usuario no tiene que adivinar un porcentaje. El ancho del rango (Mín/Máx)
    // se ajusta según el Nivel de Confianza que ya declaraste — confianza baja = rango ancho.
    setVulnManualOverride(isManual) {
        document.getElementById('vuln-manual-override').checked = isManual;
        ['vuln-min', 'vuln-mode', 'vuln-max'].forEach((id) => {
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

        const requestId = ++this._vulnRequestId;
        let data;
        try {
            data = await App.Api.request('/api/autocalc/vulnerability', {
                method: 'POST',
                body: { attackerKey: state.fair.attackerKey, defenseKey: state.fair.defenseKey, confidence },
            });
        } catch (err) {
            if (requestId !== this._vulnRequestId) return; // ver el guardián documentado arriba, junto a FairWizard
            explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
            return;
        }
        // Respuesta vieja, ya superada por otra más nueva, o "Ajustar manualmente" se activó
        // mientras esta petición estaba en vuelo (mismo bug real ya documentado y arreglado
        // para Magnitud de Pérdida — ver _applyLossMagnitudeAuto) — en cualquiera de los dos
        // casos, escribir esta respuesta pisaría en silencio un valor que ya no debería tocarse.
        if (requestId !== this._vulnRequestId) return;
        if (document.getElementById('vuln-manual-override').checked) return;

        document.getElementById('vuln-min').value = data.min;
        document.getElementById('vuln-mode').value = data.mode;
        document.getElementById('vuln-max').value = data.max;

        const confidenceLabel = { alto: 'Alta', medio: 'Media', bajo: 'Baja' }[confidence] || 'Media';
        explanationEl.textContent =
            App.UIMode.mode === 'simple'
                ? `Se calculó combinando qué tan motivado y capaz es el atacante con qué tan fuerte es tu defensa actual: ${data.mode}%. Puedes ajustarlo a mano si no te hace sentido.`
                : `Calculado comparando la Capacidad de Amenaza (${data.attackerScore.toFixed(0)}%) contra tu Fuerza de Resistencia (${data.defenseScore.toFixed(0)}%) mediante la Función de Éxito de Contienda de Tullock (no una resta simple) → ${data.mode}%. Rango ±según tu Nivel de Confianza declarado (${confidenceLabel}).`;
    },

    toggleRiskTypeLabels() {
        const isOpportunity = document.getElementById('fair-risk-type').value === 'oportunidad';
        state.fair.riskType = isOpportunity ? 'oportunidad' : 'amenaza';
        App.UIMode.applyLabels();
    },

    // ¿Este dato guardado corresponde a una amenaza deliberada? No basta con leer la bandera:
    //   - Un borrador del Paso 1 NO la persiste (ver saveDraftToRisksList) — llega ausente.
    //   - Un riesgo guardado antes de que el interruptor gobernara la Vulnerabilidad la trae en
    //     false, porque entonces solo afectaba al TEF sugerido y venía desmarcado por default.
    // Ninguno de los dos casos significa "el usuario declaró que no hay adversario", y tratarlos
    // así escondería los perfiles con los que ese riesgo de verdad se analizó. Solo un false
    // EXPLÍCITO y sin perfiles cuenta como decisión real de "no deliberada".
    inferDeliberateThreat(data) {
        if (data.isDeliberate === undefined || data.isDeliberate === null) return true;
        return !!data.isDeliberate || !!data.attackerKey;
    },

    toggleDeliberateThreatFair() {
        const checked = document.getElementById('fair-deliberate-threat').checked;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !checked);
        state.fair.isDeliberate = checked;
        this.applyDeliberateThreatMode();
    },

    // Una amenaza NO deliberada (sismo, incendio accidental, error humano) no tiene adversario, y
    // el modelo de Vulnerabilidad de la app sí lo asume: compara Capacidad de Amenaza contra
    // Fuerza de Resistencia como una contienda, e incluso deja que un atacante persistente ESCALE
    // su sofisticación cuando la defensa va ganando (ver sampleVulnerabilityFromProfiles en el
    // backend). Un sismo no sube su magnitud porque el edificio aguantó.
    //
    // Por eso, sin deliberación, se pide la Vulnerabilidad DIRECTA: los perfiles se ocultan, no se
    // mandan al simular (el backend ya tolera su ausencia y muestrea del rango capturado) y los
    // tres campos quedan editables. No es un mecanismo nuevo: es el mismo camino que ya existía
    // tras el checkbox "Ajustar manualmente", ahora activado solo en vez de depender de que el
    // usuario sepa que ahí debe marcarlo.
    applyDeliberateThreatMode() {
        const deliberada = document.getElementById('fair-deliberate-threat').checked;
        const seccionPerfiles = document.getElementById('fair-attacker-defense-section');
        if (seccionPerfiles) seccionPerfiles.classList.toggle('hidden', !deliberada);
        // El checkbox de ajuste manual sobra cuando la Vulnerabilidad SIEMPRE es manual — dejarlo
        // visible sería un control que no hace nada.
        const contenedorOverride = document.getElementById('vuln-manual-override-container');
        if (contenedorOverride) contenedorOverride.classList.toggle('hidden', !deliberada);

        if (!deliberada) {
            this.setVulnManualOverride(true);
        }
        // Etapa 3: el Equilibrio de Nash es una CONTIENDA entre dos jugadores que eligen cuánto
        // esfuerzo invertir. Sin adversario no hay contienda que resolver — un sismo no decide
        // esforzarse más porque reforzaste el edificio — y además el cálculo exige attackerKey +
        // defenseKey, que en este modo no existen: dejarlo visible sería ofrecer un botón que solo
        // puede terminar en el aviso "completa el Paso 1".
        const nash = document.getElementById('fair-nash-container');
        if (nash) nash.classList.toggle('hidden', !deliberada);
        // applyLabels() vuelve a pintar vuln-header desde su diccionario, así que el texto
        // específico de "no deliberada" se aplica DESPUÉS, desde applyDeliberateThreatLabels —
        // que también se llama al final de applyLabels() para que sobreviva a un cambio de Modo
        // Simple/Técnico.
        App.UIMode.applyLabels();
    },

    // Solo el texto: sin adversario, esto ya no es "Vulnerabilidad" en el sentido de FAIR
    // (¿supera el atacante mi resistencia?), sino directamente la probabilidad de que el evento
    // termine en pérdida. Separado de applyDeliberateThreatMode porque App.UIMode.applyLabels lo
    // invoca al final de cada aplicación de etiquetas — llamar al otro desde ahí recursaría.
    applyDeliberateThreatLabels() {
        const casilla = document.getElementById('fair-deliberate-threat');
        if (!casilla) return;
        const deliberada = casilla.checked;
        const simple = App.UIMode.mode === 'simple';

        const desc = document.getElementById('vuln-section-desc');
        if (desc) {
            desc.textContent = deliberada
                ? simple
                    ? 'Se calcula sola con el perfil de atacante y tu nivel de defensa — no necesitas escribir nada aquí, salvo que prefieras ajustarla tú.'
                    : 'Se calcula sola a partir del Perfil de Atacante/Defensa que elegiste arriba y tu Nivel de Confianza — no necesitas escribir nada aquí, a menos que prefieras ajustarla tú mismo.'
                : simple
                  ? 'Como esto no lo provoca nadie a propósito, no hay perfil de atacante que valga: escribe directamente qué tan probable es que el evento te cause pérdida.'
                  : 'Amenaza no deliberada: no hay adversario, así que no se deriva de perfiles. Captura directamente la probabilidad de que el evento resulte en pérdida.';
        }
        if (!deliberada) {
            const encabezado = document.getElementById('vuln-header');
            if (encabezado) {
                encabezado.textContent = simple
                    ? 'Si pasa, ¿qué tan probable es que te cause pérdida?'
                    : 'Probabilidad de que el evento cause pérdida (%)';
            }
        }
    },

    // Punto de partida automático para TEF (Paso 2) — se recalcula sola mientras el usuario no
    // haya tecleado su propio número (ver el listener 'input' en bindEvents que fija
    // tefManuallyEdited). La fórmula en sí (y por qué está armada así) vive en
    // computeSuggestedTef(), utils.js — acá solo se lee el perfil elegido del DOM y se
    // escribe el resultado en los 3 campos.
    suggestTefRange() {
        if (state.fair.tefManuallyEdited) return;
        const attackerKey = document.getElementById('fair-attacker-profile').value;
        const attackerProfile = state.quick.attackerProfiles[attackerKey];
        if (!attackerProfile) return;

        const ponderacion = getSafeNumber(document.getElementById('fair-deliberate-ponderation'));
        const isDeliberate = document.getElementById('fair-deliberate-threat').checked;
        const { min, mode, max, explanation } = computeSuggestedTef(
            attackerProfile,
            attackerKey,
            ponderacion,
            isDeliberate,
        );

        document.getElementById('tef-min').value = min;
        document.getElementById('tef-mode').value = mode;
        document.getElementById('tef-max').value = max;
        document.getElementById('tef-auto-explanation').textContent = explanation;
    },

    validateAndFixRange(prefix) {
        const minInput = document.getElementById(`${prefix}-min`);
        const modeInput = document.getElementById(`${prefix}-mode`);
        const maxInput = document.getElementById(`${prefix}-max`);

        const [min, mode, max] = sortTriangularRange([
            getSafeNumber(minInput),
            getSafeNumber(modeInput),
            getSafeNumber(maxInput),
        ]);
        minInput.value = min;
        modeInput.value = mode;
        maxInput.value = max;

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
        state.fair.riskCriteriaOverride = data.riskCriteriaOverride || null;
        this.updateCriteriaOverrideStatus();
        document.getElementById('fair-riskName').value = data.riskName || '';
        state.fair.triggeredByDraft = Array.isArray(data.triggeredBy)
            ? data.triggeredBy.map((t) => ({ ...t }))
            : data.triggeredByRiskName
              ? [{ riskName: data.triggeredByRiskName, probability: data.triggeredByProbability ?? null }]
              : [];
        this.renderTriggeredByRows();
        // Igual que la Descripción/norma de abajo: si el riesgo se armó eligiendo un activo
        // del Catálogo de Activos en Análisis Rápido, ese nombre se transfiere aquí en vez
        // de forzar a re-escribirlo (ver App.AssetCatalog y calculateAll()).
        if (data.asset) document.getElementById('fair-asset').value = data.asset;
        // Restaura el vínculo real con el Catálogo de Activos (ver saveDraftToRisksList) —
        // sin esto, re-guardar este mismo riesgo desde aquí perdería la conexión con su
        // activo aunque el nombre ya estuviera prellenado en el campo de arriba.
        if (data.assetId) state.quick.selectedAssetRef = { id: data.assetId };

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

        if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
        if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
        const esDeliberada = this.inferDeliberateThreat(data);
        document.getElementById('fair-deliberate-threat').checked = esDeliberada;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !esDeliberada);
        this.applyDeliberateThreatMode();
        if (data.deliberateThreatPonderation) {
            document.getElementById('fair-deliberate-ponderation').value = data.deliberateThreatPonderation;
            document.getElementById('fair-deliberate-ponderation-value').textContent =
                `x${parseFloat(data.deliberateThreatPonderation).toFixed(2)}`;
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
    // Pinta state.fair.triggeredByDraft (Paso 1, "Riesgos Desencadenantes") como filas
    // editables — un riesgo puede tener más de una causa (ver
    // App.RiskCascadeTree.buildGraph/openChangeTriggerModal, mismo patrón de filas). Cada
    // <select> excluye el propio nombre + lo ya elegido en OTRAS filas (recalculado en cada
    // render). A diferencia de openChangeTriggerModal, no excluye descendientes: un riesgo
    // recién armado en el wizard no puede ser ancestro de nada todavía. Se llama cada vez que
    // el Registro se recarga (ver App.FairRegister.loadRiskRegister) y cada vez que se carga
    // un riesgo específico en el formulario, para que la exclusión quede al día con el nombre
    // vigente.
    renderTriggeredByRows() {
        const body = document.getElementById('fair-triggered-by-body');
        if (!body) return;
        const ownName = document.getElementById('fair-riskName').value.trim();
        const register = state.fair.riskRegister || [];
        const working = state.fair.triggeredByDraft;

        const optionsFor = (rowIndex) => {
            const chosenElsewhere = new Set(
                working.map((t, i) => (i === rowIndex ? null : t.riskName)).filter(Boolean),
            );
            return register.filter((r) => r.riskName !== ownName && !chosenElsewhere.has(r.riskName));
        };

        body.innerHTML = working
            .map(
                (cause, i) => `
            <tr data-trigger-row data-index="${i}">
                <td class="px-2 py-1">
                    <select class="form-select" data-field="riskName">
                        <option value="">— Selecciona —</option>
                        ${optionsFor(i)
                            .map(
                                (r) =>
                                    `<option value="${sanitizeHTML(r.riskName)}" ${r.riskName === cause.riskName ? 'selected' : ''}>${sanitizeHTML(r.riskName)}</option>`,
                            )
                            .join('')}
                    </select>
                </td>
                <td class="px-2 py-1">
                    <input type="number" class="form-input" data-field="probability" min="0" max="100"
                        value="${cause.probability ?? ''}" placeholder="—">
                </td>
                <td class="px-2 py-1"><button type="button" class="btn btn-secondary text-sm" data-remove-trigger>✕</button></td>
            </tr>`,
            )
            .join('');

        body.querySelectorAll('[data-remove-trigger]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.syncTriggeredByDraftFromDom();
                const i = Number(btn.closest('[data-trigger-row]').dataset.index);
                state.fair.triggeredByDraft.splice(i, 1);
                this.renderTriggeredByRows();
            });
        });
    },

    // Lee las filas actualmente en el DOM y actualiza state.fair.triggeredByDraft — se llama
    // antes de cada re-render (agregar/quitar fila) y antes de guardar, mismo patrón que
    // syncWorkingFromDom() en App.Treatment.openControlsModal/App.RiskCascadeTree.openChangeTriggerModal.
    syncTriggeredByDraftFromDom() {
        document.querySelectorAll('#fair-triggered-by-body [data-trigger-row]').forEach((row) => {
            const i = Number(row.dataset.index);
            const rawProbability = row.querySelector('[data-field="probability"]').value.trim();
            state.fair.triggeredByDraft[i] = {
                riskName: row.querySelector('[data-field="riskName"]').value,
                probability: rawProbability === '' ? null : Number(rawProbability),
            };
        });
    },

    loadRegisteredRiskIntoForm(riskName) {
        const entry = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
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
        state.fair.riskCriteriaOverride = entry.riskCriteriaOverride || null;
        this.updateCriteriaOverrideStatus();
        // Historial de Revisiones y norma del catálogo: restaurados desde el Registro (no solo
        // de esta sesión del navegador) — ver el fix de persistencia en saveToRiskRegister/PUT
        // /api/register. Sin esto, retomar un riesgo ya revisado varias veces se vería como si
        // nunca se hubiera revisado.
        state.fair.reviewHistory = Array.isArray(entry.reviewHistory) ? entry.reviewHistory : [];
        this.renderReviewHistoryTable();
        state.fair.catalogStandard = entry.catalogStandard || null;
        state.fair.catalogCode = entry.catalogCode || null;
        this.showCatalogStandardLine();

        document.getElementById('fair-riskName').value = entry.riskName || '';
        document.getElementById('fair-riskDescription').value = entry.description || '';
        // entry viene de GET /api/register, que ya migra al formato nuevo (ver
        // normalizeTriggeredBy, backend/src/lib/register.js) — triggeredBy siempre es un array.
        state.fair.triggeredByDraft = (entry.triggeredBy || []).map((t) => ({ ...t }));
        this.renderTriggeredByRows();
        if (entry.asset && entry.asset !== '—') document.getElementById('fair-asset').value = entry.asset;
        // Restaura el vínculo real con el Catálogo de Activos (ver saveToRiskRegister).
        if (entry.assetId) state.quick.selectedAssetRef = { id: entry.assetId };
        // Gobernanza/Revisión y Plan de Seguridad (owner/reviewDate/securityPlan/etc.) ya no se
        // restauran aquí — no viven en el wizard (ver App.RiskManagement). Como registerEntryId
        // ya quedó fijado arriba, saveToRiskRegister() los conserva solos vía existingEntry al
        // volver a guardar, sin que el wizard tenga que tocarlos.
        document.getElementById('fair-risk-type').value = entry.riskType || 'amenaza';
        this.toggleRiskTypeLabels();

        // Bug real corregido: resetForm(false) de arriba pone estos 8 campos en blanco/default
        // (Amenaza, Efecto, Horizonte, Fuente/Confianza/Notas de Datos, Perfil de Atacante/
        // Defensa) y antes NUNCA se volvían a leer de `entry` — si el usuario re-simulaba y
        // guardaba (el flujo que el propio toast de abajo recomienda), saveToRiskRegister()
        // los sobreescribía en el backend con esos valores por defecto, borrando en silencio lo
        // documentado en el análisis original. El Registro SÍ guarda estos campos (ver
        // backend/src/routes/register.js) — restaurarlos aquí es el mismo criterio que ya sigue
        // restoreFairAnalysis() (el camino de borrador en localStorage) para los mismos campos.
        document.getElementById('fair-threat').value = entry.threat && entry.threat !== '—' ? entry.threat : '';
        document.getElementById('fair-effect').value = entry.effect || 'material';
        document.getElementById('fair-time-horizon').value = entry.timeHorizon || '1';
        document.getElementById('fair-data-source').value = entry.dataSource || App.OrgDefaults.defaults.dataSource;
        document.getElementById('fair-data-confidence').value =
            entry.dataConfidence || App.OrgDefaults.defaults.dataConfidence;
        document.getElementById('fair-data-notes').value = entry.dataNotes || '';
        // attackerKey/defenseKey son necesarios además para que Tratamiento calcule bien la
        // Reducción de ALE (updateReduccionALEAuto compara el Nivel de Defensa GUARDADO contra
        // uno objetivo) — dejarlos en su default corrompía ese cálculo en otra página, sin
        // ninguna señal visible de que el dato de origen ya no correspondía al riesgo real.
        if (entry.attackerKey) document.getElementById('fair-attacker-profile').value = entry.attackerKey;
        if (entry.defenseKey) document.getElementById('fair-defense-profile').value = entry.defenseKey;
        // Mismo trío que ya hace loadRiskIntoForm (el camino de borrador): sin esto, retomar un
        // riesgo NO deliberado desde el Registro lo reabría como si tuviera adversario — con los
        // perfiles a la vista y la Vulnerabilidad en automático, justo lo contrario de cómo se
        // analizó. El checkbox no se restauraba en ningún punto de esta función.
        const esDeliberada = this.inferDeliberateThreat(entry);
        document.getElementById('fair-deliberate-threat').checked = esDeliberada;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !esDeliberada);
        this.applyDeliberateThreatMode();
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
            // Bug real: antes esto era `setVulnManualOverride(true)` incondicional — cualquier
            // riesgo retomado quedaba marcado como "editado a mano" aunque nunca se hubiera
            // tocado, así que el autocálculo dejaba de aplicarse para siempre desde el primer
            // guardado. Ahora se restaura el estado REAL (ver vulnManualOverride, persistido
            // desde saveToRiskRegister/PUT /api/register).
            this.setVulnManualOverride(!!entry.vulnManualOverride);
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
        showToast(
            `"${sanitizeHTML(entry.riskName)}" cargado desde el Registro — corre la simulación (Paso 4) para ver resultados y tratamiento actualizados.`,
        );
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
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency,
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const total = { min: data.costoMinImpacto, mode: avgCost, max: data.costoMaxImpacto };
        const keys = LOSS_FORMS_KEYS;
        const defaultPct = {};
        keys.forEach((k) => {
            defaultPct[k] = k === 'respuesta' ? 100 : 0;
        });

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
        keys.forEach((k) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2';
            row.innerHTML = `
                <label for="lm-redistribute-${k}" class="text-sm" style="flex:1">${sanitizeHTML(LOSS_FORM_LABELS.tecnico[k])}</label>
                <input type="number" id="lm-redistribute-${k}" class="form-input" style="width:70px" min="0" max="100" value="${defaultPct[k]}">
                <span class="text-sm">%</span>
                <span id="lm-redistribute-${k}-amount" class="text-sm text-gray-500" style="width:90px; text-align:right">${fmt((total.mode * defaultPct[k]) / 100)}</span>
            `;
            rowsEl.appendChild(row);
        });
        Modal.footer.innerHTML = `
            <button id="lm-redistribute-skip-btn" class="btn btn-secondary">Dejar todo en "Costos de Respuesta"</button>
            <button id="lm-redistribute-confirm-btn" class="btn btn-primary">Confirmar Distribución</button>
        `;
        Modal.modal.classList.remove('hidden');

        const inputs = keys.map((k) => document.getElementById(`lm-redistribute-${k}`));
        const amountEls = keys.map((k) => document.getElementById(`lm-redistribute-${k}-amount`));
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
                amountEls[i].textContent = fmt((total.mode * pct) / 100);
            });
            sumEl.textContent = sum;
            sumAmountEl.textContent = fmt((total.mode * sum) / 100);
            const ok = Math.abs(sum - 100) < 0.001;
            warnEl.classList.toggle('hidden', ok);
            confirmBtn.disabled = !ok;
        };
        inputs.forEach((inp) => inp.addEventListener('input', recomputeSum));
        recomputeSum();

        const applyDistribution = (pctByKey) => {
            keys.forEach((k) => {
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
            keys.forEach((k, i) => {
                pctByKey[k] = getSafeNumber(inputs[i]);
            });
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
            try {
                await state.fair.pendingAutocalc;
            } catch (e) {
                /* el propio autocálculo ya avisó del error */
            }
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
        document
            .querySelectorAll('#fairAnalysisPage .wizard-step')
            .forEach((section) => section.classList.add('hidden'));
        document.getElementById(`fair-step-${step}`).classList.remove('hidden');
        updateProgressBar('fair-progress-bar', step, 4);
        if (step === 2) this.updateThreatReminder();
    },

    // El Agente de Amenaza (Paso 1, texto libre — ej. "Ex-empleado con llave del almacén") y
    // el Perfil de Atacante (Paso 2, select cerrado de 5 perfiles calibrados) describen al
    // mismo actor, pero son cosas distintas: uno es narrativa sin efecto en el cálculo, el
    // otro sí alimenta calculateVulnerability/suggestTefRange. Sin este recordatorio, elegir
    // el Perfil de Atacante en Paso 2 se sentía como una pregunta desconectada de lo que ya
    // se escribió en Paso 1.
    updateThreatReminder() {
        const reminderEl = document.getElementById('fair-threat-reminder');
        const threat = document.getElementById('fair-threat').value.trim();
        if (threat) {
            reminderEl.innerHTML = `Agente de Amenaza: <strong>${sanitizeHTML(threat)}</strong> — elige abajo a cuál de estos perfiles se parece más, para calibrar el cálculo.`;
            reminderEl.classList.remove('hidden');
        } else {
            reminderEl.classList.add('hidden');
        }
    },

    displayFairValidationErrors() {
        document.querySelectorAll('.input-error, .error-message').forEach((el) => {
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
                        warningEl.textContent =
                            'Advertencia: Min, Modo y Max son iguales. Esto elimina la incertidumbre para este factor.';
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
        container.innerHTML = LOSS_FORMS_KEYS.map(
            (key) => `
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
                ${key === 'reemplazo' ? '<span id="lm-asset-warning" class="range-warning hidden"></span>' : ''}
            </div>`,
        ).join('');
        this.refreshAllLossMagnitudeCompactDisplays();
        document.querySelectorAll('.fair-range-input').forEach((input) => {
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
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency,
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const min = fmt(getSafeNumber(document.getElementById(`lm-${key}-min`)));
        const max = fmt(getSafeNumber(document.getElementById(`lm-${key}-max`)));
        summaryEl.textContent = `Mín: ${min} · Máx: ${max}`;
        if (key === 'reemplazo') this.checkAssetReplacementCostWarning();
    },

    refreshAllLossMagnitudeCompactDisplays() {
        LOSS_FORMS_KEYS.forEach((key) => this.refreshLossMagnitudeCompactDisplay(key));
    },

    // Advertencia informativa (nunca bloquea el flujo): si el Costo de Reemplazo máximo
    // capturado supera el valor declarado del activo vinculado en el Catálogo, puede ser un
    // error de captura o un evento que también daña activos relacionados — el usuario decide.
    checkAssetReplacementCostWarning() {
        const warningEl = document.getElementById('lm-asset-warning');
        if (!warningEl) return;
        const assetRef = state.quick.selectedAssetRef;
        const asset = assetRef ? (state.quick.assets || []).find((a) => a.id === assetRef.id) : null;
        if (!asset) {
            warningEl.classList.add('hidden');
            return;
        }
        const max = getSafeNumber(document.getElementById('lm-reemplazo-max'));
        if (max > asset.valorEstimado) {
            const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
            warningEl.textContent = `Advertencia: el Costo de Reemplazo máximo (${fmt(max)}) supera el valor declarado de "${asset.nombre}" (${fmt(asset.valorEstimado)}). Verifica que no sea un error de captura, o documenta si este evento también daña activos relacionados.`;
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
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
            .map((key) => ({ key, mode: getSafeNumber(document.getElementById(`lm-${key}-mode`)) }))
            .filter((item) => document.getElementById(`lm-${item.key}-mode`));
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

        // Un id nuevo, marcado como "el vigente" para CADA clave de esta llamada — ver el
        // guardián documentado junto a FairWizard. Si otra llamada (esta misma función, para
        // alguna de estas claves) se dispara mientras esta sigue en vuelo, esa otra llamada
        // vuelve a marcar esa clave con SU propio id más nuevo, y esta respuesta (cuando
        // llegue) ya no podrá escribirla — pero sí puede seguir escribiendo cualquier otra
        // clave de este mismo lote que nadie más haya vuelto a pedir mientras tanto.
        const requestId = ++this._nextLossMagnitudeRequestId;
        items.forEach(({ key }) => {
            this._lossMagnitudeRequestIds[key] = requestId;
        });

        let data;
        try {
            data = await App.Api.request('/api/autocalc/loss-magnitude', {
                method: 'POST',
                body: { items, confidence },
            });
        } catch (err) {
            const stillCurrentKeys = items.filter(({ key }) => this._lossMagnitudeRequestIds[key] === requestId);
            if (stillCurrentKeys.length === 0) return true; // ninguna de estas claves sigue siendo la más reciente
            showToast(err.userMessage || 'No se pudo calcular la Magnitud de Pérdida automáticamente.');
            stillCurrentKeys.forEach(({ key }) => {
                const summaryEl = document.getElementById(`lm-${key}-compact-summary`);
                if (summaryEl && !summaryEl.classList.contains('hidden')) {
                    summaryEl.innerHTML =
                        '<span class="text-red-600">No se pudo calcular — revisa tu conexión o activa "Ajustar manualmente".</span>';
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
            if (this._lossMagnitudeRequestIds[key] !== requestId) return; // respuesta vieja para esta clave, ya superada
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
        document
            .querySelectorAll(
                '#loss-magnitude-forms input[data-min="true"], #loss-magnitude-forms input[data-max="true"]',
            )
            .forEach((el) => {
                el.readOnly = !isManual;
                el.classList.toggle('bg-gray-100', !isManual);
            });
        LOSS_FORMS_KEYS.forEach((key) => {
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
            state.fair.riskCriteriaOverride = null;
            this.updateCriteriaOverrideStatus();
            document.getElementById('fair-riskName').value = '';
            document.getElementById('fair-riskDescription').value = '';
            document.getElementById('fair-asset').value = '';
            document.getElementById('fair-asset-suggestion').classList.add('hidden');
            state.quick.currentRiskId = null;
            state.quick.selectedCatalogRef = null;
            state.quick.selectedAssetRef = null;
            state.fair.catalogStandard = null;
            state.fair.catalogCode = null;
            this.showCatalogStandardLine();
            document.getElementById('fair-threat').value = '';
            document.getElementById('fair-effect').value = 'material';
            document.getElementById('fair-risk-type').value = 'amenaza';
            document.getElementById('fair-time-horizon').value = '1';
            state.fair.triggeredByDraft = [];
            this.renderTriggeredByRows();
            this.toggleRiskTypeLabels();
            document.getElementById('fair-data-source').value = App.OrgDefaults.defaults.dataSource;
            document.getElementById('fair-data-confidence').value = App.OrgDefaults.defaults.dataConfidence;
            document.getElementById('fair-data-notes').value = '';
            document.getElementById('fair-simulation-seed').value = '0';
            document.getElementById('fair-seed-used').textContent = '';
            document.getElementById('fair-review-history-body').innerHTML = '';
            document.getElementById('fair-review-history-container').classList.add('hidden');
            document.getElementById('fair-sensitivity-list').innerHTML = '';
            document.getElementById('fair-sensitivity-container').classList.add('hidden');
            state.fair.lastSensitivity = null;
            document.getElementById('nash-results').classList.add('hidden');
            document.getElementById('nash-m').value = '1';
            document.getElementById('nash-cost-attacker').value = '';
            document.getElementById('nash-cost-defense').value = '';
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
            document.querySelectorAll('#loss-magnitude-forms input').forEach((input) => (input.value = '0'));
            this.setLossMagnitudeManualOverride(false);
            document.querySelectorAll('.range-warning').forEach((el) => el.classList.add('hidden'));
            document.querySelectorAll('.error-message').forEach((el) => el.classList.add('hidden'));
            document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
            document.getElementById('simulation-results-container').classList.add('hidden');
            document.getElementById('fair-treatment-cta').classList.add('hidden');
            document.getElementById('fair-riskmgmt-cta').classList.add('hidden');
            state.fair.simulatedALE = 0;
            state.fair.lastAnnualLosses = null;
            state.fair.lastEvaluation = null;
            state.fair.lastSeed = null;
            state.fair.reviewHistory = [];
            localStorage.removeItem('fairLastAnalysis');
            document.getElementById('fair-resume-banner').classList.add('hidden');
            App.RiskSummaryBar.render();
            if (state.fair.fairResultsChart) {
                state.fair.fairResultsChart.destroy();
                state.fair.fairResultsChart = null;
            }
            this.navigateWizard(1, true);
        };

        if (confirm) {
            Modal.confirm(
                '¿Está seguro de que desea borrar todos los datos del análisis FAIR y empezar de nuevo?',
                doReset,
            );
        } else {
            doReset();
        }
    },

    // Lee las 9 categorías de Magnitud de Pérdida directo del DOM del Paso 3 — reusado tanto por
    // runMonteCarloSimulation como por calculateNashEquilibrium (que necesita el mismo objeto
    // para sumar el Valor en Juego), en vez de duplicar este mismo forEach dos veces.
    buildLossMagnitudesFromDom() {
        const lossMagnitudes = {};
        LOSS_FORMS_KEYS.forEach((key) => {
            lossMagnitudes[key] = {
                min: getSafeNumber(document.getElementById(`lm-${key}-min`)),
                mode: getSafeNumber(document.getElementById(`lm-${key}-mode`)),
                max: getSafeNumber(document.getElementById(`lm-${key}-max`)),
            };
        });
        return lossMagnitudes;
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
        document.querySelector('#simulation-loader p').textContent =
            `Ejecutando ${iterations.toLocaleString('es-MX')} simulaciones en el servidor...`;

        const seed = getSafeNumber(document.getElementById('fair-simulation-seed'));
        const tef = {
            min: getSafeNumber(document.getElementById('tef-min')),
            mode: getSafeNumber(document.getElementById('tef-mode')),
            max: getSafeNumber(document.getElementById('tef-max')),
        };
        const vuln = {
            min: getSafeNumber(document.getElementById('vuln-min')),
            mode: getSafeNumber(document.getElementById('vuln-mode')),
            max: getSafeNumber(document.getElementById('vuln-max')),
        };
        const lossMagnitudes = this.buildLossMagnitudesFromDom();
        const riskType = document.getElementById('fair-risk-type').value;
        const currency = 'USD';
        const deliberada = document.getElementById('fair-deliberate-threat').checked;

        try {
            const result = await App.Api.request('/api/simulate', {
                method: 'POST',
                body: {
                    iterations,
                    seed,
                    tef,
                    vuln,
                    // La Vulnerabilidad simulada (TCap vs. RS, ver sampleVulnerabilityFromProfiles
                    // en backend/src/lib/autocalc.js) necesita estos 4 campos — sin
                    // attackerKey/defenseKey (Análisis Rápido, o riesgos previos a este cambio) el
                    // backend cae solo al `vuln` de arriba, retrocompatible al 100%.
                    // Amenaza NO deliberada: los perfiles no viajan. No hay adversario que
                    // pueda escalar ni contra quien contender, así que el backend debe muestrear
                    // la Vulnerabilidad del rango capturado a mano y no del modelo TCap/RS (ver
                    // applyDeliberateThreatMode). `undefined` es justo lo que /api/simulate
                    // interpreta como "no vienen" — mandar null daría 400.
                    attackerKey: deliberada ? state.fair.attackerKey : undefined,
                    defenseKey: deliberada ? state.fair.defenseKey : undefined,
                    confidence: document.getElementById('fair-data-confidence').value,
                    vulnManualOverride: !deliberada || document.getElementById('vuln-manual-override').checked,
                    lossMagnitudes,
                    riskType,
                    currency,
                    // Sin override, se manda igual el criterio global — /api/simulate lo trata
                    // como una sobreescritura explícita para ESTA corrida en cualquier caso (ver
                    // POST /api/simulate), así que enviarlo siempre es consistente y no cambia
                    // nada cuando no hay override por riesgo.
                    riskCriteria: state.fair.riskCriteriaOverride
                        ? { ...state.config.riskCriteria, ...state.fair.riskCriteriaOverride }
                        : state.config.riskCriteria,
                },
            });
            await this.displaySimulationResults(result);
        } catch (error) {
            console.error('Simulation Error:', error);
            Modal.alert(
                error.userMessage || 'Error al ejecutar la simulación. Por favor, revise sus entradas.',
                'Error de Simulación',
            );
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
        const maxAbs = Math.max(...top.map((s) => Math.abs(s.correlation)), 0.0001);
        container.innerHTML = top
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
        document.getElementById('fair-sensitivity-container').classList.remove('hidden');
    },

    // Equilibrio de Nash del juego de contienda de Tullock (POST /api/autocalc/nash-equilibrium)
    // — a diferencia de la Vulnerabilidad del Paso 2 (esfuerzo fijo, los perfiles curados), aquí
    // Atacante y Defensa ELIGEN cuánto esfuerzo invertir dado el Valor en Juego (auto-sumado de
    // Magnitud de Pérdida) y su propio costo por unidad de esfuerzo. Análisis exploratorio "qué
    // pasaría si" — nunca alimenta la simulación real, botón explícito, no autocálculo.
    async calculateNashEquilibrium() {
        if (!state.fair.attackerKey || !state.fair.defenseKey) {
            Modal.alert(
                'Completa el Paso 1 (Perfil de Atacante y Defensa) antes de calcular cuánto le conviene esforzarse a cada lado.',
            );
            return;
        }
        const m = getSafeNumber(document.getElementById('nash-m'));
        const costAttacker = getSafeNumber(document.getElementById('nash-cost-attacker'));
        const costDefense = getSafeNumber(document.getElementById('nash-cost-defense'));
        if (m <= 0 || costAttacker <= 0 || costDefense <= 0) {
            Modal.alert(
                'Los 3 campos (qué tan decisivo es el esfuerzo, y el costo de esforzarse más para cada lado) deben ser mayores a 0.',
            );
            return;
        }

        const btn = document.getElementById('nash-calculate-btn');
        btn.disabled = true;
        try {
            const result = await App.Api.request('/api/autocalc/nash-equilibrium', {
                method: 'POST',
                body: {
                    attackerKey: state.fair.attackerKey,
                    defenseKey: state.fair.defenseKey,
                    m,
                    costAttacker,
                    costDefense,
                    lossMagnitudes: this.buildLossMagnitudesFromDom(),
                },
            });

            document.getElementById('nash-attacker-effort').textContent = result.attackerEffort.toFixed(1);
            document.getElementById('nash-defense-effort').textContent = result.defenseEffort.toFixed(1);
            document.getElementById('nash-equilibrium-vuln').textContent =
                `${result.equilibriumVulnerability.toFixed(1)}%`;
            document.getElementById('nash-fixed-vuln').textContent = `${result.fixedEffortVulnerability.toFixed(1)}%`;
            document.getElementById('nash-value-at-stake').textContent = formatCurrency(result.valueAtStake);
            document.getElementById('nash-attacker-payoff').textContent = formatCurrency(result.attackerPayoff);
            document.getElementById('nash-defense-loss').textContent = formatCurrency(result.defenseLoss);
            document.getElementById('nash-not-converged-warning').classList.toggle('hidden', result.converged);
            document.getElementById('nash-results').classList.remove('hidden');
        } catch (error) {
            Modal.alert(
                error.userMessage || 'Error al calcular el Equilibrio de Nash. Por favor, revise sus entradas.',
                'Error de Cálculo',
            );
        } finally {
            btn.disabled = false;
        }
    },

    // Curva de Excedencia de Pérdidas (LEC) — la entrega insignia de FAIR. A diferencia del
    // histograma (que enseña la FORMA de la distribución), responde directamente "¿qué
    // probabilidad hay de perder más de X en un año?", que es la pregunta con la que se decide.
    // Se superponen los dos umbrales que el usuario ya declaró en Criterios de Riesgo: donde la
    // curva los cruza está su probabilidad de pasarse de lo que dijo tolerar.
    renderLossExceedanceCurve() {
        const contenedor = document.getElementById('fair-lec-container');
        const curva = state.fair.lastLossExceedanceCurve;
        if (!contenedor) return;
        if (!Array.isArray(curva) || curva.length === 0) {
            contenedor.classList.add('hidden');
            return;
        }
        contenedor.classList.remove('hidden');
        const simple = App.UIMode.mode === 'simple';

        const criterios = state.config.riskCriteria || {};
        const aleCritico = typeof criterios.aleCritico === 'number' ? criterios.aleCritico : null;
        const aleAceptable =
            aleCritico != null && typeof criterios.aleAceptablePercent === 'number'
                ? aleCritico * (criterios.aleAceptablePercent / 100)
                : null;

        const punto = (p) => ({ x: p.loss, y: p.probability });
        const datasets = [
            {
                label: simple ? 'Con tus controles de hoy' : 'Riesgo Actual',
                data: curva.map(punto),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.2,
                pointRadius: 0,
            },
        ];
        // La curva del Inherente solo existe para Amenaza (ver calculateInherentRiskFromSimulation).
        const inherente = state.fair.lastInherentLossExceedanceCurve;
        if (Array.isArray(inherente) && inherente.length > 0) {
            datasets.push({
                label: simple ? 'Si no tuvieras ningún control' : 'Riesgo Inherente',
                data: inherente.map(punto),
                borderColor: '#9ca3af',
                borderDash: [6, 4],
                fill: false,
                tension: 0.2,
                pointRadius: 0,
            });
        }
        // Los umbrales se dibujan como series verticales de 2 puntos en vez de con un plugin de
        // anotaciones — evita sumar otra dependencia por CDN solo para dos líneas rectas.
        const umbral = (valor, etiqueta, color) => ({
            label: etiqueta,
            data: [
                { x: valor, y: 0 },
                { x: valor, y: 100 },
            ],
            borderColor: color,
            borderDash: [4, 4],
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
        });
        if (aleAceptable != null) {
            datasets.push(umbral(aleAceptable, simple ? 'Lo que aceptas perder' : 'Pérdida Aceptable', '#16a34a'));
        }
        if (aleCritico != null) {
            datasets.push(umbral(aleCritico, simple ? 'Tu límite' : 'Pérdida Crítica', '#dc2626'));
        }

        const ctx = document.getElementById('fair-lec-chart').getContext('2d');
        if (state.fair.fairLecChart) state.fair.fairLecChart.destroy();
        state.fair.fairLecChart = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        title: { display: true, text: simple ? 'Si pierdes más de…' : 'Pérdida Anual (USD)' },
                        ticks: { callback: (v) => formatCurrency(v) },
                    },
                    y: {
                        min: 0,
                        max: 100,
                        title: {
                            display: true,
                            text: simple ? '…qué tan probable es (%)' : 'Probabilidad de excederlo (%)',
                        },
                        ticks: { callback: (v) => `${v}%` },
                    },
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (c) =>
                                `${c.dataset.label}: ${c.parsed.y.toFixed(1)}% de perder más de ${formatCurrency(c.parsed.x)}`,
                        },
                    },
                },
            },
        });
    },

    // Pérdida = Frecuencia x Vulnerabilidad x Magnitud, así que basta con que UNO de los tres
    // factores quede en cero para que todo el análisis valga 0 — y hasta ahora eso pasaba sin decir
    // nada: el riesgo se guardaba en el Registro con ALE 0, entraba al Pareto y a la matriz como si
    // de verdad no costara nada, y el usuario no tenía forma de saber que solo le faltó llenar un
    // campo. El caso más fácil de topar es una amenaza NO deliberada: sin Perfil de Atacante no hay
    // Frecuencia sugerida, así que ese campo se queda vacío si nadie lo llena.
    //
    // Es un AVISO, no un bloqueo: nombra el factor culpable y deja seguir, por si se está
    // explorando a propósito.
    renderZeroAleWarning(summary) {
        const el = document.getElementById('fair-zero-ale-warning');
        if (!el) return;
        if (!summary || summary.average !== 0) {
            el.classList.add('hidden');
            return;
        }

        const modo = (prefix) => getSafeNumber(document.getElementById(`${prefix}-mode`));
        const culpables = [];
        if (modo('tef') === 0) culpables.push('la Frecuencia');
        if (modo('vuln') === 0) culpables.push('la Vulnerabilidad');
        if (LOSS_FORMS_KEYS.every((key) => modo(`lm-${key}`) === 0)) {
            culpables.push('la Magnitud de Pérdida (ninguna categoría tiene monto)');
        }

        const detalle = culpables.length
            ? `Está en cero: <strong>${culpables.join('</strong>, <strong>')}</strong>.`
            : 'Revisa que Frecuencia, Vulnerabilidad y Magnitud de Pérdida tengan valores.';
        el.innerHTML = `⚠️ La pérdida anual esperada dio <strong>$0</strong>, así que este análisis todavía no dice nada. ${detalle} Complétalo y vuelve a simular — si lo guardas así, este riesgo va a aparecer en el Registro y en la matriz como si no costara nada, y va a quedar hasta el final de las listas de prioridad.`;
        el.classList.remove('hidden');
    },

    async displaySimulationResults(result) {
        const { summary, evaluation, inherentEvaluation, sensitivity, annualLosses } = result;
        this.renderZeroAleWarning(summary);
        state.fair.lastLossExceedanceCurve = result.lossExceedanceCurve || null;
        state.fair.lastInherentLossExceedanceCurve = result.inherentLossExceedanceCurve || null;
        state.fair.lastCalibrationVersion = result.calibrationVersion ?? null;
        state.fair.simulatedALE = summary.average;
        state.fair.lastAnnualLosses = annualLosses;
        state.fair.lastEvaluation = evaluation;
        state.fair.lastSeed = result.usedSeed;
        App.RiskSummaryBar.render();

        document.getElementById('ale-result').textContent = formatCurrency(summary.average);
        document.getElementById('median-loss-result').textContent = formatCurrency(summary.median);
        document.getElementById('min-loss-result').textContent = formatCurrency(summary.min);
        document.getElementById('max-loss-result').textContent = formatCurrency(summary.max);
        document.getElementById('percentile-90-result').textContent = `> ${formatCurrency(summary.p90)}`;
        document.getElementById('cvar-95-result').textContent = formatCurrency(summary.cvar95);

        // Riesgo Inherente REAL (sin ningún control) — null para Oportunidad (ver
        // calculateInherentRiskFromSimulation, backend). Se oculta la línea entera en vez de
        // mostrar "$NaN"/"—", mismo criterio que el resto de esta vista con datos ausentes.
        const inherenteLine = document.getElementById('fair-inherente-line');
        if (typeof summary.inherentALE === 'number') {
            inherenteLine.classList.remove('hidden');
            document.getElementById('fair-inherente-result').textContent = formatCurrency(summary.inherentALE);
        } else {
            inherenteLine.classList.add('hidden');
        }

        // Evaluación del Riesgo (ISO 31000): ya viene calculada por el backend contra los
        // Criterios de Riesgo guardados — solo se traduce `severity` a clases Tailwind.
        const banner = document.getElementById('fair-evaluation-banner');
        banner.className = `p-4 rounded-lg mb-6 border-l-4 ${severityToClasses(evaluation.severity)}`;
        const justificationText =
            App.UIMode.mode === 'simple'
                ? simpleEvaluationMessage(
                      evaluation,
                      summary.average,
                      summary.cvar95,
                      state.fair.riskType,
                      formatCurrency,
                  )
                : evaluation.justification;
        banner.innerHTML = `
            <p class="font-bold text-lg">Evaluación: ${evaluation.level}</p>
            <p class="text-sm mt-1">${justificationText}</p>
        `;

        document.getElementById('fair-seed-used').textContent =
            `Semilla usada: ${result.usedSeed} (anótala para reproducir exactamente esta corrida)`;

        // Análisis de Sensibilidad (RIMS RA.1-2015, 6.3.4.3)
        state.fair.lastSensitivity = sensitivity;
        this.renderSensitivity(sensitivity);

        // Un Equilibrio de Nash calculado antes de esta corrida quedó contra un Valor en Juego
        // que puede haber cambiado — se oculta para no dejar un resultado obsoleto en pantalla.
        document.getElementById('nash-results').classList.add('hidden');

        // Historial de Revisiones (ISO 31000, cláusula 6.6 — Monitoreo): cada corrida de
        // este mismo análisis queda registrada, para ver cómo cambió el riesgo entre revisiones.
        // Se persiste al Registro (ver saveToRiskRegister) para que un riesgo retomado después
        // (loadRegisteredRiskIntoForm) muestre su historial real, no solo el de esta sesión.
        if (!Array.isArray(state.fair.reviewHistory)) state.fair.reviewHistory = [];
        state.fair.reviewHistory.push({
            date: new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }),
            ale: formatCurrency(summary.average),
            evaluationLevel: evaluation.level,
        });
        if (state.fair.reviewHistory.length > 20) state.fair.reviewHistory.shift();
        this.renderReviewHistoryTable();

        // Se guarda en state para que App.UIMode.applyLabels() pueda recalcular este texto
        // si el usuario cambia de Modo Simple/Técnico DESPUÉS de simular — si no, se
        // quedaría con la redacción de cuando corrió la simulación hasta la próxima corrida.
        state.fair.lastThresholdK = `$${summary.exceedanceThreshold / 1000}k`;
        App.UIMode.applyProbThresholdLabel();
        document.getElementById('prob-threshold-result').textContent = `${summary.probExceedance.toFixed(1)}%`;

        // El histograma se construye ANTES de guardar en el Registro a propósito —
        // saveToRiskRegister() lee state.fair.fairResultsChart para guardar chartLabels/
        // chartData (ver App.FairExport.buildFullRiskReportSection, que los usa para
        // redibujar este mismo histograma en el PDF). Guardarlo primero y crear el gráfico
        // después dejaba el Registro con los datos de la corrida ANTERIOR (o null, en la
        // primera simulación de la sesión) — el histograma de este riesgo nunca aparecía en
        // el PDF, o aparecía con la corrida equivocada.
        const ctx = document.getElementById('fair-results-chart').getContext('2d');
        const { labels, binCounts } = buildHistogramBins(annualLosses, summary.max);
        if (state.fair.fairResultsChart) {
            state.fair.fairResultsChart.destroy();
        }
        state.fair.fairResultsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
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
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Nº de Simulaciones' },
                    },
                    x: {
                        title: { display: true, text: 'Pérdida Anual Estimada (miles de USD)' },
                        ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 },
                    },
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            title: (context) => `Rango de Pérdida: ~${context[0].label}`,
                            label: (context) => `Simulaciones: ${context.parsed.y}`,
                        },
                    },
                },
            },
        });

        this.renderLossExceedanceCurve();

        await App.FairRegister.saveToRiskRegister(summary, evaluation, inherentEvaluation);

        // Tratamiento (Mitigar/Transferir/Evitar/Aceptar) ya no vive en el wizard — ver
        // #treatmentPage / App.Treatment. No aplica a una Oportunidad (ISO 31000, 6.5 asume que
        // la base es una pérdida a reducir), así que el CTA se oculta para ese caso.
        const isOpportunity = document.getElementById('fair-risk-type').value === 'oportunidad';
        document.getElementById('fair-treatment-cta').classList.toggle('hidden', isOpportunity);
        // Gobernanza/Revisión y Plan de Seguridad tampoco viven ya en el wizard — ver
        // #riskMgmtPage / App.RiskManagement. A diferencia de Tratamiento, sí aplica a
        // Oportunidad, así que este CTA nunca se oculta por tipo de riesgo.
        document.getElementById('fair-riskmgmt-cta').classList.remove('hidden');

        this.persistFairAnalysis();
    },

    persistFairAnalysis() {
        try {
            const chart = state.fair.fairResultsChart;
            if (!chart) return;
            const lossFormsKeys = LOSS_FORMS_KEYS;
            const lossForms = {};
            lossFormsKeys.forEach((key) => {
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
                riskCriteriaOverride: state.fair.riskCriteriaOverride || null,
                riskName: document.getElementById('fair-riskName').value,
                riskDescription: document.getElementById('fair-riskDescription').value,
                asset: document.getElementById('fair-asset').value,
                // Mismo vínculo real que saveToRiskRegister/saveDraftToRisksList — sin esto, la
                // advertencia de Costo de Reemplazo vs. valor del activo (ver
                // checkAssetReplacementCostWarning) queda inactiva al reanudar un borrador.
                assetId: state.quick.selectedAssetRef ? state.quick.selectedAssetRef.id : null,
                threat: document.getElementById('fair-threat').value,
                effect: document.getElementById('fair-effect').value,
                riskType: document.getElementById('fair-risk-type').value,
                timeHorizon: document.getElementById('fair-time-horizon').value,
                dataSource: document.getElementById('fair-data-source').value,
                dataConfidence: document.getElementById('fair-data-confidence').value,
                dataNotes: document.getElementById('fair-data-notes').value,
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
            if (!raw) {
                banner.classList.add('hidden');
                return;
            }
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
            state.fair.riskCriteriaOverride = data.riskCriteriaOverride || null;
            this.updateCriteriaOverrideStatus();

            document.getElementById('fair-riskName').value = data.riskName || '';
            document.getElementById('fair-riskDescription').value = data.riskDescription || '';
            document.getElementById('fair-asset').value = data.asset || '';
            state.quick.selectedAssetRef = data.assetId ? { id: data.assetId } : null;
            document.getElementById('fair-threat').value = data.threat || '';
            document.getElementById('fair-effect').value = data.effect || 'material';
            document.getElementById('fair-risk-type').value = data.riskType || 'amenaza';
            document.getElementById('fair-time-horizon').value = data.timeHorizon || '1';
            this.toggleRiskTypeLabels();
            document.getElementById('fair-data-source').value = data.dataSource || 'experto-sin-calibrar';
            document.getElementById('fair-data-confidence').value = data.dataConfidence || 'medio';
            document.getElementById('fair-data-notes').value = data.dataNotes || '';
            document.getElementById('fair-attacker-profile').value = data.attackerKey || 'empleado-desleal';
            document.getElementById('fair-defense-profile').value = data.defenseKey || 'estandar';
            const esDeliberada = this.inferDeliberateThreat(data);
            document.getElementById('fair-deliberate-threat').checked = esDeliberada;
            document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !esDeliberada);
            const ponderacion = parseFloat(data.deliberateThreatPonderation) || 0.7;
            document.getElementById('fair-deliberate-ponderation').value = ponderacion;
            document.getElementById('fair-deliberate-ponderation-value').textContent = `x${ponderacion.toFixed(2)}`;
            this.applyDeliberateThreatMode();
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
                App.RiskSummaryBar.render();

                if (data.results.sensitivity) {
                    state.fair.lastSensitivity = data.results.sensitivity;
                    this.renderSensitivity(data.results.sensitivity);
                }

                if (data.lastSeed) {
                    state.fair.lastSeed = data.lastSeed;
                    document.getElementById('fair-seed-used').textContent =
                        `Semilla usada: ${data.lastSeed} (anótala para reproducir exactamente esta corrida)`;
                }
                if (Array.isArray(data.reviewHistory)) {
                    state.fair.reviewHistory = data.reviewHistory;
                    document.getElementById('fair-review-history-body').innerHTML = data.reviewHistory
                        .map(
                            (entry) =>
                                `<tr class="border-b"><td class="py-1">${entry.date}</td><td>${entry.ale}</td><td>${entry.evaluationLevel}</td></tr>`,
                        )
                        .join('');
                    document
                        .getElementById('fair-review-history-container')
                        .classList.toggle('hidden', data.reviewHistory.length < 2);
                }

                document.getElementById('simulation-results-container').classList.remove('hidden');
                document
                    .getElementById('fair-treatment-cta')
                    .classList.toggle('hidden', (data.riskType || 'amenaza') === 'oportunidad');
                document.getElementById('fair-riskmgmt-cta').classList.remove('hidden');

                const ctx = document.getElementById('fair-results-chart').getContext('2d');
                if (state.fair.fairResultsChart) state.fair.fairResultsChart.destroy();
                const currency = data.results.currency || 'USD';
                state.fair.fairResultsChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.results.chartLabels,
                        datasets: [
                            {
                                label: 'Frecuencia de Pérdida Anual',
                                data: data.results.chartData,
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
                                title: { display: true, text: `Pérdida Anual Estimada (miles de ${currency})` },
                                ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 },
                            },
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    title: (context) => `Rango de Pérdida: ~${context[0].label}`,
                                    label: (context) => `Simulaciones: ${context.parsed.y}`,
                                },
                            },
                        },
                    },
                });

                this.navigateWizard(4, true);
                showToast('Se restauró tu último análisis FAIR guardado en este navegador.');
            }
            document.getElementById('fair-resume-banner').classList.add('hidden');
            return true;
        } catch (e) {
            console.error('No se pudo restaurar el análisis FAIR guardado:', e);
            return false;
        }
    },
};

App.FairWizard = FairWizard;
