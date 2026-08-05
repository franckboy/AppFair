import { App } from './app-namespace.js';
import { Modal } from './modal.js';
import { sanitizeHTML, showToast } from './utils.js';

// --- Contexto Organizacional (RIMS RA.1-2015, cláusula 5.2 "Entender la organización y sus
// objetivos") --- Captura una sola vez el contexto de la organización apreciada, para que
// cada análisis de riesgo se interprete dentro de su misión, apetito de riesgo y partes
// interesadas, en vez de evaluarse en el vacío.
export const OrgContext = {
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
        document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = true));
        document
            .querySelectorAll('#fairAnalysisPage, #registerPage, #assetsPage')
            .forEach((el) => el.classList.add('hidden'));
        document.getElementById('orgcontext-gate-form').innerHTML = this.buildFormHTML('orgctx-gate');
        document.getElementById('orgcontext-gate').classList.remove('hidden');

        const saveBtn = document.getElementById('orgctx-gate-save-btn');
        const saveHandler = async () => {
            saveBtn.disabled = true;
            try {
                await this.save(this.readFormValues('orgctx-gate'));
                document.getElementById('orgcontext-gate').classList.add('hidden');
                document.querySelectorAll('.nav-requires-boot').forEach((btn) => (btn.disabled = false));
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
    },
};

App.OrgContext = OrgContext;
