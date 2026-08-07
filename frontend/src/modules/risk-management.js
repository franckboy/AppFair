import { App } from './app-namespace.js';
import { state } from './state.js';
import { debounce, showToast } from './utils.js';

// ============================================================
// App.RiskManagement — Gobernanza/Revisión y Plan de Seguridad de cualquier riesgo ya guardado,
// en su propia página. Antes vivían dentro del Paso 4 del wizard, atado a que acabaras de correr
// una simulación — se sacaron de ahí porque son datos que se actualizan durante toda la vida del
// riesgo (reasignar dueño, mover la fecha de revisión, ajustar medidas de seguridad), no algo que
// solo se define una vez al simular. A diferencia de App.Treatment, aplica a Amenazas y
// Oportunidades por igual — el selector no excluye ningún tipo.
//
// "Calidad de la Información" (fair-data-source/fair-data-confidence/fair-data-notes) se queda en
// el wizard: fair-data-confidence es un insumo real del cálculo (alimenta en vivo el autocálculo
// de Vulnerabilidad y Magnitud de Pérdida, ver App.FairWizard._applyLossMagnitudeAuto), así que no
// se puede diferir a una página aparte sin romper eso.
// ============================================================

// Misma sugerencia de fecha de revisión que antes vivía en App.FairWizard.suggestReviewDate,
// justo después de simular — aquí corre al elegir un riesgo cuyo reviewDate sigue vacío, usando
// evaluationLevel ya guardado en el Registro (ISO 31000, cláusula 6.6: un riesgo Crítico se
// revisa pronto, uno Aceptable puede esperar un año).
function suggestedReviewDate(evaluationLevel) {
    const level = evaluationLevel || '';
    let months = 12;
    if (level.includes('Crítico')) {
        months = 3;
    } else if (level.includes('Requiere Tratamiento') || level.includes('Oportunidad Significativa')) {
        months = 6;
    } else if (level.includes('Medio')) {
        // Nivel Medio (ver evaluateFairThreat, backend/src/lib/evaluation.js) — a mitad de
        // camino entre Alto (6 meses) y Aceptable (12 meses), ni tan urgente como el primero
        // ni tan tranquilo como el segundo.
        months = 9;
    }
    const suggested = new Date();
    suggested.setMonth(suggested.getMonth() + months);
    return suggested.toISOString().split('T')[0];
}

