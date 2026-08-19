import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { sanitizeHTML, showToast } from './utils.js';

// --- Bitácora de Incidentes ---
//
// Lo único que puede CONTRADECIR al modelo. Todo lo demás que la app calcula sale de juicio experto
// y referencias del sector: un prior alimenta, no falsea. Ver backend/src/lib/incidentLog.js para
// el desarrollo completo, incluida la razón por la que un conteo de bitácora es una observación de
// LEF (pérdidas) y no de TEF (intentos).
//
// Todavía NO mezcla con nada: no hay ponderación por credibilidad y ninguna cifra del Registro
// cambia. Es captura y diagnóstico. Se construye ahora, antes de que haya un cliente, porque
// meterle captura de datos a una app ya desplegada es mucho más caro que dejar el hueco listo.

// Los tres estados, con el texto que explica por qué son tres y no dos. El default es "sin datos"
// a propósito: si "no lo llené" contara como cero, el riesgo se iría al piso para todo lo que nadie
// midió — ausencia de evidencia convertida en evidencia de ausencia.
const ESTADOS = [
    { value: 'sin_datos', label: 'No lo medimos' },
    { value: 'cero', label: 'Revisado: no pasó ninguna vez' },
    { value: 'conteo', label: 'Pasó N veces' },
];

const porcentaje = (x) => `${(x * 100).toFixed(x < 0.01 ? 2 : 0)} %`;
const tasa = (x) => (x >= 1 ? x.toFixed(2) : x.toFixed(4));

