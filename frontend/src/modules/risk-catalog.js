import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { sanitizeHTML, showToast } from './utils.js';

// ============================================================
// App.RiskCatalog — el Catálogo de Riesgos (Análisis Rápido): un modal con 3 selects
// encadenados — Dominio → Categoría → Amenaza Específica — para llenar "Nombre del Riesgo"
// eligiendo de una lista curada según metodologías reconocidas (ASIS, C-TPAT, NFPA, ISO
// 28000/TAPA, COSO) en vez de escribirla a mano. Contenido de solo lectura, viene de
// GET /api/config/profiles → riskCatalog (ver backend/src/data/profiles.js).
// ============================================================
export const RiskCatalog = {
    init() {
        // Un solo botón ahora (fair-riskName/fair-riskDescription, ya unificados) — antes
        // había uno separado en la página vieja de Análisis Rápido.
        const btn = document.getElementById('open-risk-catalog-btn-fair');
        if (btn) btn.addEventListener('click', () => this.openPicker('fair-riskName', 'fair-riskDescription'));
    },

    openPicker(nameFieldId = 'fair-riskName', descFieldId = 'fair-riskDescription') {
        const catalog = state.quick.riskCatalog || {};
        const domainKeys = Object.keys(catalog);
        if (domainKeys.length === 0) {
            showToast('El Catálogo de Riesgos no está disponible en este momento.');
            return;
        }

        Modal.title.textContent = 'Catálogo de Riesgos';
        Modal.body.innerHTML = `
            <p class="description-text mb-4">
                Elige un riesgo ya catalogado según metodologías reconocidas de gestión de
                riesgos (ASIS International, C-TPAT, NFPA, ISO) para nombrar tu riesgo de
                forma consistente, en vez de escribirlo a mano.
            </p>
            <div class="input-group">
                <label for="riskcat-domain">Dominio:</label>
                <select id="riskcat-domain" class="form-select"></select>
            </div>
            <div class="input-group">
                <label for="riskcat-category">Categoría:</label>
                <select id="riskcat-category" class="form-select"></select>
            </div>
            <div class="input-group">
                <label for="riskcat-threat">Amenaza Específica:</label>
                <select id="riskcat-threat" class="form-select"></select>
            </div>
            <div id="riskcat-info" class="p-3 bg-gray-50 border rounded-md text-sm text-gray-700 mt-2"></div>
        `;
        Modal.footer.innerHTML = `
            <button id="riskcat-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="riskcat-use-btn" class="btn btn-primary">Usar este riesgo</button>
        `;
        Modal.modal.classList.remove('hidden');

        const domainSelect = document.getElementById('riskcat-domain');
        const categorySelect = document.getElementById('riskcat-category');
        const threatSelect = document.getElementById('riskcat-threat');
        const infoEl = document.getElementById('riskcat-info');

        domainKeys.forEach((key) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = catalog[key].label;
            domainSelect.appendChild(opt);
        });

        const currentCategories = () => (catalog[domainSelect.value] || {}).categories || {};
        const currentThreats = () => (currentCategories()[categorySelect.value] || {}).threats || [];
        const currentThreat = () => currentThreats().find((t) => t.key === threatSelect.value);

        const updateInfo = () => {
            const threat = currentThreat();
            infoEl.innerHTML = threat
                ? `<p><strong>${sanitizeHTML(threat.standard)}</strong></p><p class="mt-1">${sanitizeHTML(threat.description)}</p>`
                : '';
        };

        const populateThreats = () => {
            threatSelect.innerHTML = '';
            currentThreats().forEach((t) => {
                const opt = document.createElement('option');
                opt.value = t.key;
                opt.textContent = t.name;
                threatSelect.appendChild(opt);
            });
            updateInfo();
        };

        const populateCategories = () => {
            categorySelect.innerHTML = '';
            Object.entries(currentCategories()).forEach(([key, category]) => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = category.label;
                categorySelect.appendChild(opt);
            });
            populateThreats();
        };

        domainSelect.addEventListener('change', populateCategories);
        categorySelect.addEventListener('change', populateThreats);
        threatSelect.addEventListener('change', updateInfo);
        populateCategories();

        document.getElementById('riskcat-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('riskcat-use-btn').addEventListener('click', () => {
            const threat = currentThreat();
            if (!threat) return;
            this.useSelected(threat, nameFieldId, descFieldId);
            Modal.hide();
        });
    },

    // No pisa una Descripción que el usuario ya haya escrito — mismo principio que ya sigue
    // el resto de la app (sugerir, nunca sobrescribir en silencio algo que ya se llenó).
    useSelected(threat, nameFieldId = 'fair-riskName', descFieldId = 'fair-riskDescription') {
        const nameInput = document.getElementById(nameFieldId);
        const descInput = document.getElementById(descFieldId);
        // catalogStandard/catalogCode (de qué amenaza del catálogo salió este riesgo) — ver
        // calculateAll(), que lo guarda en fullData.catalogStandard/catalogCode para poder
        // mostrarlo después. Nombre y Descripción son un solo campo ahora (fair-riskName/
        // fair-riskDescription), así que siempre corresponde rastrearlo.
        state.quick.selectedCatalogRef = { standard: threat.standard, code: threat.code };
        nameInput.value = threat.name;
        nameInput.dispatchEvent(new Event('input'));
        if (descInput && !descInput.value.trim()) {
            descInput.value = threat.description;
            descInput.dispatchEvent(new Event('input'));
        }
        showToast('Riesgo cargado desde el catálogo.');
    },
};

App.RiskCatalog = RiskCatalog;
