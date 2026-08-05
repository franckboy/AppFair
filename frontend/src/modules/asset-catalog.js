import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { getSafeNumber, sanitizeHTML, showToast } from './utils.js';

// --- Catálogo de Activos ---
// A diferencia de App.RiskCatalog (curado en código, solo lectura), esto es información
// propia de cada organización — CRUD real contra /api/assets, mismo patrón de backend que
// el Registro de Riesgos. Cierra el hueco de "el Costo Mínimo/Máximo de Análisis Rápido no
// toma en cuenta el valor del activo": permite registrar ese valor una vez y reusarlo como
// punto de partida (siempre editable) desde Análisis Rápido y FAIR.
export const AssetCatalog = {
    editingId: null,

    init() {
        document.getElementById('asset-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
        document.getElementById('asset-form-cancel-btn').addEventListener('click', () => this.cancelEdit());
        const assetBtn = document.getElementById('open-asset-catalog-btn-fair');
        if (assetBtn)
            assetBtn.addEventListener('click', () => this.openPicker((asset) => this.applyAssetToFair(asset)));
    },

    async load() {
        try {
            const res = await App.Api.request('/api/assets');
            state.quick.assets = res.assets;
        } catch (e) {
            showToast(e.userMessage || 'No se pudieron cargar los activos.');
        }
        this.render();
    },

    render() {
        const assets = state.quick.assets || [];
        document.getElementById('assets-empty').classList.toggle('hidden', assets.length > 0);
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const tbody = document.getElementById('assets-table-body');
        tbody.innerHTML = assets
            .map(
                (a) => `
            <tr class="border-b">
                <td class="py-2">${sanitizeHTML(a.nombre)}</td>
                <td>${fmt(a.valorEstimado)}</td>
                <td>${sanitizeHTML(a.categoria || '—')}</td>
                <td>${sanitizeHTML(a.ubicacion || '—')}</td>
                <td class="text-right whitespace-nowrap">
                    <button type="button" class="text-blue-600 hover:underline text-sm mr-3" data-edit-id="${a.id}">Editar</button>
                    <button type="button" class="text-red-600 hover:underline text-sm" data-delete-id="${a.id}">Eliminar</button>
                </td>
            </tr>`,
            )
            .join('');
        tbody
            .querySelectorAll('[data-edit-id]')
            .forEach((btn) => btn.addEventListener('click', () => this.startEdit(btn.dataset.editId)));
        tbody
            .querySelectorAll('[data-delete-id]')
            .forEach((btn) => btn.addEventListener('click', () => this.remove(btn.dataset.deleteId)));
    },

    readForm() {
        return {
            nombre: document.getElementById('asset-nombre').value.trim(),
            valorEstimado: getSafeNumber(document.getElementById('asset-valor')),
            categoria: document.getElementById('asset-categoria').value.trim(),
            ubicacion: document.getElementById('asset-ubicacion').value.trim(),
            notas: document.getElementById('asset-notas').value.trim(),
        };
    },

    async handleSubmit() {
        const errorEl = document.getElementById('asset-form-error');
        errorEl.classList.add('hidden');
        const body = this.readForm();
        if (!body.nombre) {
            errorEl.textContent = 'El nombre del activo es obligatorio.';
            errorEl.classList.remove('hidden');
            return;
        }
        try {
            if (this.editingId) {
                await App.Api.request(`/api/assets/${this.editingId}`, { method: 'PUT', body });
                showToast('Activo actualizado.');
            } else {
                await App.Api.request('/api/assets', { method: 'POST', body });
                showToast('Activo agregado al catálogo.');
            }
            this.cancelEdit(); // limpia el formulario y el modo edición
            await this.load();
        } catch (e) {
            errorEl.textContent = e.userMessage || 'No se pudo guardar el activo.';
            errorEl.classList.remove('hidden');
        }
    },

    startEdit(id) {
        const asset = (state.quick.assets || []).find((a) => a.id === id);
        if (!asset) return;
        this.editingId = id;
        document.getElementById('asset-nombre').value = asset.nombre;
        document.getElementById('asset-valor').value = asset.valorEstimado;
        document.getElementById('asset-categoria').value = asset.categoria || '';
        document.getElementById('asset-ubicacion').value = asset.ubicacion || '';
        document.getElementById('asset-notas').value = asset.notas || '';
        document.getElementById('asset-form-title').textContent = 'Editar Activo';
        document.getElementById('asset-form-submit-btn').textContent = 'Guardar Cambios';
        document.getElementById('asset-form-cancel-btn').classList.remove('hidden');
        document.getElementById('asset-nombre').scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    cancelEdit() {
        this.editingId = null;
        document.getElementById('asset-form').reset();
        document.getElementById('asset-form-error').classList.add('hidden');
        document.getElementById('asset-form-title').textContent = 'Agregar Activo';
        document.getElementById('asset-form-submit-btn').textContent = 'Agregar Activo';
        document.getElementById('asset-form-cancel-btn').classList.add('hidden');
    },

    remove(id) {
        const asset = (state.quick.assets || []).find((a) => a.id === id);
        if (!asset) return;
        Modal.confirm(
            `¿Eliminar el activo <strong>${sanitizeHTML(asset.nombre)}</strong> del catálogo? Esto no afecta a los riesgos que ya lo usaron.`,
            async () => {
                try {
                    await App.Api.request(`/api/assets/${id}`, { method: 'DELETE' });
                    showToast('Activo eliminado.');
                    await this.load();
                } catch (e) {
                    showToast(e.userMessage || 'No se pudo eliminar el activo.');
                }
            },
            'Eliminar Activo',
        );
    },

    // Selector reutilizable (ver applyAssetToFair y el botón de #fair-asset).
    openPicker(onSelect) {
        const assets = state.quick.assets || [];
        if (assets.length === 0) {
            showToast('Aún no hay activos en el catálogo. Agrega uno primero en "Catálogo de Activos".');
            return;
        }
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);

        Modal.title.textContent = 'Catálogo de Activos';
        Modal.body.innerHTML = `
            <div class="input-group">
                <label for="assetpick-select">Activo:</label>
                <select id="assetpick-select" class="form-select"></select>
            </div>
            <div id="assetpick-info" class="p-3 bg-gray-50 border rounded-md text-sm text-gray-700 mt-2"></div>
        `;
        Modal.footer.innerHTML = `
            <button id="assetpick-cancel-btn" class="btn btn-secondary">Cancelar</button>
            <button id="assetpick-use-btn" class="btn btn-primary">Usar este activo</button>
        `;
        Modal.modal.classList.remove('hidden');

        const select = document.getElementById('assetpick-select');
        const infoEl = document.getElementById('assetpick-info');
        assets.forEach((a) => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.nombre} — ${fmt(a.valorEstimado)}`;
            select.appendChild(opt);
        });
        const currentAsset = () => assets.find((a) => a.id === select.value);
        const updateInfo = () => {
            const a = currentAsset();
            if (!a) {
                infoEl.innerHTML = '';
                return;
            }
            infoEl.innerHTML = `<p><strong>Valor Estimado: ${fmt(a.valorEstimado)}</strong></p>${a.categoria ? `<p class="mt-1">Categoría: ${sanitizeHTML(a.categoria)}</p>` : ''}${a.ubicacion ? `<p>Ubicación: ${sanitizeHTML(a.ubicacion)}</p>` : ''}`;
        };
        select.addEventListener('change', updateInfo);
        updateInfo();

        document.getElementById('assetpick-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('assetpick-use-btn').addEventListener('click', () => {
            const a = currentAsset();
            if (!a) return;
            onSelect(a);
            Modal.hide();
        });
    },

    // Al elegir un activo, se sugiere (no se fuerza) su valor registrado como el "Modo" de
    // Costos de Reemplazo — la categoría de Magnitud de Pérdida de FAIR (Paso 3) más cercana
    // al valor de un activo físico. El usuario sigue pudiendo ajustarlo o repartirlo en otras
    // categorías si el impacto real no es 100% costo de reemplazo. Antes esto prellenaba el
    // Costo Mín/Máx de Vista Rápida (un solo número sin categorizar, ya eliminada) — el
    // desglose de 9 categorías de FAIR es el reemplazo correcto, no una versión reducida.
    applyAssetToFair(asset) {
        state.quick.selectedAssetRef = { id: asset.id };
        const assetInput = document.getElementById('fair-asset');
        assetInput.value = asset.nombre;
        assetInput.dispatchEvent(new Event('input'));
        const reemplazoInput = document.getElementById('lm-reemplazo-mode');
        reemplazoInput.value = asset.valorEstimado;
        reemplazoInput.dispatchEvent(new Event('change'));
        const fmtAsset = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(asset.valorEstimado);
        showToast(
            `Activo cargado — "Costos de Reemplazo" (Paso 3, Magnitud de Pérdida) se prellenó con su valor registrado (${fmtAsset}). Ajústalo si tu impacto real no es 100% costo de reemplazo.`,
        );
    },
};

App.AssetCatalog = AssetCatalog;
