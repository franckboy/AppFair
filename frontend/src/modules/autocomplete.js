import { App } from './app-namespace.js';
import { sanitizeHTML } from './utils.js';

// --- Autocompletado de campos de texto repetidos ---
// Recuerda valores que ya escribiste antes (Activo, Agente de Amenaza, Dueño del Riesgo)
// y los ofrece como sugerencias vía <datalist>, para no tener que retipearlos.
export const Autocomplete = {
    STORAGE_KEY: 'autocompleteHistory',
    MAX_ENTRIES: 25,
    fields: [
        { inputId: 'fair-asset', datalistId: 'datalist-assets', key: 'assets' },
        { inputId: 'fair-threat', datalistId: 'datalist-threats', key: 'threats' },
        { inputId: 'fair-owner', datalistId: 'datalist-owners', key: 'owners' },
    ],
    history: { assets: [], threats: [], owners: [] },

    init() {
        this.load();
        this.fields.forEach(field => {
            this.renderDatalist(field);
            document.getElementById(field.inputId).addEventListener('change', (e) => this.remember(field, e.target.value));
        });
    },

    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) this.history = { ...this.history, ...JSON.parse(raw) };
        } catch (e) {
            console.error('No se pudo cargar el historial de autocompletado:', e);
        }
    },

    remember(field, value) {
        const clean = sanitizeHTML((value || '').trim());
        if (!clean) return;
        const list = this.history[field.key];
        const existingIndex = list.findIndex(v => v.toLowerCase() === clean.toLowerCase());
        if (existingIndex !== -1) list.splice(existingIndex, 1);
        list.unshift(clean);
        if (list.length > this.MAX_ENTRIES) list.length = this.MAX_ENTRIES;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.history));
        } catch (e) {
            console.error('No se pudo guardar el historial de autocompletado:', e);
        }
        this.renderDatalist(field);
    },

    renderDatalist(field) {
        const datalist = document.getElementById(field.datalistId);
        datalist.innerHTML = this.history[field.key].map(v => `<option value="${v}"></option>`).join('');
    }
};

App.Autocomplete = Autocomplete;
