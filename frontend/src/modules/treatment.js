import { App } from './app-namespace.js';
import { state } from './state.js';
import { debounce, getSafeNumber, sanitizeHTML, showToast } from './utils.js';

// ============================================================
// App.Treatment — Tratamiento del Riesgo (ISO 31000, cláusula 6.5), en su propia página. Antes
// vivía dentro del Paso 4 del wizard de FAIR, atado a que acabaras de correr una simulación —
// se sacó de ahí porque /api/treatment/evaluate solo necesita el ALE actual + los insumos de
// Mitigar/Transferir/Evitar, y esos datos ya viven en cada entrada del Registro (guardados por
// App.FairRegister.saveToRiskRegister). Cualquier riesgo tipo Amenaza ya guardado se puede
// tratar aquí, elegido de un selector, sin volver a simular ni pasar por el wizard. No aplica a
// Oportunidad (un beneficio esperado no es una pérdida a reducir) — esos riesgos ni siquiera
// aparecen en el selector.
// ============================================================
export const Treatment = {
    // Guardados pendientes de disparar (debounce) — selectRisk() los vacía ANTES de cambiar de
    // riesgo (ver _flushPendingSaves), para no perder una edición en curso silenciosamente.
    _pendingSaves: [],

    init() {
        this._pendingSaves = [];
        document
            .getElementById('treatment-risk-select')
            .addEventListener('change', (e) => this.selectRisk(e.target.value));

        const debouncedUpdate = debounce(() => this.updateTreatmentView(true), 400);
        this._pendingSaves.push(debouncedUpdate);
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
            document.getElementById(id).addEventListener('input', debouncedUpdate);
        });
        document.getElementById('fair-seguro-sin-limite').addEventListener('change', (e) => {
            const limiteInput = document.getElementById('fair-seguro-limite');
            limiteInput.disabled = e.target.checked;
            limiteInput.classList.toggle('bg-gray-100', e.target.checked);
            this.updateTreatmentView(true);
        });
        const debouncedJustificacion = debounce(() => this.updateTreatmentView(true), 600);
        this._pendingSaves.push(debouncedJustificacion);
        document.getElementById('fair-aceptar-justificacion').addEventListener('input', debouncedJustificacion);
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
            this.updateTreatmentView(true);
        });
    },

    _flushPendingSaves() {
        this._pendingSaves.forEach((debounced) => debounced.flush());
    },

    // riskNameToSelect: para llegar aquí con un riesgo específico ya elegido (ver el botón
    // "Tratar" del Registro, App.RiskCascadeTree, y "Tratar este riesgo" en el wizard) — si no
    // está entre los riesgos disponibles (ej. ya no existe), cae al primero de la lista.
    async load(riskNameToSelect = null) {
        await App.FairRegister.loadRiskRegister(false);
        this.populateRiskSelect(riskNameToSelect);
    },

    // Oportunidad se excluye por completo (no solo se oculta) — su "ale" es un beneficio
    // esperado, no una pérdida; "evitar" o "mitigar" una oportunidad no tiene sentido (mismo
    // criterio que ya usan el mapa de calor y el Pareto consolidados).
    populateRiskSelect(riskNameToSelect = null) {
        const select = document.getElementById('treatment-risk-select');
        const empty = document.getElementById('treatment-empty');
        const content = document.getElementById('treatment-content');
        const eligible = (state.fair.riskRegister || []).filter((r) => r.riskType !== 'oportunidad');

        if (eligible.length === 0) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            select.innerHTML = '';
            state.treatment.currentEntry = null;
            return;
        }
        empty.classList.add('hidden');
        content.classList.remove('hidden');

        const currentValue = riskNameToSelect || select.value;
        select.innerHTML = eligible
            .map((r) => `<option value="${sanitizeHTML(r.riskName)}">${sanitizeHTML(r.riskName)}</option>`)
            .join('');
        const toSelect = eligible.some((r) => r.riskName === currentValue) ? currentValue : eligible[0].riskName;
        select.value = toSelect;
        this.selectRisk(toSelect);
    },

    // Carga los insumos YA guardados de este riesgo (si los tiene) en el formulario — a
    // diferencia del wizard viejo, que siempre arrancaba en 0 porque era la primera vez que se
    // trataba ese riesgo en esa sesión. Aquí puede ser la primera vez o la enésima.
    selectRisk(riskName) {
        const entry = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!entry) return;
        // Dispara YA cualquier guardado pendiente del riesgo ANTERIOR (ver _pendingSaves) —
        // antes de este flush, cambiar de riesgo mientras el debounce seguía en vuelo perdía la
        // edición en curso en silencio.
        this._flushPendingSaves();
        state.treatment.currentEntry = entry;
        document.getElementById('treatment-risk-select').value = riskName;

        const mitigar = entry.mitigar || {};
        document.getElementById('fair-costoControlAnual').value = mitigar.cost || 0;
        document.getElementById('fair-reduccionALE').value = mitigar.reductionPercent || 0;
        document.getElementById('fair-mitigar-fiabilidad').value = mitigar.reliability || 'media';
        document.getElementById('fair-mitigar-retraso').value = mitigar.delayDays || 0;
        document.getElementById('fair-mitigar-defensa-objetivo').value = 'basica';

        // Sin defenseKey (riesgos guardados antes de que se empezara a persistir, ver
        // backend/src/routes/register.js) no hay con qué recalcular la Reducción de ALE
        // automáticamente — se deja en modo manual con una explicación, en vez de un campo de
        // solo lectura que nunca se actualiza.
        const hasDefenseKey = !!entry.defenseKey;
        document.getElementById('fair-reduccionALE-manual-override').checked = !hasDefenseKey;
        document.getElementById('fair-reduccionALE').readOnly = hasDefenseKey;
        document.getElementById('fair-reduccionALE').classList.toggle('bg-gray-100', hasDefenseKey);
        document.getElementById('fair-reduccionALE-explanation').classList.toggle('hidden', !hasDefenseKey);
        if (!hasDefenseKey) {
            document.getElementById('fair-reduccionALE-explanation').textContent =
                'Este riesgo se guardó antes de que se registrara el nivel de defensa — escribe la reducción manualmente, o vuelve a correr su simulación desde Análisis FAIR para habilitar el cálculo automático.';
        }

        const transferir = entry.transferir || {};
        document.getElementById('fair-seguro-prima').value = transferir.premium || 0;
        document.getElementById('fair-seguro-deducible').value = transferir.deductible || 0;
        document.getElementById('fair-seguro-limite').value = transferir.limit || 0;
        const sinLimite = !!transferir.unlimited;
        document.getElementById('fair-seguro-sin-limite').checked = sinLimite;
        document.getElementById('fair-seguro-limite').disabled = sinLimite;
        document.getElementById('fair-seguro-limite').classList.toggle('bg-gray-100', sinLimite);
        document.getElementById('fair-seguro-fiabilidad').value = transferir.reliability || 'media';
        document.getElementById('fair-seguro-retraso').value = transferir.delayDays || 0;

        const evitar = entry.evitar || {};
        document.getElementById('fair-evitar-costo').value = evitar.cost || 0;
        document.getElementById('fair-evitar-fiabilidad').value = evitar.reliability || 'alta';
        document.getElementById('fair-evitar-retraso').value = evitar.delayDays || 0;

        document.getElementById('fair-aceptar-justificacion').value = entry.aceptarJustificacion || '';

        if (hasDefenseKey) this.updateReduccionALEAuto();
        // false: solo refresca la vista previa con lo ya guardado — nada cambió todavía, no
        // hace falta un PUT de vuelta con los mismos datos que ya trae la entrada.
        this.updateTreatmentView(false);
    },

    // Mismo cálculo que antes vivía en App.FairWizard (Paso 2) — la diferencia es de dónde sale
    // el nivel de defensa ACTUAL: antes, del <select> del wizard recién elegido; aquí, del
    // defenseKey ya guardado en la entrada del Registro.
    async updateReduccionALEAuto() {
        const entry = state.treatment.currentEntry;
        if (!entry || !entry.defenseKey) return;
        if (document.getElementById('fair-reduccionALE-manual-override').checked) return;

        const objetivoKey = document.getElementById('fair-mitigar-defensa-objetivo').value;
        const explanationEl = document.getElementById('fair-reduccionALE-explanation');
        explanationEl.textContent = 'Calculando…';

        let data;
        try {
            data = await App.Api.request('/api/autocalc/reduccion-ale', {
                method: 'POST',
                body: { currentDefenseKey: entry.defenseKey, targetDefenseKey: objetivoKey },
            });
        } catch (err) {
            explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
            return;
        }

        document.getElementById('fair-reduccionALE').value = data.reductionPercent;
        explanationEl.textContent = `Calculado como: pasar de tu defensa actual (${data.currentScore.toFixed(0)}%) a "${state.quick.defenseProfiles[objetivoKey].name}" (${data.targetScore.toFixed(0)}%) = ${data.reductionPercent}% de reducción estimada.`;
        this.updateTreatmentView(true);
    },

    // Traduce el `verdict` que ya calculó el backend (POST /api/treatment/evaluate) al mismo
    // texto/emoji/clase que mostraba la UI del wizard — el backend no sabe nada de CSS/emojis,
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

    // `save`: false cuando se acaba de elegir un riesgo (nada cambió todavía, solo se muestra
    // lo ya guardado); true cuando el usuario editó algo — al final persiste el cambio (ver
    // persistTreatment). Sin los 10,000 resultados crudos de la simulación (el Registro no los
    // guarda), "Transferir" se evalúa de forma conservadora — mismo criterio que ya usa
    // App.FairExport.buildFullRiskReportSection al reconstruir el PDF de un riesgo.
    async updateTreatmentView(save) {
        const entry = state.treatment.currentEntry;
        if (!entry) return;
        const currency = 'USD';
        const formatCurrency = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
        const aleActual = entry.ale;
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
                body: { currentALE: aleActual, mitigar, transferir, evitar, currency },
            });
        } catch (err) {
            showToast(err.userMessage || 'No se pudo calcular el tratamiento del riesgo.');
            return;
        }

        const fiabilidadLabel = { alta: 'Alta', media: 'Media', baja: 'Baja' };

        document.getElementById('fair-roi-costo').textContent = formatCurrency(result.mitigar.cost);
        document.getElementById('fair-roi-ale-despues').textContent = formatCurrency(result.mitigar.residualALE);
        document.getElementById('fair-roi-ale-evitada').textContent = formatCurrency(result.mitigar.avoidedLoss);
        const mitigarEl = document.getElementById('fair-roi-resultado');
        mitigarEl.textContent = formatCurrency(result.mitigar.netBenefit);
        mitigarEl.className = `font-bold ${result.mitigar.netBenefit > 0 ? 'text-green-700' : result.mitigar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
        this.renderInvestmentVerdict('fair-roi-rosi', 'fair-mitigar-verdict', result.mitigar.verdict);

        document.getElementById('fair-seguro-costo').textContent = formatCurrency(result.transferir.cost);
        document.getElementById('fair-seguro-residual').textContent = formatCurrency(result.transferir.residualALE);
        document.getElementById('fair-seguro-evitada').textContent = formatCurrency(result.transferir.avoidedLoss);
        const seguroEl = document.getElementById('fair-seguro-beneficio');
        seguroEl.textContent = formatCurrency(result.transferir.netBenefit);
        seguroEl.className = `font-bold ${result.transferir.netBenefit > 0 ? 'text-green-700' : result.transferir.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
        this.renderInvestmentVerdict('fair-seguro-rosi', 'fair-seguro-verdict', result.transferir.verdict);

        document.getElementById('fair-evitar-costo-display').textContent = formatCurrency(result.evitar.cost);
        document.getElementById('fair-evitar-evitada').textContent = formatCurrency(result.evitar.avoidedLoss);
        const evitarEl = document.getElementById('fair-evitar-beneficio');
        evitarEl.textContent = formatCurrency(result.evitar.netBenefit);
        evitarEl.className = `font-bold ${result.evitar.netBenefit > 0 ? 'text-green-700' : result.evitar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
        this.renderInvestmentVerdict('fair-evitar-rosi', 'fair-evitar-verdict', result.evitar.verdict);

        document.getElementById('fair-aceptar-residual').textContent =
            `${formatCurrency(result.aceptar.residualALE)} (= ALE actual)`;

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

        if (save) await this.persistTreatment(entry, mitigar, transferir, evitar);
    },

    // Guarda mitigar/transferir/evitar/aceptarJustificacion de vuelta en esta entrada del
    // Registro — PUT reemplaza la entrada completa (no es un PATCH parcial, ver
    // backend/src/routes/register.js), así que se manda la entrada entera tal cual ya estaba
    // (spread) y solo se pisan estos 4 campos, para no perder el resto de sus datos.
    //
    // `entry` se recibe como parámetro (el mismo que updateTreatmentView ya leyó de
    // state.treatment.currentEntry ANTES de su propio await a /api/treatment/evaluate) — NO se
    // vuelve a leer state.treatment.currentEntry aquí. Bug real: entre ese await y este PUT hay
    // una ventana asíncrona; si el usuario cambia de riesgo en el selector mientras tanto (ver
    // selectRisk → _flushPendingSaves), currentEntry ya apunta al riesgo NUEVO para cuando este
    // código corría — el guardado terminaba escribiendo los datos editados del riesgo ANTERIOR
    // en la entrada del riesgo nuevo, corrompiéndola, en vez de guardarlos en la entrada correcta.
    async persistTreatment(entry, mitigar, transferir, evitar) {
        if (!entry) return;
        const aceptarJustificacion = document.getElementById('fair-aceptar-justificacion').value.trim() || null;

        let res;
        try {
            res = await App.Api.request(`/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                body: { ...entry, mitigar, transferir, evitar, aceptarJustificacion },
            });
        } catch (e) {
            showToast(e.userMessage || 'No se pudo guardar el tratamiento de este riesgo.');
            return;
        }
        // Solo pisa currentEntry/el formulario visible si TODAVÍA es este mismo riesgo el que
        // está siendo mostrado — si el usuario ya cambió a otro riesgo mientras este guardado
        // estaba en vuelo, currentEntry ya no debe volver a apuntar al riesgo anterior.
        if (state.treatment.currentEntry && state.treatment.currentEntry.id === entry.id) {
            state.treatment.currentEntry = res.entry;
        }
        const idx = (state.fair.riskRegister || []).findIndex((r) => r.id === entry.id);
        if (idx !== -1) state.fair.riskRegister[idx] = res.entry;
    },
};

App.Treatment = Treatment;
