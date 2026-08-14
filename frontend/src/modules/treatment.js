import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { debounce, formatCurrency, getSafeNumber, sanitizeHTML, shortMetricLabel, showToast } from './utils.js';

// Orden de fiabilidad de más débil a más fuerte — mismo orden que
// RELIABILITY_TO_PROBABILITY en backend/src/lib/treatment.js (baja: 0.4 < media: 0.7 <
// alta: 0.9). Se usa para combinar varios controles nombrados en una sola fiabilidad
// agregada (la más débil presente), sin inventar una fórmula numérica nueva.
const RELIABILITY_ORDER = ['baja', 'media', 'alta'];

// Texto de Fiabilidad + advertencia para la combinación Mitigar+Transferir — no tiene una única
// Fiabilidad (trae mitigarReliability/transferirReliability, ver evaluateMitigarConTransferir en
// el backend), a diferencia de las otras 4 estrategias (una sola stratData.reliability). Aparte
// de las demás porque lo usan tanto la recomendación (updateTreatmentView) como la sección propia
// de resultados de esta combinación.
function mitigarTransferirFiabilidadTexto(stratData, fiabilidadLabel) {
    const fiabilidadTexto = `Mitigar ${fiabilidadLabel[stratData.mitigarReliability] || stratData.mitigarReliability} / Transferir ${fiabilidadLabel[stratData.transferirReliability] || stratData.transferirReliability}`;
    let advertencia = '';
    if (stratData.mitigarReliability === 'baja' || stratData.transferirReliability === 'baja') {
        advertencia = ` <strong class="text-orange-700">Atención:</strong> una parte de esta combinación tiene Fiabilidad Baja — el beneficio neto ya está ajustado por ese riesgo, pero el rango de resultados posibles es amplio (desde el beneficio completo hasta perder lo invertido, si esa parte no funciona).`;
    } else if (stratData.delayDays > 90) {
        advertencia = ` <strong class="text-orange-700">Atención:</strong> el tiempo de implementación es de ${stratData.delayDays} días — el riesgo actual sigue expuesto mientras tanto.`;
    }
    return { fiabilidadTexto, advertencia };
}

