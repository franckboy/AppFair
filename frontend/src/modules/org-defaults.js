import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { sanitizeHTML, showToast } from './utils.js';

// --- Valores por Defecto de la Organización ---
// Datos que casi no cambian entre un análisis y otro (nivel de defensa típico, dueño del
// riesgo, criterio de calidad de datos). Se capturan una sola vez aquí y se
// auto-rellenan en cada análisis nuevo, en vez de tener que volver a escribirlos.
export const OrgDefaults = {
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

App.OrgDefaults = OrgDefaults;
