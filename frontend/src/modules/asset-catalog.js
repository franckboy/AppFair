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
            // Se cargan junto con los activos (no solo /api/assets) para poder mostrar, por
            // cada activo, a qué riesgos ya guardados está vinculado (ver linkedRisksFor) —
            // sin esto, el vínculo assetId quedaría guardado pero invisible en esta pantalla.
            const [assetsRes] = await Promise.all([
                App.Api.request('/api/assets'),
                App.FairRegister.loadRiskRegister(false),
                App.QuickAnalysis.loadHistory(),
            ]);
            state.quick.assets = assetsRes.assets;
        } catch (e) {
            showToast(e.userMessage || 'No se pudieron cargar los activos.');
        }
        this.render();
    },

    // Un activo puede estar referenciado por una entrada ya simulada del Registro (assetId,
    // ver App.FairRegister.saveToRiskRegister) o por un borrador de Análisis Rápido/Paso 1
    // todavía sin simular (fullData.assetId, ver saveDraftToRisksList) — se juntan ambas
    // fuentes para no perder el vínculo de un riesgo que aún no llegó a FAIR. Se incluye el
    // Costo de Reemplazo (por evento, ver checkAssetReplacementCostWarning) de cada riesgo del
    // Registro para poder mostrarlo contra el valor declarado del activo — nunca se suman entre
    // sí porque cada uno es un evento independiente, no un daño simultáneo.
    linkedRisksFor(assetId) {
        const fromRegister = (state.fair.riskRegister || [])
            .filter((r) => r.assetId === assetId)
            .map((r) => ({ riskName: r.riskName, reemplazoMax: r.lossMagnitudes?.reemplazo?.max ?? null }));
        const registerNames = fromRegister.map((r) => r.riskName);
        const fromDrafts = (state.quick.history || [])
            .filter((r) => r.fullData && r.fullData.assetId === assetId && !registerNames.includes(r.name))
            .map((r) => ({ riskName: r.name, reemplazoMax: null }));
        return [...fromRegister, ...fromDrafts];
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
            .map((a) => {
                const linkedRisks = this.linkedRisksFor(a.id);
                const linkedCell =
                    linkedRisks.length > 0
                        ? `<button type="button" class="text-blue-600 hover:underline" data-linked-id="${a.id}">${linkedRisks.length} riesgo${linkedRisks.length === 1 ? '' : 's'}</button>`
                        : '<span class="text-gray-400">Ninguno</span>';
                return `
            <tr class="border-b">
                <td class="py-2">${sanitizeHTML(a.nombre)}</td>
                <td>${fmt(a.valorEstimado)}</td>
                <td>${sanitizeHTML(a.categoria || '—')}</td>
                <td>${sanitizeHTML(a.ubicacion || '—')}</td>
                <td>${linkedCell}</td>
                <td class="text-right whitespace-nowrap">
                    <button type="button" class="text-blue-600 hover:underline text-sm mr-3" data-edit-id="${a.id}">Editar</button>
                    <button type="button" class="text-red-600 hover:underline text-sm" data-delete-id="${a.id}">Eliminar</button>
                </td>
            </tr>`;
            })
            .join('');
        tbody
            .querySelectorAll('[data-edit-id]')
            .forEach((btn) => btn.addEventListener('click', () => this.startEdit(btn.dataset.editId)));
        tbody
            .querySelectorAll('[data-delete-id]')
            .forEach((btn) => btn.addEventListener('click', () => this.remove(btn.dataset.deleteId)));
        tbody.querySelectorAll('[data-linked-id]').forEach((btn) =>
            btn.addEventListener('click', () => {
                const asset = assets.find((a) => a.id === btn.dataset.linkedId);
                const risks = this.linkedRisksFor(btn.dataset.linkedId);
                const rows = risks
                    .map(({ riskName, reemplazoMax }) => {
                        let detail = '<span class="text-gray-400">(sin analizar con FAIR aún)</span>';
                        if (typeof reemplazoMax === 'number') {
                            const exceeds = asset && reemplazoMax > asset.valorEstimado;
                            detail = `<span class="${exceeds ? 'text-red-600 font-semibold' : 'text-gray-600'}">Costo de Reemplazo: ${fmt(reemplazoMax)}${exceeds ? ' — supera el valor del activo' : ''}</span>`;
                        }
                        return `<li>${sanitizeHTML(riskName)} — ${detail}</li>`;
                    })
                    .join('');
                Modal.alert(
                    `<ul class="list-disc list-inside space-y-1">${rows}</ul>`,
                    `Riesgos vinculados a "${sanitizeHTML(asset ? asset.nombre : '')}"`,
                );
            }),
        );
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

    // Las 6 categorías RIMS RA.1-2015/ASIS PAP.1 — mismas opciones que #asset-categoria en el
    // formulario completo (ver app_fair.html), repetidas aquí porque el picker arma su propio
    // mini-formulario de alta rápida (ver openPicker) en vez de reusar ese <select> del DOM,
    // que solo existe en la página "Catálogo de Activos".
    ASSET_CATEGORY_OPTIONS: [
        'Personas',
        'Instalaciones y Sitio',
        'Equipo y Maquinaria',
        'Inventario / Mercancía',
        'Información y Procesos',
        'Imagen y Reputación',
    ],

    // Selector reutilizable (ver applyAssetToFair y el botón de #fair-asset) — mismo patrón
    // que App.RiskCatalog.openPicker (un modal con lo necesario para resolver la elección ahí
    // mismo, sin salir del wizard). A diferencia del Catálogo de Riesgos (curado, de solo
    // lectura), este SÍ permite dar de alta un activo nuevo sin salir del modal: antes, si
    // el catálogo estaba vacío, el botón solo mostraba un toast mandando al usuario a la
    // página "Catálogo de Activos" y cortaba el flujo del wizard a la mitad.
    openPicker(onSelect) {
        const assets = state.quick.assets || [];
        const hasAssets = assets.length > 0;
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const categoryOptionsHTML = `<option value="">— Sin clasificar —</option>${this.ASSET_CATEGORY_OPTIONS.map(
            (c) => `<option value="${c}">${c}</option>`,
        ).join('')}`;

        Modal.title.textContent = 'Catálogo de Activos';
        Modal.body.innerHTML = `
            ${
                hasAssets
                    ? `
            <div id="assetpick-existing">
                <div class="input-group">
                    <label for="assetpick-select">Activo:</label>
                    <select id="assetpick-select" class="form-select"></select>
                </div>
                <div id="assetpick-info" class="p-3 bg-gray-50 border rounded-md text-sm text-gray-700 mt-2"></div>
            </div>
            <button type="button" id="assetpick-toggle-new-btn" class="btn btn-secondary text-sm mt-4">+ Registrar un activo nuevo</button>
            `
                    : `<p class="description-text mb-4">Aún no tienes ningún activo registrado — créalo aquí y se aplicará directo a este riesgo.</p>`
            }
            <div id="assetpick-new" class="${hasAssets ? 'hidden' : ''} mt-4">
                <div class="input-group">
                    <label for="assetpick-new-nombre">Nombre:</label>
                    <input type="text" id="assetpick-new-nombre" class="form-input" placeholder="Ej. Bodega de mercancía (Bodega 3)">
                </div>
                <div class="input-group">
                    <label for="assetpick-new-valor">Valor Estimado:</label>
                    <input type="number" id="assetpick-new-valor" class="form-input" min="0" value="0">
                </div>
                <div class="input-group">
                    <label for="assetpick-new-categoria">Categoría (opcional):</label>
                    <select id="assetpick-new-categoria" class="form-select">${categoryOptionsHTML}</select>
                </div>
                <p id="assetpick-new-error" class="text-red-600 text-sm hidden"></p>
            </div>
        `;
        Modal.footer.innerHTML = `
            <button id="assetpick-cancel-btn" class="btn btn-secondary">Cancelar</button>
            ${hasAssets ? `<button id="assetpick-use-btn" class="btn btn-primary">Usar este activo</button>` : ''}
            <button id="assetpick-create-btn" class="btn btn-primary ${hasAssets ? 'hidden' : ''}">Registrar y Usar</button>
        `;
        Modal.modal.classList.remove('hidden');

        if (hasAssets) {
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

            document.getElementById('assetpick-use-btn').addEventListener('click', () => {
                const a = currentAsset();
                if (!a) return;
                onSelect(a);
                Modal.hide();
            });

            document.getElementById('assetpick-toggle-new-btn').addEventListener('click', () => {
                document.getElementById('assetpick-existing').classList.add('hidden');
                document.getElementById('assetpick-toggle-new-btn').classList.add('hidden');
                document.getElementById('assetpick-new').classList.remove('hidden');
                document.getElementById('assetpick-use-btn').classList.add('hidden');
                document.getElementById('assetpick-create-btn').classList.remove('hidden');
            });
        }

        document.getElementById('assetpick-cancel-btn').addEventListener('click', () => Modal.hide());
        document.getElementById('assetpick-create-btn').addEventListener('click', async (e) => {
            const errorEl = document.getElementById('assetpick-new-error');
            errorEl.classList.add('hidden');
            const nombre = document.getElementById('assetpick-new-nombre').value.trim();
            if (!nombre) {
                errorEl.textContent = 'El nombre del activo es obligatorio.';
                errorEl.classList.remove('hidden');
                return;
            }
            const body = {
                nombre,
                valorEstimado: getSafeNumber(document.getElementById('assetpick-new-valor')),
                categoria: document.getElementById('assetpick-new-categoria').value,
            };
            const btn = e.target;
            btn.disabled = true;
            try {
                const res = await App.Api.request('/api/assets', { method: 'POST', body });
                state.quick.assets = [...(state.quick.assets || []), res.entry];
                onSelect(res.entry);
                Modal.hide();
                showToast('Activo registrado y aplicado.');
            } catch (err) {
                errorEl.textContent = err.userMessage || 'No se pudo registrar el activo.';
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
            }
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