// Nombres para mostrar de cada estrategia — compartido entre la recomendación
// (updateTreatmentView), el resumen de la Decisión de Tratamiento adoptada
// (renderTreatmentDecision) y App.RiskManagement.renderResidualStatus (Gestión de Riesgos, que
// también necesita mostrar qué estrategia generó el Residual Canónico vigente). Exportado en vez
// de duplicado, para no arriesgar que los dos mapas se desincronicen.
export const STRATEGY_LABELS = {
    mitigar: 'Mitigar',
    transferir: 'Transferir (Seguro)',
    evitar: 'Evitar',
    aceptar: 'Aceptar / Retener',
    mitigarTransferir: 'Mitigar + Transferir (combinado)',
};

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
    // Guardián contra condición de carrera de red (mismo patrón que App.FairWizard, ver el
    // comentario junto a _attackerDefenseRequestId ahí): si el usuario cambia el "Nivel de
    // Defensa Objetivo" dos veces rápido, no hay garantía de que las respuestas HTTP lleguen en
    // el mismo orden en que se pidieron. Sin esto, una respuesta vieja podía llegar después y
    // pisar en silencio el % de Reducción de ALE correcto — y como updateReduccionALEAuto
    // termina llamando a updateTreatmentView(true) (que persiste en el Registro), el dato
    // incorrecto no se quedaba solo en pantalla: se guardaba.
    _reduccionALERequestId: 0,

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
        document
            .getElementById('treatment-manage-controls-btn')
            .addEventListener('click', () => this.openControlsModal());
        document.getElementById('fair-reduccionALE-manual-override').addEventListener('change', (e) => {
            const manual = e.target.checked;
            document.getElementById('fair-reduccionALE').readOnly = !manual;
            document.getElementById('fair-reduccionALE').classList.toggle('bg-gray-100', !manual);
            document.getElementById('fair-reduccionALE-explanation').classList.toggle('hidden', manual);
            if (manual) {
                // Sin perfil de defensa objetivo que simular en modo manual — un residual real
                // guardado de la ÚLTIMA corrida automática no debe seguir aplicándose contra el
                // % que el usuario escriba ahora a mano.
                state.treatment.mitigarResidualALE = null;
                state.treatment.mitigarResidualCVaR = null;
                showToast('Ahora puedes escribir la Reducción de ALE manualmente.');
            } else {
                this.updateReduccionALEAuto();
                showToast('Reducción de ALE calculada automáticamente de nuevo.');
            }
            this.updateTreatmentView(true);
        });

        ['mitigar', 'transferir', 'evitar', 'aceptar', 'mitigarTransferir'].forEach((key) => {
            document
                .getElementById(`treatment-adopt-${key}-btn`)
                .addEventListener('click', () => this.adoptStrategy(key));
        });
        document.getElementById('treatment-decision-clear-btn').addEventListener('click', () => this.clearDecision());
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
        state.treatment.lastResult = null;
        // Residual de un riesgo distinto no aplica acá — se recalcula abajo (updateReduccionALEAuto)
        // si corresponde, o se queda en null si este riesgo no tiene defenseKey/attackerKey.
        state.treatment.mitigarResidualALE = null;
        state.treatment.mitigarResidualCVaR = null;
        document.getElementById('treatment-risk-select').value = riskName;
        // Independiente de updateTreatmentView (más abajo) — el badge/banner de la decisión ya
        // adoptada debe verse de inmediato, sin esperar a la llamada async de evaluate.
        this.renderTreatmentDecision();

        const mitigar = entry.mitigar || {};
        document.getElementById('fair-costoControlAnual').value = mitigar.cost || 0;
        document.getElementById('fair-reduccionALE').value = mitigar.reductionPercent || 0;
        document.getElementById('fair-mitigar-fiabilidad').value = mitigar.reliability || 'media';
        document.getElementById('fair-mitigar-retraso').value = mitigar.delayDays || 0;
        document.getElementById('fair-mitigar-defensa-objetivo').value = 'basica';

        // Controles nombrados de Mitigar (ver openControlsModal/applyControlsAggregation más
        // abajo) — [] si este riesgo nunca usó controles nombrados, y los 3 campos de arriba
        // siguen editables a mano como siempre.
        state.treatment.controls = Array.isArray(mitigar.controls) ? mitigar.controls : [];
        this.applyControlsAggregation();

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

    // Deriva Costo/Fiabilidad/Retraso de Mitigar a partir de state.treatment.controls, cuando
    // hay al menos un control nombrado — costo = suma, fiabilidad = la más débil presente
    // (mismo orden que RELIABILITY_TO_PROBABILITY en el backend), retraso = el más largo (la
    // mitigación completa no está lista hasta que el control más lento lo esté). Los 3 campos
    // se vuelven de solo lectura mientras haya controles, para que no queden desincronizados de
    // lo que en verdad describen — sin controles, vuelven a ser editables a mano como siempre.
    applyControlsAggregation() {
        const controls = state.treatment.controls || [];
        const costInput = document.getElementById('fair-costoControlAnual');
        const reliabilitySelect = document.getElementById('fair-mitigar-fiabilidad');
        const delayInput = document.getElementById('fair-mitigar-retraso');
        const noteEl = document.getElementById('treatment-controls-note');

        if (controls.length === 0) {
            costInput.readOnly = false;
            costInput.classList.remove('bg-gray-100');
            reliabilitySelect.disabled = false;
            delayInput.readOnly = false;
            delayInput.classList.remove('bg-gray-100');
            noteEl.classList.add('hidden');
            return;
        }

        const totalCost = controls.reduce((sum, c) => sum + (Number(c.cost) || 0), 0);
        const weakestReliability = controls.reduce((weakest, c) => {
            const idx = RELIABILITY_ORDER.indexOf(c.reliability);
            return idx !== -1 && idx < RELIABILITY_ORDER.indexOf(weakest) ? c.reliability : weakest;
        }, 'alta');
        const maxDelay = controls.reduce((max, c) => Math.max(max, Number(c.delayDays) || 0), 0);

        costInput.value = totalCost;
        costInput.readOnly = true;
        costInput.classList.add('bg-gray-100');
        reliabilitySelect.value = weakestReliability;
        reliabilitySelect.disabled = true;
        delayInput.value = maxDelay;
        delayInput.readOnly = true;
        delayInput.classList.add('bg-gray-100');

        const n = controls.length;
        noteEl.textContent = `Calculado a partir de ${n} control${n === 1 ? '' : 'es'} nombrado${n === 1 ? '' : 's'}: costo = suma, fiabilidad = la más débil, tiempo de implementación = el más largo.`;
        noteEl.classList.remove('hidden');
    },

    // Modal con la lista editable de controles nombrados de Mitigar — mismo patrón que
    // App.RiskCatalog.openPicker/App.RiskCascadeTree.openCreateChildModal: usa el Modal
    // compartido, arma su propio body/footer, y solo escribe de vuelta en
    // state.treatment.controls al confirmar "Guardar" (Cancelar descarta cualquier cambio sin
    // tocar nada).
    openControlsModal() {
        const working = (state.treatment.controls || []).map((c) => ({ ...c }));

        const renderRow = (control, i) => `
            <tr data-control-row data-index="${i}">
                <td class="px-2 py-1"><input type="text" class="form-input" data-field="name" value="${sanitizeHTML(control.name || '')}" placeholder="Ej. Cámaras CCTV"></td>
                <td class="px-2 py-1"><input type="number" class="form-input" data-field="cost" value="${control.cost || 0}" min="0"></td>
                <td class="px-2 py-1">
                    <select class="form-select" data-field="reliability">
                        <option value="alta" ${control.reliability === 'alta' ? 'selected' : ''}>Alta</option>
                        <option value="media" ${!control.reliability || control.reliability === 'media' ? 'selected' : ''}>Media</option>
                        <option value="baja" ${control.reliability === 'baja' ? 'selected' : ''}>Baja</option>
                    </select>
                </td>
                <td class="px-2 py-1"><input type="number" class="form-input" data-field="delayDays" value="${control.delayDays || 0}" min="0"></td>
                <td class="py-1"><button type="button" class="btn btn-danger text-xs" data-remove-control title="Quitar este control">✕</button></td>
            </tr>`;

        const render = () => {
            Modal.setSize('wide');
            Modal.title.textContent = 'Gestionar Controles';
            Modal.body.innerHTML = `
                <p class="description-text mb-3">
                    Desglosa "Mitigar" en los controles concretos que lo componen (cámaras, rondines,
                    cerrajería, alarmas...). Costo/Fiabilidad/Tiempo de Implementación de Mitigar se
                    calculan solos a partir de esta lista — no hace falta escribirlos aparte.
                </p>
                <p id="treatment-controls-modal-error" class="text-red-600 text-sm mb-3 hidden"></p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-left border-b">
                                <th class="px-2 py-1">Nombre</th>
                                <th class="px-2 py-1">Costo Anual</th>
                                <th class="px-2 py-1">Fiabilidad</th>
                                <th class="px-2 py-1">Retraso (días)</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="treatment-controls-modal-body">${working.map(renderRow).join('')}</tbody>
                    </table>
                </div>
                <button type="button" id="treatment-controls-add-btn" class="btn btn-secondary text-sm mt-3">+ Agregar Control</button>
            `;
            Modal.footer.innerHTML = `
                <button id="treatment-controls-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="treatment-controls-save-btn" class="btn btn-primary">Guardar</button>
            `;
            Modal.modal.classList.remove('hidden');

            document.getElementById('treatment-controls-add-btn').addEventListener('click', () => {
                // Sin esto, re-renderizar para mostrar la fila nueva pintaba TODAS las filas
                // (incluidas las que ya existían) desde `working` sin haber leído antes lo que
                // el usuario ya había escrito en pantalla — perdía en silencio cualquier edición
                // de una fila anterior en cuanto se agregaba una fila nueva.
                syncWorkingFromDom();
                working.push({ name: '', cost: 0, reliability: 'media', delayDays: 0 });
                render();
            });
            document.querySelectorAll('[data-remove-control]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    // Lee los valores en pantalla ANTES de quitar la fila, para no perder lo que
                    // el usuario ya haya escrito en las OTRAS filas al re-renderizar.
                    syncWorkingFromDom();
                    const i = Number(btn.closest('[data-control-row]').dataset.index);
                    working.splice(i, 1);
                    render();
                });
            });
            document.getElementById('treatment-controls-cancel-btn').addEventListener('click', () => Modal.hide());
            document.getElementById('treatment-controls-save-btn').addEventListener('click', () => {
                syncWorkingFromDom();
                const errorEl = document.getElementById('treatment-controls-modal-error');
                if (working.some((c) => !c.name.trim())) {
                    errorEl.textContent = 'Cada control necesita un nombre.';
                    errorEl.classList.remove('hidden');
                    return;
                }
                state.treatment.controls = working.map((c) => ({ ...c, name: c.name.trim() }));
                Modal.hide();
                this.applyControlsAggregation();
                this.updateTreatmentView(true);
            });
        };

        // Relee los inputs de cada fila hacia `working` — se usa antes de cualquier acción que
        // vuelva a renderizar (agregar/quitar fila) o que guarde, para no perder ediciones en
        // curso en las filas que no cambiaron.
        const syncWorkingFromDom = () => {
            document.querySelectorAll('[data-control-row]').forEach((row) => {
                const i = Number(row.dataset.index);
                working[i] = {
                    name: row.querySelector('[data-field="name"]').value,
                    cost: getSafeNumber(row.querySelector('[data-field="cost"]')),
                    reliability: row.querySelector('[data-field="reliability"]').value,
                    delayDays: getSafeNumber(row.querySelector('[data-field="delayDays"]')),
                };
            });
        };

        render();
    },

    // Mismo cálculo que antes vivía en App.FairWizard (Paso 2) — la diferencia es de dónde sale
    // el nivel de defensa ACTUAL: antes, del <select> del wizard recién elegido; aquí, del
    // defenseKey ya guardado en la entrada del Registro.
    async updateReduccionALEAuto() {
        const entry = state.treatment.currentEntry;
        if (!entry || !entry.defenseKey || !entry.attackerKey) return;
        if (document.getElementById('fair-reduccionALE-manual-override').checked) return;

        const objetivoKey = document.getElementById('fair-mitigar-defensa-objetivo').value;
        const explanationEl = document.getElementById('fair-reduccionALE-explanation');
        explanationEl.textContent = 'Calculando…';

        const requestId = ++this._reduccionALERequestId;
        let data;
        try {
            data = await App.Api.request('/api/autocalc/reduccion-ale', {
                method: 'POST',
                // attackerKey era un bug real: la ruta lo exige desde el modelo TCap/RS (400 sin
                // él) pero nunca se mandaba aquí — el autocálculo llevaba roto en silencio desde
                // esa tarea, mostrando solo "No se pudo calcular automáticamente". currentALE/
                // tef/lossMagnitudes/confidence son nuevos: le dan a la ruta lo que necesita para
                // simular el residual REAL en vez de solo comparar Vulnerabilidad por moda (ver
                // calculateResidualFromSimulation, backend/src/lib/autocalc.js).
                body: {
                    attackerKey: entry.attackerKey,
                    currentDefenseKey: entry.defenseKey,
                    targetDefenseKey: objetivoKey,
                    confidence: entry.dataConfidence || 'medio',
                    currentALE: entry.ale,
                    tef: entry.tef,
                    lossMagnitudes: entry.lossMagnitudes,
                },
            });
        } catch (err) {
            if (requestId !== this._reduccionALERequestId) return; // ver el guardián documentado arriba, junto a Treatment
            state.treatment.mitigarResidualALE = null;
            state.treatment.mitigarResidualCVaR = null;
            explanationEl.textContent = 'No se pudo calcular automáticamente. Verifica tu conexión.';
            return;
        }
        // Respuesta vieja, ya superada por otra más nueva, o "Ajustar manualmente" se activó
        // mientras esta petición estaba en vuelo — en cualquiera de los dos casos, escribirla
        // (y de paso persistirla, ver updateTreatmentView(true) más abajo) sería el mismo bug
        // real ya documentado y arreglado para Vulnerabilidad/Magnitud de Pérdida en el wizard.
        if (requestId !== this._reduccionALERequestId) return;
        if (document.getElementById('fair-reduccionALE-manual-override').checked) return;

        document.getElementById('fair-reduccionALE').value = data.reductionPercent;
        // residualALE/residualCVaR son el resultado REAL de re-simular con el Nivel de Defensa
        // Objetivo (no una escala proporcional) — se guardan para que updateTreatmentView los
        // mande tal cual a /api/treatment/evaluate, en vez de dejar que ese endpoint los derive
        // de reductionPercent × currentALE/currentCVaR (aproximación que ya no es exacta con el
        // modelo TCap/RS + Tullock, ver el plan de esta tarea).
        state.treatment.mitigarResidualALE = data.residualALE;
        state.treatment.mitigarResidualCVaR = data.residualCVaR;
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
        const aleActual = entry.ale;
        document.getElementById('fair-treat-ale-base').textContent = formatCurrency(aleActual);

        const mitigar = {
            cost: getSafeNumber(document.getElementById('fair-costoControlAnual')),
            reductionPercent: getSafeNumber(document.getElementById('fair-reduccionALE')),
            // Residual REAL (re-simulado con el Nivel de Defensa Objetivo, ver
            // updateReduccionALEAuto) — cuando existen, /api/treatment/evaluate los usa tal cual
            // en vez de derivarlos de reductionPercent × currentALE/currentCVaR. null en modo
            // manual o antes del primer autocálculo (ver evaluateTreatmentStrategies).
            residualALE: state.treatment.mitigarResidualALE,
            residualCVaR: state.treatment.mitigarResidualCVaR,
            reliability: document.getElementById('fair-mitigar-fiabilidad').value,
            delayDays: getSafeNumber(document.getElementById('fair-mitigar-retraso')),
            // Controles nombrados (ver openControlsModal/applyControlsAggregation) — [] si este
            // riesgo no los usa; cost/reliability/delayDays de arriba ya vienen derivados de
            // esta misma lista cuando no está vacía, así que /api/treatment/evaluate no necesita
            // saber nada de esto: solo viaja para persistirse y poder reabrir el modal después.
            controls: state.treatment.controls || [],
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
                body: { currentALE: aleActual, currentCVaR: entry.cvar95, mitigar, transferir, evitar },
            });
        } catch (err) {
            showToast(err.userMessage || 'No se pudo calcular el tratamiento del riesgo.');
            return;
        }
        // Cachea el resultado completo — adoptStrategy() lo necesita para leer el residualALE
        // ya calculado de la estrategia elegida, sin tener que volver a pedirlo.
        state.treatment.lastResult = result;

        const fiabilidadLabel = { alta: 'Alta', media: 'Media', baja: 'Baja' };

        document.getElementById('fair-roi-costo').textContent = formatCurrency(result.mitigar.cost);
        document.getElementById('fair-roi-ale-despues').textContent = formatCurrency(result.mitigar.residualALE);
        // residualCVaR es null si este riesgo no tiene un CVaR95 conocido (ver currentCVaR en
        // evaluateTreatmentStrategies, backend/src/lib/treatment.js) — "—" en vez de "$NaN".
        document.getElementById('fair-roi-cvar-despues').textContent =
            result.mitigar.residualCVaR === null ? '—' : formatCurrency(result.mitigar.residualCVaR);
        document.getElementById('fair-roi-ale-evitada').textContent = formatCurrency(result.mitigar.avoidedLoss);
        const mitigarEl = document.getElementById('fair-roi-resultado');
        mitigarEl.textContent = formatCurrency(result.mitigar.netBenefit);
        mitigarEl.className = `font-bold ${result.mitigar.netBenefit > 0 ? 'text-green-700' : result.mitigar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
        this.renderInvestmentVerdict('fair-roi-rosi', 'fair-mitigar-verdict', result.mitigar.verdict);

        document.getElementById('fair-seguro-costo').textContent = formatCurrency(result.transferir.cost);
        // residualALE/avoidedLoss/netBenefit son null cuando hay deducible/límite capturado pero
        // no se puede calcular sin los 10,000 escenarios de la simulación (ver el comentario
        // "Bug real corregido" junto a transferirCalculable en evaluateTreatmentStrategies,
        // backend) — "No calculable" en vez de un "$0.00" que parecería una respuesta real.
        const transferirCalculable = result.transferir.residualALE !== null;
        document.getElementById('fair-seguro-residual').textContent = transferirCalculable
            ? formatCurrency(result.transferir.residualALE)
            : 'No calculable';
        document.getElementById('fair-seguro-evitada').textContent = transferirCalculable
            ? formatCurrency(result.transferir.avoidedLoss)
            : 'No calculable';
        const seguroEl = document.getElementById('fair-seguro-beneficio');
        seguroEl.textContent = transferirCalculable ? formatCurrency(result.transferir.netBenefit) : 'No calculable';
        seguroEl.className = `font-bold ${
            !transferirCalculable
                ? 'text-gray-800'
                : result.transferir.netBenefit > 0
                  ? 'text-green-700'
                  : result.transferir.netBenefit < 0
                    ? 'text-red-700'
                    : 'text-gray-800'
        }`;
        this.renderInvestmentVerdict('fair-seguro-rosi', 'fair-seguro-verdict', result.transferir.verdict);

        document.getElementById('fair-evitar-costo-display').textContent = formatCurrency(result.evitar.cost);
        document.getElementById('fair-evitar-evitada').textContent = formatCurrency(result.evitar.avoidedLoss);
        const evitarEl = document.getElementById('fair-evitar-beneficio');
        evitarEl.textContent = formatCurrency(result.evitar.netBenefit);
        evitarEl.className = `font-bold ${result.evitar.netBenefit > 0 ? 'text-green-700' : result.evitar.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
        this.renderInvestmentVerdict('fair-evitar-rosi', 'fair-evitar-verdict', result.evitar.verdict);

        document.getElementById('fair-aceptar-residual').textContent =
            `${formatCurrency(result.aceptar.residualALE)} (= ${shortMetricLabel('ale', 'ALE')} actual)`;
        document.getElementById('fair-aceptar-residual-cvar').textContent =
            result.aceptar.residualCVaR === null
                ? '—'
                : `${formatCurrency(result.aceptar.residualCVaR)} (= ${shortMetricLabel('cvar95', 'CVaR')} actual)`;

        // La sección de la combinación solo aparece cuando ya hay costo real capturado en AMBAS
        // partes (ver el mismo criterio en evaluateTreatmentStrategies, backend) — hasta entonces
        // no hay nada que mostrar ni adoptar.
        const mtSection = document.getElementById('fair-mitigar-transferir-section');
        if (result.mitigarTransferir) {
            mtSection.classList.remove('hidden');
            const mt = result.mitigarTransferir;
            document.getElementById('fair-mitigar-transferir-costo').textContent = formatCurrency(mt.cost);
            document.getElementById('fair-mitigar-transferir-residual').textContent = formatCurrency(mt.residualALE);
            const mtEl = document.getElementById('fair-mitigar-transferir-beneficio');
            mtEl.textContent = formatCurrency(mt.netBenefit);
            mtEl.className = `font-bold ${mt.netBenefit > 0 ? 'text-green-700' : mt.netBenefit < 0 ? 'text-red-700' : 'text-gray-800'}`;
            document.getElementById('fair-mitigar-transferir-retraso').textContent = `${mt.delayDays} días`;
            const { fiabilidadTexto: mtFiabilidad, advertencia: mtAdvertencia } = mitigarTransferirFiabilidadTexto(
                mt,
                fiabilidadLabel,
            );
            document.getElementById('fair-mitigar-transferir-fiabilidad').innerHTML =
                `Fiabilidad: ${mtFiabilidad}.${mtAdvertencia}`;
            this.renderInvestmentVerdict('fair-mitigar-transferir-rosi', 'fair-mitigar-transferir-verdict', mt.verdict);
        } else {
            mtSection.classList.add('hidden');
        }

        const recEl = document.getElementById('fair-treatment-recommendation');
        const rec = result.recommendation;
        if (rec.strategy === 'aceptar') {
            recEl.innerHTML = `<p>${sanitizeHTML(rec.reason)}</p>`;
        } else {
            const stratData = result[rec.strategy];
            let fiabilidadTexto;
            let advertencia = '';
            if (rec.strategy === 'mitigarTransferir') {
                ({ fiabilidadTexto, advertencia } = mitigarTransferirFiabilidadTexto(stratData, fiabilidadLabel));
            } else {
                fiabilidadTexto = fiabilidadLabel[stratData.reliability] || stratData.reliability;
                if (stratData.reliability === 'baja') {
                    // El beneficio neto YA descuenta la Fiabilidad Baja (ver App.Treatment /
                    // expectedNetBenefit en el backend: es un valor esperado, no el resultado "si
                    // todo sale bien") — esta nota no advierte que el número podría estar mal, sino
                    // que ese descuento viene de un riesgo real de que el control no funcione.
                    advertencia = ` <strong class="text-orange-700">Atención:</strong> esta opción tiene Fiabilidad Baja — el beneficio neto de arriba ya está ajustado por ese riesgo, pero el rango de resultados posibles es amplio (desde el beneficio completo hasta perder lo invertido, si el control no funciona).`;
                } else if (stratData.delayDays > 90) {
                    advertencia = ` <strong class="text-orange-700">Atención:</strong> el tiempo de implementación es de ${stratData.delayDays} días — el riesgo actual sigue expuesto mientras tanto.`;
                }
            }
            recEl.innerHTML = `<p><strong>Estrategia con mayor beneficio neto: ${STRATEGY_LABELS[rec.strategy]}</strong> (${formatCurrency(rec.netBenefit)}/año). Fiabilidad: ${fiabilidadTexto}, Tiempo de implementación: ${stratData.delayDays} días.${advertencia} Compara igual el resto de las filas antes de decidir.</p>`;
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

    // Muestra/oculta el botón "Adoptar esta estrategia" vs. el badge "Estrategia Adoptada" en
    // cada una de las 4 secciones, y el banner resumen — según entry.treatmentDecision. A
    // diferencia de mitigar/transferir/evitar (los INSUMOS de las 4 hipótesis comparadas en
    // paralelo), esto es la decisión real ya tomada, si la hay.
    renderTreatmentDecision() {
        const entry = state.treatment.currentEntry;
        const decision = (entry && entry.treatmentDecision) || null;

        ['mitigar', 'transferir', 'evitar', 'aceptar', 'mitigarTransferir'].forEach((key) => {
            const adopted = !!decision && decision.strategy === key;
            document.getElementById(`treatment-adopt-${key}-btn`).classList.toggle('hidden', adopted);
            document.getElementById(`treatment-adopted-${key}-badge`).classList.toggle('hidden', !adopted);
        });

        const summaryEl = document.getElementById('treatment-decision-summary');
        if (!decision) {
            summaryEl.classList.add('hidden');
            return;
        }
        const decidedAt = decision.decidedAt ? new Date(decision.decidedAt).toLocaleDateString('es-MX') : '—';
        // decision.residualCVaR puede faltar del todo (Transferir, o una decisión adoptada antes
        // de que este campo existiera) — `!= null` trata "ausente" y "null" igual, sin mostrar
        // nada de CVaR en vez de "$NaN".
        const cvarText =
            decision.residualCVaR != null
                ? ` / ${shortMetricLabel('cvar95', 'CVaR95')}: ${formatCurrency(decision.residualCVaR)}`
                : '';
        document.getElementById('treatment-decision-summary-text').textContent =
            `Decisión de Tratamiento: ${STRATEGY_LABELS[decision.strategy]} — Residual ${shortMetricLabel('ale', 'ALE')}: ${formatCurrency(decision.residualALE)}${cvarText} (adoptada el ${decidedAt}).`;
        summaryEl.classList.remove('hidden');
    },

    // Adopta `strategyKey` ('mitigar'|'transferir'|'evitar'|'aceptar'|'mitigarTransferir') como
    // la decisión de tratamiento de este riesgo — lee el residualALE ya calculado en
    // state.treatment.lastResult (la última corrida de /api/treatment/evaluate, ver
    // updateTreatmentView) en vez de volver a pedirlo. Para mitigarTransferir, ese residualALE es
    // un valor ESPERADO derivado del árbol de decisión combinado (ver el comentario junto a
    // results.mitigarTransferir en backend/src/lib/treatment.js) — no un residual determinístico
    // como el de las otras 4, pero sí utilizable: es la misma cifra que ya se le mostraba al
    // usuario en el mensaje de recomendación, solo que ahora también queda persistida.
    async adoptStrategy(strategyKey) {
        // Por si hay una edición reciente (costo, fiabilidad...) todavía sin persistir — no
        // tiene sentido adoptar una decisión sobre datos que el propio Registro no refleja
        // todavía.
        this._flushPendingSaves();
        const entry = state.treatment.currentEntry;
        const result = state.treatment.lastResult;
        if (!entry || !result || !result[strategyKey]) return;
        // residualCVaR es null para Transferir (fuera de alcance, ver evaluateTreatmentStrategies)
        // o si este riesgo no tiene un CVaR95 conocido — se omite del todo en vez de mandar
        // `null` explícito, así register.js no tiene que distinguir "nunca vino" de "vino null".
        const decision = {
            strategy: strategyKey,
            residualALE: result[strategyKey].residualALE,
            decidedAt: new Date().toISOString(),
        };
        if (typeof result[strategyKey].residualCVaR === 'number') {
            decision.residualCVaR = result[strategyKey].residualCVaR;
        }
        await this._persistDecision(entry, decision);
        showToast(`Se adoptó "${STRATEGY_LABELS[strategyKey]}" como la decisión de tratamiento de este riesgo.`);
    },

    async clearDecision() {
        const entry = state.treatment.currentEntry;
        if (!entry) return;
        await this._persistDecision(entry, null);
        showToast('Se quitó la decisión de tratamiento — el riesgo vuelve a estar sin decidir.');
    },

    // Mismo patrón que persistTreatment: PUT reemplaza la entrada completa, así que se manda
    // spread (...entry) y solo se pisa treatmentDecision, para no perder el resto de sus datos.
    async _persistDecision(entry, decision) {
        let res;
        try {
            res = await App.Api.request(`/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                body: { ...entry, treatmentDecision: decision },
            });
        } catch (e) {
            showToast(e.userMessage || 'No se pudo guardar la decisión de tratamiento.');
            return;
        }
        if (state.treatment.currentEntry && state.treatment.currentEntry.id === entry.id) {
            state.treatment.currentEntry = res.entry;
        }
        const idx = (state.fair.riskRegister || []).findIndex((r) => r.id === entry.id);
        if (idx !== -1) state.fair.riskRegister[idx] = res.entry;
        this.renderTreatmentDecision();
    },
};

App.Treatment = Treatment;