export const IncidentLog = {
    /** Última respuesta del backend: entradas + unidades de exposición + diagnóstico. */
    data: { entries: [], exposureUnits: {}, summary: null },

    async load() {
        this.data = await App.Api.request('/api/config/incident-log');
        return this.data;
    },

    /**
     * Texto del diagnóstico de una entrada. Es la primera vez en toda la app que una cifra del
     * motor se pone al lado de un dato real — exactamente la comparación que el modelo reconoce
     * que le falta.
     */
    diagnosticoTexto(d) {
        if (!d || d.estado === 'sin_datos') return '';
        const partes = [];
        if (d.tasaObservada !== null) {
            partes.push(`observado ${tasa(d.tasaObservada)} por ${sanitizeHTML(d.unidad || '')}`);
        }
        if (d.cotaSuperior95 !== null) {
            // Regla de los tres. Un cero no significa "la tasa es cero": significa que está por
            // debajo de esta cota, y eso es lo que se puede afirmar.
            partes.push(`la tasa real está por debajo de ${tasa(d.cotaSuperior95)} (95 % de confianza)`);
        }
        if (d.lefModelo !== null) {
            partes.push(`el modelo esperaba ${tasa(d.lefModelo)} por año`);
        }
        if (d.probabilidadDeEseCero !== null) {
            // Lo que separa "los controles funcionan" de "no pasó nada y tampoco tenía por qué".
            // Sin esto, un cero invita a bajar el riesgo catastrófico por ausencia de evidencia.
            const p = d.probabilidadDeEseCero;
            partes.push(
                p < 0.05
                    ? `un cero así sería raro si el modelo tuviera razón (${porcentaje(p)}): el modelo parece exagerar`
                    : `un cero así es perfectamente normal aunque el modelo tenga razón (${porcentaje(p)}): no prueba nada`,
            );
        } else if (d.comparableConModelo === false) {
            partes.push('no comparable con el modelo: la exposición no está en años');
        }
        if (d.vinculoRoto) partes.push('⚠ el riesgo vinculado ya no existe en el Registro');
        return partes.join(' · ');
    },

    async openEditor() {
        try {
            await this.load();
        } catch {
            Modal.alert('No se pudo leer la bitácora.', 'Error');
            return;
        }

        const working = (this.data.entries || []).map((e) => ({
            ...e,
            exposicion: e.exposicion ? { ...e.exposicion } : null,
        }));
        const unidades = this.data.exposureUnits || {};
        const diagPorIndice = (this.data.summary && this.data.summary.diagnostics) || [];
        // Los riesgos del Registro, para el vínculo. Sin él la bitácora es dato huérfano: cuenta
        // eventos que no le corresponden a ningún riesgo y no hay contra qué compararlos.
        const riesgos = (state.fair.riskRegister || []).filter((r) => r.riskType !== 'oportunidad');

        const syncWorkingFromDom = () => {
            document.querySelectorAll('[data-log-row]').forEach((fila) => {
                const i = Number(fila.dataset.index);
                const leer = (campo) => {
                    const el = fila.querySelector(`[data-field="${campo}"]`);
                    return el ? el.value.trim() : '';
                };
                const estado = leer('estado') || 'sin_datos';
                const cantidad = leer('cantidad');
                working[i] = {
                    tipoEvento: leer('tipoEvento'),
                    riskName: leer('riskName') || null,
                    estado,
                    // El conteo solo existe en estado `conteo`. En `cero` el conteo ES cero y no se
                    // guarda aparte: dos campos que tienen que concordar son dos que se contradicen.
                    conteo: estado === 'conteo' && leer('conteo') !== '' ? Number(leer('conteo')) : null,
                    exposicion: cantidad === '' ? null : { cantidad: Number(cantidad), unidad: leer('unidad') },
                    notas: working[i] ? working[i].notas : null,
                };
            });
        };

        const renderRow = (e, i) => {
            const exp = e.exposicion || {};
            const d = diagPorIndice[i];
            const diag = this.diagnosticoTexto(d);
            return `
            <tr data-log-row data-index="${i}" class="border-b align-top">
                <td class="px-2 py-1"><input type="text" class="form-input" data-field="tipoEvento" value="${sanitizeHTML(e.tipoEvento || '')}" placeholder="Ej. Robo de carga completa"></td>
                <td class="px-2 py-1">
                    <select class="form-select" data-field="riskName">
                        <option value="">— sin vincular —</option>
                        ${riesgos.map((r) => `<option value="${sanitizeHTML(r.riskName)}" ${e.riskName === r.riskName ? 'selected' : ''}>${sanitizeHTML(r.riskName)}</option>`).join('')}
                    </select>
                </td>
                <td class="px-2 py-1">
                    <select class="form-select" data-field="estado">
                        ${ESTADOS.map((s) => `<option value="${s.value}" ${(e.estado || 'sin_datos') === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
                    </select>
                </td>
                <td class="px-2 py-1"><input type="number" class="form-input" data-field="conteo" min="1" step="1" value="${typeof e.conteo === 'number' ? e.conteo : ''}" placeholder="—"></td>
                <td class="px-2 py-1"><input type="number" class="form-input" data-field="cantidad" min="0" step="any" value="${typeof exp.cantidad === 'number' ? exp.cantidad : ''}" placeholder="—"></td>
                <td class="px-2 py-1">
                    <select class="form-select" data-field="unidad">
                        ${Object.entries(unidades)
                            .map(
                                ([k, v]) =>
                                    `<option value="${k}" ${(exp.unidad || 'anios') === k ? 'selected' : ''}>${sanitizeHTML(v.label)}</option>`,
                            )
                            .join('')}
                    </select>
                </td>
                <td class="py-1"><button type="button" class="btn btn-danger text-xs" data-remove-row title="Quitar">✕</button></td>
            </tr>
            ${diag ? `<tr class="border-b"><td colspan="7" class="px-2 pb-2 text-xs text-gray-600" data-log-diagnostic>${diag}</td></tr>` : ''}`;
        };

        const render = () => {
            Modal.setSize('wide');
            Modal.title.textContent = 'Bitácora de Incidentes';
            const s = this.data.summary || {};
            Modal.body.innerHTML = `
                <p class="description-text mb-2">
                    Lo que de verdad pasó. Es lo único que puede <strong>contradecir</strong> al modelo:
                    todo lo demás que la app calcula sale de juicio experto y referencias del sector, y
                    un promedio de la industria alimenta el cálculo pero no puede demostrar que esté mal.
                </p>
                <div class="p-2 mb-3 bg-blue-50 border-l-4 border-blue-400 text-blue-900 text-sm rounded">
                    <strong>"No lo medimos" y "revisado, no pasó" no son lo mismo.</strong> El primero es
                    ausencia de evidencia y no se usa para nada. El segundo es evidencia de ausencia, y de
                    las fuertes. Por eso hay tres opciones y no dos — y por eso un cero hay que declararlo
                    a propósito, nunca dejando el campo vacío.
                </div>
                <p class="text-xs text-gray-600 mb-3">
                    Por ahora esto <strong>no cambia ninguna cifra</strong> del Registro: se guarda y se
                    compara, nada más. Mezclarla con el modelo pesando por cuántos datos hay es un paso
                    aparte, y necesita más bitácora de la que suele haber al principio.
                </p>
                <p id="log-modal-error" class="text-red-600 text-sm mb-3 hidden"></p>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr class="text-left border-b">
                                <th class="px-2 py-1">Tipo de evento</th>
                                <th class="px-2 py-1">Riesgo del Registro</th>
                                <th class="px-2 py-1">¿Qué sabemos?</th>
                                <th class="px-2 py-1">¿Cuántas veces?</th>
                                <th class="px-2 py-1">¿En cuánto?</th>
                                <th class="px-2 py-1">Unidad</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="log-modal-body">${working.map(renderRow).join('')}</tbody>
                    </table>
                </div>
                <button type="button" id="log-add-btn" class="btn btn-secondary text-sm mt-3">+ Agregar tipo de evento</button>
                ${
                    s.total
                        ? `<p class="text-xs text-gray-600 mt-3">${s.conEvidencia} de ${s.total} con evidencia · ${s.cerosDeclarados} ceros declarados · <strong>${s.comparables}</strong> comparables hoy contra el modelo${s.vinculosRotos ? ` · ⚠ ${s.vinculosRotos} vínculo(s) roto(s)` : ''}</p>`
                        : ''
                }
            `;
            Modal.footer.innerHTML = `
                <button id="log-cancel-btn" class="btn btn-secondary">Cancelar</button>
                <button id="log-save-btn" class="btn btn-primary">Guardar</button>
            `;
            Modal.modal.classList.remove('hidden');

            document.getElementById('log-add-btn').addEventListener('click', () => {
                // Igual que en Gestionar Controles: leer el DOM ANTES de re-renderizar, o agregar
                // una fila borra en silencio lo que el usuario ya escribió en las otras.
                syncWorkingFromDom();
                working.push({ tipoEvento: '', riskName: null, estado: 'sin_datos', conteo: null, exposicion: null });
                render();
            });
            document.querySelectorAll('[data-remove-row]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    syncWorkingFromDom();
                    working.splice(Number(btn.closest('[data-log-row]').dataset.index), 1);
                    render();
                });
            });
            document.getElementById('log-cancel-btn').addEventListener('click', () => Modal.hide());
            document
                .getElementById('log-save-btn')
                .addEventListener('click', () => this._save(syncWorkingFromDom, working));
        };

        render();
    },

    async _save(syncWorkingFromDom, working) {
        syncWorkingFromDom();
        const error = document.getElementById('log-modal-error');
        const mostrar = (msg) => {
            error.textContent = msg;
            error.classList.remove('hidden');
        };

        // Se valida acá lo mismo que el backend, para poder decirlo ANTES de mandar. El backend
        // vuelve a validar igual: esto es comodidad, no la defensa.
        for (const [i, e] of working.entries()) {
            const donde = `Fila ${i + 1}`;
            if (!e.tipoEvento) return mostrar(`${donde}: falta el tipo de evento.`);
            if (e.estado === 'conteo' && (!e.conteo || e.conteo <= 0)) {
                return mostrar(`${donde}: escribe cuántas veces pasó, o cambia a "revisado: no pasó ninguna vez".`);
            }
            if ((e.estado === 'conteo' || e.estado === 'cero') && !e.exposicion) {
                return mostrar(`${donde}: falta la exposición. "3 robos" no dice nada sin "en cuántos años".`);
            }
        }

        try {
            this.data = await App.Api.request('/api/config/incident-log', {
                method: 'PUT',
                body: { entries: working },
            });
            Modal.hide();
            showToast('Bitácora guardada.');
        } catch (err) {
            mostrar(err.userMessage || 'No se pudo guardar la bitácora.');
        }
    },
};

App.IncidentLog = IncidentLog;
