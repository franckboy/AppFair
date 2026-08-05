import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import {
    LOSS_FORMS_KEYS,
    LOSS_FORM_LABELS,
    LOSS_FIELD_LABELS,
    buildHistogramBins,
    computeSuggestedTef,
    debounce,
    getSafeNumber,
    sanitizeHTML,
    sensitivityLabel,
    severityToClasses,
    showToast,
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
        document.getElementById('fair-owner').value = data.owner || App.OrgDefaults.defaults.owner;
        document.getElementById('fair-data-source').value = data.dataSource || App.OrgDefaults.defaults.dataSource;
        document.getElementById('fair-data-confidence').value =
            data.dataConfidence || App.OrgDefaults.defaults.dataConfidence;
        if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
        if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
        document.getElementById('fair-deliberate-threat').checked = !!data.isDeliberate;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !data.isDeliberate);
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
        [
            'fair-costoControlAnual',
            'fair-reduccionALE',
            'fair-mitigar-fiabilidad',
            'fair-mitigar-retraso',
            'fair-seguro-prima',
            'fair-seguro-deducible',
            'fair-seguro-limite',
            'fair-seguro-fiabilidad',
            'fair-seguro-retraso',
            'fair-evitar-costo',
            'fair-evitar-fiabilidad',
            'fair-evitar-retraso',
        ].forEach((id) => {
            document.getElementById(id).addEventListener('input', debouncedUpdateTreatmentView);
        });
        document.getElementById('fair-seguro-sin-limite').addEventListener('change', (e) => {
            const limiteInput = document.getElementById('fair-seguro-limite');
            limiteInput.disabled = e.target.checked;
            limiteInput.classList.toggle('bg-gray-100', e.target.checked);
            this.updateTreatmentView();
        });
        document
            .getElementById('fair-aceptar-justificacion')
            .addEventListener('input', () => this.persistFairAnalysis());
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
        document
            .getElementById('fair-mitigar-defensa-objetivo')
            .addEventListener('change', () => this.updateReduccionALEAuto());
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
        document
            .getElementById('selectAllHistory')
            .addEventListener('change', (e) =>
                App.FairRegister.toggleSelectAll('quick-concentrated-table-body', e.target.checked),
            );
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

        let data;
        try {
            data = await App.Api.request('/api/autocalc/attacker-defense-summary', {
                method: 'POST',
                body: { attackerKey, defenseKey },
            });
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

        const rowsHTML = (profile) =>
            Object.entries(profile)
                .filter(([key]) => key !== 'name')
                .map(
                    ([key, value]) =>
                        `<span class="inline-block mr-3 capitalize">${key}: <strong>${value}%</strong></span>`,
                )
                .join('');

        const diffClass = differential >= 0 ? 'text-red-700' : 'text-green-700';
        const diffText =
            differential >= 0 ? 'el atacante supera a tu defensa actual' : 'tu defensa actual supera al atacante';

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
                method: 'POST',
                body: { currentDefenseKey: state.fair.defenseKey, targetDefenseKey: objetivoKey },
            });
        } catch (err) {
            explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
            return;
        }

        document.getElementById('fair-reduccionALE').value = data.reductionPercent;
        explanationEl.textContent = `Calculado como: pasar de tu defensa actual (${data.currentScore.toFixed(0)}%) a "${state.quick.defenseProfiles[objetivoKey].name}" (${data.targetScore.toFixed(0)}%) = ${data.reductionPercent}% de reducción estimada.`;

        if (this.updateTreatmentView) this.updateTreatmentView();
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

        let data;
        try {
            data = await App.Api.request('/api/autocalc/vulnerability', {
                method: 'POST',
                body: { attackerKey: state.fair.attackerKey, defenseKey: state.fair.defenseKey, confidence },
            });
        } catch (err) {
            explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
            return;
        }

        document.getElementById('vuln-min').value = data.min;
        document.getElementById('vuln-mode').value = data.mode;
        document.getElementById('vuln-max').value = data.max;

        const confidenceLabel = { alto: 'Alta', medio: 'Media', bajo: 'Baja' }[confidence] || 'Media';
        explanationEl.textContent = `Calculado como: Factor de Amenaza (${data.attackerScore.toFixed(0)}%) × [1 − Nivel de Defensa (${data.defenseScore.toFixed(0)}%)] = ${data.mode}%. Rango ±según tu Nivel de Confianza declarado (${confidenceLabel}).`;
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
        document.getElementById('fair-riskName').value = data.riskName || '';
        this.populateTriggeredByOptions();
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
        if (data.triggeredByRiskName) document.getElementById('fair-triggered-by').value = data.triggeredByRiskName;

        if (data.attackerKey) document.getElementById('fair-attacker-profile').value = data.attackerKey;
        if (data.defenseKey) document.getElementById('fair-defense-profile').value = data.defenseKey;
        document.getElementById('fair-deliberate-threat').checked = !!data.isDeliberate;
        document.getElementById('fair-deliberate-ponderation-container').classList.toggle('hidden', !data.isDeliberate);
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

        register
            .filter((r) => r.riskName !== ownName)
            .forEach((r) => {
                const opt = document.createElement('option');
                opt.value = r.riskName;
                opt.textContent = r.riskName;
                select.appendChild(opt);
            });

        if (Array.from(select.options).some((opt) => opt.value === currentValue)) {
            select.value = currentValue;
        }
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

        document.getElementById('fair-riskName').value = entry.riskName || '';
        document.getElementById('fair-riskDescription').value = entry.description || '';
        this.populateTriggeredByOptions();
        document.getElementById('fair-triggered-by').value = entry.triggeredByRiskName || '';
        if (entry.asset && entry.asset !== '—') document.getElementById('fair-asset').value = entry.asset;
        // Restaura el vínculo real con el Catálogo de Activos (ver saveToRiskRegister).
        if (entry.assetId) state.quick.selectedAssetRef = { id: entry.assetId };
        if (entry.owner && entry.owner !== '—') document.getElementById('fair-owner').value = entry.owner;
        if (entry.securityPlan && entry.securityPlan !== '—')
            document.getElementById('fair-security-plan').value = entry.securityPlan;
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
    },

    refreshAllLossMagnitudeCompactDisplays() {
        LOSS_FORMS_KEYS.forEach((key) => this.refreshLossMagnitudeCompactDisplay(key));
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

        let data;
        try {
            data = await App.Api.request('/api/autocalc/loss-magnitude', {
                method: 'POST',
                body: { items, confidence },
            });
        } catch (err) {
            showToast(err.userMessage || 'No se pudo calcular la Magnitud de Pérdida automáticamente.');
            items.forEach(({ key }) => {
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
            document.getElementById('fair-riskName').value = '';
            document.getElementById('fair-riskDescription').value = '';
            document.getElementById('fair-asset').value = '';
            document.getElementById('fair-asset-suggestion').classList.add('hidden');
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
            document.querySelectorAll('#loss-magnitude-forms input').forEach((input) => (input.value = '0'));
            this.setLossMagnitudeManualOverride(false);
            document.querySelectorAll('.range-warning').forEach((el) => el.classList.add('hidden'));
            document.querySelectorAll('.error-message').forEach((el) => el.classList.add('hidden'));
            document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
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
            Modal.confirm(
                '¿Está seguro de que desea borrar todos los datos del análisis FAIR y empezar de nuevo?',
                doReset,
            );
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
        const lossMagnitudes = {};
        LOSS_FORMS_KEYS.forEach((key) => {
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
                body: {
                    iterations,
                    seed,
                    tef,
                    vuln,
                    lossMagnitudes,
                    riskType,
                    currency,
                    riskCriteria: state.config.riskCriteria,
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

    // Traduce el `verdict` que ya calculó el backend (POST /api/treatment/evaluate) al
    // mismo texto/emoji/clase que mostraba la UI — el backend no sabe nada de CSS/emojis,
    // solo devuelve `{verdict, rosi, message}`. ROSI = (Pérdida Evitada - Costo) / Costo × 100.
    renderInvestmentVerdict(rosiElementId, verdictElementId, verdictData) {
        const rosiEl = document.getElementById(rosiElementId);
        const verdictEl = document.getElementById(verdictElementId);
        const { verdict, rosi, message } = verdictData;

        rosiEl.textContent =
            rosi === null || rosi === undefined
                ? verdict === 'conviene'
                    ? 'Sin costo capturado'
                    : '—'
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
        const formatCurrency = (value) =>
            new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(value);
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
                body: {
                    currentALE: aleActual,
                    annualLosses: state.fair.lastAnnualLosses || undefined,
                    mitigar,
                    transferir,
                    evitar,
                    currency,
                },
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
        document.getElementById('fair-aceptar-residual').textContent =
            `${formatCurrency(result.aceptar.residualALE)} ${aceptarSuffix}`;

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
        const formatCurrency = (value) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value);

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

        document.getElementById('fair-seed-used').textContent =
            `Semilla usada: ${result.usedSeed} (anótala para reproducir exactamente esta corrida)`;

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
        historyBody.innerHTML = state.fair.reviewHistory
            .map(
                (entry) =>
                    `<tr class="border-b"><td class="py-1">${entry.date}</td><td>${entry.ale}</td><td>${entry.evaluationLevel}</td></tr>`,
            )
            .join('');
        document
            .getElementById('fair-review-history-container')
            .classList.toggle('hidden', state.fair.reviewHistory.length < 2);

        // Se guarda en state para que App.UIMode.applyLabels() pueda recalcular este texto
        // si el usuario cambia de Modo Simple/Técnico DESPUÉS de simular — si no, se
        // quedaría con la redacción de cuando corrió la simulación hasta la próxima corrida.
        state.fair.lastThresholdK = `${currencySymbol}${summary.exceedanceThreshold / 1000}k`;
        App.UIMode.applyProbThresholdLabel();
        document.getElementById('prob-threshold-result').textContent = `${summary.probExceedance.toFixed(1)}%`;
        await App.FairRegister.saveToRiskRegister(summary, evaluation);

        document.getElementById('fair-roi-section').classList.remove('hidden');
        this.updateTreatmentView();

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
            document
                .getElementById('fair-deliberate-ponderation-container')
                .classList.toggle('hidden', !data.isDeliberate);
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
            document
                .getElementById('fair-reduccionALE')
                .classList.toggle('bg-gray-100', !data.reduccionALEManualOverride);
            document
                .getElementById('fair-reduccionALE-explanation')
                .classList.toggle('hidden', !!data.reduccionALEManualOverride);
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
                document.getElementById('fair-roi-section').classList.remove('hidden');

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
    },
};

App.FairWizard = FairWizard;
