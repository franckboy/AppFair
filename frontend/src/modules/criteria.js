import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { getSafeNumber, showToast } from './utils.js';

// --- Criterios de Riesgo (Contexto — ISO 31000 cláusula 6.3.4) ---
// Única fuente de verdad para los umbrales de aceptabilidad del riesgo.
// Se editan desde el menú "Configuración" (ver App.ConfigMenu) y se guardan en el backend,
// en vez de vivir como números fijos repartidos por el código.
export const Criteria = {
    init() {},

    async save(newCriteria) {
        const updated = await App.Api.request('/api/config/criteria', { method: 'PUT', body: newCriteria });
        state.config.riskCriteria = updated;
    },

    openEditor() {
        const c = state.config.riskCriteria;
        const formHTML = `
            <p class="description-text mb-4">
                Estos criterios definen qué se considera un riesgo Aceptable, Alto o Crítico para tu organización
                (Contexto, ISO 31000). Se guardan en este navegador y aplican a todos tus análisis.
            </p>
            <p id="criteria-form-error" class="text-red-600 text-sm mb-3 hidden"></p>
            <h4 class="font-semibold text-gray-700 mb-2">Bandas de Riesgo Residual (%) — Mapa de Calor</h4>
            <div class="grid grid-cols-3 gap-3 mb-4">
                <div class="input-group">
                    <label for="crit-rrt-medio">Medio, desde:</label>
                    <input type="number" id="crit-rrt-medio" class="form-input" value="${c.rrtBands.medio}" min="0" max="100">
                </div>
                <div class="input-group">
                    <label for="crit-rrt-alto">Alto, desde:</label>
                    <input type="number" id="crit-rrt-alto" class="form-input" value="${c.rrtBands.alto}" min="0" max="100">
                </div>
                <div class="input-group">
                    <label for="crit-rrt-critico">Crítico, desde:</label>
                    <input type="number" id="crit-rrt-critico" class="form-input" value="${c.rrtBands.critico}" min="0" max="100">
                </div>
            </div>
            <h4 class="font-semibold text-gray-700 mb-2">Pérdida Anual Esperada (ALE) — Análisis FAIR</h4>
            <p class="description-text mb-2">Aún no se usan para clasificar automáticamente los resultados de FAIR (eso viene en el siguiente paso), pero ya quedan guardados.</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="input-group">
                    <label for="crit-ale-aceptable">ALE Aceptable (hasta):</label>
                    <input type="number" id="crit-ale-aceptable" class="form-input" value="${c.aleAceptable}" min="0">
                </div>
                <div class="input-group">
                    <label for="crit-ale-critico">ALE Crítico (desde):</label>
                    <input type="number" id="crit-ale-critico" class="form-input" value="${c.aleCritico}" min="0">
                </div>
                <div class="input-group">
                    <label for="crit-ale-umbral">Umbral "Prob. de superar $X/año":</label>
                    <input type="number" id="crit-ale-umbral" class="form-input" value="${c.aleUmbralExcedencia}" min="0">
                </div>
            </div>
        `;
        Modal.title.textContent = 'Criterios de Riesgo (Contexto)';
        Modal.body.innerHTML = formHTML;
        Modal.footer.innerHTML = `
            <button id="criteria-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="criteria-save-btn" class="btn btn-primary">Guardar Criterios</button>
        `;
        Modal.modal.classList.remove('hidden');

        document.getElementById('criteria-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('criteria-save-btn').addEventListener('click', async (e) => {
            const medio = getSafeNumber(document.getElementById('crit-rrt-medio'));
            const alto = getSafeNumber(document.getElementById('crit-rrt-alto'));
            const critico = getSafeNumber(document.getElementById('crit-rrt-critico'));
            const aleAceptable = getSafeNumber(document.getElementById('crit-ale-aceptable'));
            const aleCritico = getSafeNumber(document.getElementById('crit-ale-critico'));
            const errorEl = document.getElementById('criteria-form-error');

            if (!(medio < alto && alto < critico)) {
                errorEl.textContent = 'Los umbrales de Riesgo Residual deben ser crecientes: Medio < Alto < Crítico.';
                errorEl.classList.remove('hidden');
                return;
            }
            if (!(aleAceptable < aleCritico)) {
                errorEl.textContent = 'El ALE Aceptable debe ser menor que el ALE Crítico.';
                errorEl.classList.remove('hidden');
                return;
            }

            const saveBtn = e.target;
            saveBtn.disabled = true;
            try {
                await this.save({
                    rrtBands: { medio, alto, critico },
                    aleAceptable: aleAceptable,
                    aleCritico: aleCritico,
                    aleUmbralExcedencia: getSafeNumber(document.getElementById('crit-ale-umbral')),
                });
                Modal.hide();
                showToast('Criterios de riesgo actualizados.');
            } catch (err) {
                errorEl.textContent = err.userMessage || 'No se pudo guardar. Intenta de nuevo.';
                errorEl.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
            }
        });
    },
};

App.Criteria = Criteria;