export const RiskManagement = {
    // Guardados pendientes de disparar (debounce) — selectRisk() los vacía ANTES de cambiar de
    // riesgo (ver _flushPendingSaves), para no perder una edición en curso silenciosamente.
    _pendingSaves: [],

    init() {
        this._pendingSaves = [];
        document
            .getElementById('riskmgmt-risk-select')
            .addEventListener('change', (e) => this.selectRisk(e.target.value));

        const debouncedSave = debounce(() => this.persist(), 500);
        this._pendingSaves.push(debouncedSave);
        ['fair-owner', 'fair-review-date', 'fair-assessor', 'fair-assessment-date', 'fair-assessment-location'].forEach(
            (id) => {
                document.getElementById(id).addEventListener('input', debouncedSave);
                document.getElementById(id).addEventListener('change', debouncedSave);
            },
        );
        const debouncedSecurityPlan = debounce(() => this.persist(), 600);
        this._pendingSaves.push(debouncedSecurityPlan);
        document.getElementById('fair-security-plan').addEventListener('input', debouncedSecurityPlan);
    },

    _flushPendingSaves() {
        this._pendingSaves.forEach((debounced) => debounced.flush());
    },

    // riskNameToSelect: para llegar aquí con un riesgo específico ya elegido (ver "Gestionar este
    // riesgo" en el wizard) — si no está entre los riesgos disponibles (ej. ya no existe), cae al
    // primero de la lista.
    async load(riskNameToSelect = null) {
        await App.FairRegister.loadRiskRegister(false);
        this.populateRiskSelect(riskNameToSelect);
    },

    populateRiskSelect(riskNameToSelect = null) {
        const select = document.getElementById('riskmgmt-risk-select');
        const empty = document.getElementById('riskmgmt-empty');
        const content = document.getElementById('riskmgmt-content');
        const risks = state.fair.riskRegister || [];

        if (risks.length === 0) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            select.innerHTML = '';
            state.riskManagement.currentEntry = null;
            return;
        }
        empty.classList.add('hidden');
        content.classList.remove('hidden');

        const currentValue = riskNameToSelect || select.value;
        select.innerHTML = risks
            .map((r) => `<option value="${sanitizeOption(r.riskName)}">${sanitizeOption(r.riskName)}</option>`)
            .join('');
        const toSelect = risks.some((r) => r.riskName === currentValue) ? currentValue : risks[0].riskName;
        select.value = toSelect;
        this.selectRisk(toSelect);
    },

    selectRisk(riskName) {
        const entry = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!entry) return;
        // Dispara YA cualquier guardado pendiente del riesgo ANTERIOR (ver _pendingSaves) — antes
        // de este flush, cambiar de riesgo mientras el debounce seguía en vuelo perdía la edición
        // en curso en silencio.
        this._flushPendingSaves();
        state.riskManagement.currentEntry = entry;
        document.getElementById('riskmgmt-risk-select').value = riskName;

        document.getElementById('fair-owner').value = entry.owner && entry.owner !== '—' ? entry.owner : '';
        document.getElementById('fair-review-date').value =
            entry.reviewDate || suggestedReviewDate(entry.evaluationLevel);
        document.getElementById('fair-assessor').value = entry.assessor || '';
        document.getElementById('fair-assessment-date').value = entry.assessmentDate || '';
        document.getElementById('fair-assessment-location').value = entry.assessmentLocation || '';
        document.getElementById('fair-security-plan').value =
            entry.securityPlan && entry.securityPlan !== '—' ? entry.securityPlan : '';
    },

    // Igual que App.Treatment.persistTreatment: PUT reemplaza la entrada completa (no es un PATCH
    // parcial, ver backend/src/routes/register.js), así que se manda la entrada entera tal cual ya
    // estaba (spread) y solo se pisan estos campos, para no perder el resto de sus datos.
    async persist() {
        const entry = state.riskManagement.currentEntry;
        if (!entry) return;

        const body = {
            ...entry,
            owner: document.getElementById('fair-owner').value.trim() || '—',
            reviewDate: document.getElementById('fair-review-date').value || null,
            assessor: document.getElementById('fair-assessor').value.trim() || null,
            assessmentDate: document.getElementById('fair-assessment-date').value || null,
            assessmentLocation: document.getElementById('fair-assessment-location').value.trim() || null,
            securityPlan: document.getElementById('fair-security-plan').value.trim() || '—',
        };

        let res;
        try {
            res = await App.Api.request(`/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                body,
            });
        } catch (e) {
            showToast(e.userMessage || 'No se pudo guardar la gestión de este riesgo.');
            return;
        }
        // Solo pisa currentEntry/el formulario visible si TODAVÍA es este mismo riesgo el que
        // está siendo mostrado — si el usuario ya cambió a otro riesgo mientras este guardado
        // estaba en vuelo (un solo await, pero igual posible), currentEntry no debe volver a
        // apuntar al riesgo anterior.
        if (state.riskManagement.currentEntry && state.riskManagement.currentEntry.id === entry.id) {
            state.riskManagement.currentEntry = res.entry;
        }
        const idx = (state.fair.riskRegister || []).findIndex((r) => r.id === entry.id);
        if (idx !== -1) state.fair.riskRegister[idx] = res.entry;
    },
};

// Nombres de riesgo pueden traer comillas dobles — sanitizeHTML no las escapa (ver
// risk-cascade-tree.js), pero <option value="..."> sí las necesita escapadas para no romper el
// atributo. select.value ya devuelve el string decodificado tal cual al leerlo después.
function sanitizeOption(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

App.RiskManagement = RiskManagement;
