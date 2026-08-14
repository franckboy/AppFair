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

    // declared (ver GET/PUT /api/config/criteria) es false mientras la organización no haya
    // guardado su propio ALE Crítico — hasta entonces, state.config.riskCriteria trae el default
    // heredado del código ($250,000/20%), un número que nadie eligió. Usado por el candado
    // obligatorio de primer uso (ver showGate) para no dejar clasificar ningún riesgo contra ese
    // default sin que el usuario lo haya declarado explícitamente.
    isComplete() {
        return !!(state.config.riskCriteria && state.config.riskCriteria.declared);
    },

    // Gate obligatorio de primer uso — mismo patrón que App.OrgContext.showGate, y corre justo
    // después de ese (ver main.js): "nadie puede perder más del 100% de lo que está dispuesto a
    // perder" — ese 100% (ALE Crítico) y el % que se acepta de él son criterio de la
    // organización, no algo que la app pueda adivinar. Solo pide esos dos números — las Bandas de
    // Riesgo Residual y el Umbral de Excedencia se quedan en sus valores por defecto, editables
    // después desde "Criterios de Riesgo" (no son parte de este candado).
    showGate(onComplete) {
        document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = true));
        document
            .querySelectorAll('#fairAnalysisPage, #dashboardPage, #assetsPage')
            .forEach((el) => el.classList.add('hidden'));
        document.getElementById('criteria-gate-form').innerHTML = `
            <div class="input-group">
                <label for="criteria-gate-critico">¿Cuál es la pérdida anual máxima que consideras crítica? (tu 100%, en USD)</label>
                <input type="number" id="criteria-gate-critico" class="form-input" min="1" placeholder="Ej. 250000">
            </div>
            <div class="input-group">
                <label for="criteria-gate-percent">¿Qué porcentaje de ese máximo estás dispuesto a aceptar sin que sea un problema?</label>
                <input type="number" id="criteria-gate-percent" class="form-input" min="1" max="99" value="20">
            </div>
            <p id="criteria-gate-error" class="text-red-600 text-sm mt-2 hidden"></p>
        `;
        document.getElementById('criteria-gate').classList.remove('hidden');

        const saveBtn = document.getElementById('criteria-gate-save-btn');
        const saveHandler = async () => {
            const aleCritico = getSafeNumber(document.getElementById('criteria-gate-critico'));
            const aleAceptablePercent = getSafeNumber(document.getElementById('criteria-gate-percent'));
            const errorEl = document.getElementById('criteria-gate-error');

            if (!(aleCritico > 0)) {
                errorEl.textContent =
                    'Indica cuánto dinero representa, para tu organización, una pérdida anual crítica.';
                errorEl.classList.remove('hidden');
                return;
            }
            if (!(aleAceptablePercent > 0 && aleAceptablePercent < 100)) {
                errorEl.textContent = 'El porcentaje aceptado debe estar entre 0 y 100.';
                errorEl.classList.remove('hidden');
                return;
            }

            saveBtn.disabled = true;
            try {
                await this.save({
                    rrtBands: { medio: 25, alto: 50, critico: 75 },
                    aleAceptablePercent,
                    aleCritico,
                    // Mismo monto que el ALE Aceptable recién declarado — sin esto, el Umbral de
                    // Excedencia (Probabilidad, eje Y de la Matriz) tendría que caer en OTRO
                    // número inventado por el código ($100,000) en vez de derivarse también de lo
                    // que el usuario acaba de declarar. Se puede ajustar después desde Criterios
                    // de Riesgo si no le hace sentido a la organización.
                    aleUmbralExcedencia: Math.round(aleCritico * (aleAceptablePercent / 100)),
                });
                document.getElementById('criteria-gate').classList.add('hidden');
                document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = false));
                saveBtn.removeEventListener('click', saveHandler);
                showToast('Apetito de Riesgo guardado.');
                onComplete();
            } catch (err) {
                errorEl.textContent = err.userMessage || 'No se pudo guardar. Intenta de nuevo.';
                errorEl.classList.remove('hidden');
            } finally {
                saveBtn.disabled = false;
            }
        };
        saveBtn.addEventListener('click', saveHandler);
    },

    // Reorganizado en 2 secciones con función DISTINTA y explícita (antes eran 2 <h4> genéricos
    // que no dejaban claro qué mueve cada cosa en la app real — el usuario lo señaló viendo esta
    // misma pantalla). Ninguno de los 2 grupos es sobra: los dos siguen en uso hoy.
    openEditor() {
        const c = state.config.riskCriteria;
        const isSimple = App.UIMode.mode === 'simple';
        // Misma redacción llana que ya usa showGate() arriba, en vez de inventar una nueva —
        // este editor es lo mismo que el candado de primer uso, solo que se puede volver a abrir
        // después para ajustar los números ya declarados.
        const section1Title = isSimple ? '1. Cuánto estás dispuesto a perder' : '1. Apetito de Riesgo (global)';
        const criticoLabel = isSimple
            ? '¿Cuál es la pérdida anual máxima que consideras crítica? (tu 100%, en USD):'
            : 'ALE Crítico — tu 100% (USD):';
        const aceptableLabel = isSimple
            ? '¿Qué porcentaje de ese máximo estás dispuesto a aceptar sin que sea un problema?'
            : 'Pérdida Anual Aceptable (%):';
        const section2Title = isSimple
            ? '2. Cómo se ven los colores en la Matriz de Riesgos'
            : '2. Matriz de Riesgos — zonas y eje de Probabilidad';
        const bandsLabel = isSimple
            ? '¿Desde qué porcentaje consideras que un riesgo ya es...?'
            : 'Bandas de Riesgo Residual (%):';
        const umbralLabel = isSimple
            ? '¿A partir de qué monto quieres ver, en la gráfica, qué tan probable es superarlo?'
            : 'Umbral "Prob. de superar $X/año" (eje Y de la Matriz):';
        const formHTML = `
            <p class="description-text mb-4">
                Estos criterios definen qué se considera un riesgo Aceptable, Alto o Crítico para tu organización
                (Contexto, ISO 31000). Se guardan en el servidor y aplican a todos tus análisis.
            </p>
            <p id="criteria-form-error" class="text-red-600 text-sm mb-3 hidden"></p>

            <div class="border border-blue-200 bg-blue-50 rounded-lg p-4 mb-4">
                <h4 class="font-semibold text-gray-800 mb-1">${section1Title}</h4>
                <p class="description-text mb-3">
                    Tu 100% (cuánto puedes perder al año antes de que sea catastrófico) y qué % de eso aceptas.
                    <strong>Esto afecta:</strong> la clasificación Bajo/Medio/Alto/Crítico de "Evaluación" y "Riesgo
                    Inherente/Residual" de CADA riesgo del portafolio, y también el eje Impacto (X) de la Matriz de
                    Riesgos. Cada riesgo puede tener su propio Apetito individual (más restrictivo que este, ver el
                    botón en el Paso 1 del wizard) — esto de aquí es el que usan todos los que no tengan uno propio.
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="input-group">
                        <label for="crit-ale-critico">${criticoLabel}</label>
                        <input type="number" id="crit-ale-critico" class="form-input" value="${c.aleCritico}" min="1">
                    </div>
                    <div class="input-group">
                        <label for="crit-ale-aceptable-percent">${aceptableLabel}</label>
                        <input type="number" id="crit-ale-aceptable-percent" class="form-input" value="${c.aleAceptablePercent}" min="1" max="99">
                    </div>
                </div>
            </div>

            <div class="border border-gray-200 bg-gray-50 rounded-lg p-4">
                <h4 class="font-semibold text-gray-800 mb-1">${section2Title}</h4>
                <p class="description-text mb-3">
                    <strong>Esto afecta</strong> solo cómo se ve la Matriz de Riesgos: las Bandas pintan los colores
                    de fondo (Medio/Alto/Crítico) según dónde cae cada punto por posición, y el Umbral define el eje
                    Probabilidad (Y). No cambian la Evaluación de ningún riesgo — eso lo define la sección 1.
                </p>
                <p class="text-sm font-medium text-gray-600 mb-2">${bandsLabel}</p>
                <div class="grid grid-cols-3 gap-3 mb-3">
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
                <div class="input-group">
                    <label for="crit-ale-umbral">${umbralLabel}</label>
                    <input type="number" id="crit-ale-umbral" class="form-input" value="${c.aleUmbralExcedencia}" min="0">
                </div>
            </div>
        `;
        Modal.setSize('wide');
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
            const aleAceptablePercent = getSafeNumber(document.getElementById('crit-ale-aceptable-percent'));
            const aleCritico = getSafeNumber(document.getElementById('crit-ale-critico'));
            const errorEl = document.getElementById('criteria-form-error');

            if (!(medio < alto && alto < critico)) {
                errorEl.textContent = 'Los umbrales de Riesgo Residual deben ser crecientes: Medio < Alto < Crítico.';
                errorEl.classList.remove('hidden');
                return;
            }
            if (!(aleAceptablePercent > 0 && aleAceptablePercent < 100)) {
                errorEl.textContent = 'La Pérdida Anual Aceptable (%) debe estar entre 0 y 100.';
                errorEl.classList.remove('hidden');
                return;
            }

            const saveBtn = e.target;
            saveBtn.disabled = true;
            try {
                await this.save({
                    rrtBands: { medio, alto, critico },
                    aleAceptablePercent: aleAceptablePercent,
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
