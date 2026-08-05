import { App } from './app-namespace.js';
import { Modal } from './modal.js';

// --- Menú "Configuración" ---
// Agrupa Contexto Organizacional, Criterios de Riesgo, Valores por Defecto y Catálogo de
// Activos — las 4 pantallas que se configuran una vez y rara vez se vuelven a tocar, para no
// competir visualmente en el nav con las páginas de trabajo diario. Contexto Organizacional
// SÍ vive aquí (a diferencia de un diseño anterior de esta misma sesión, que le daba su
// propio botón permanente en el nav) — el gate obligatorio de primer uso (#orgcontext-gate,
// ver App.OrgContext) no depende de ningún botón, así que separarlo del resto de
// "Configuración" solo agregaba un botón permanente para algo que, pasada la primera vez,
// casi nunca se vuelve a abrir.
export const ConfigMenu = {
    init() {
        document.getElementById('nav-config').addEventListener('click', () => this.open());
    },
    open() {
        Modal.menu('Configuración', [
            { label: 'Contexto Organizacional', icon: 'fa-building', onClick: () => App.OrgContext.openEditor() },
            { label: 'Criterios de Riesgo', icon: 'fa-sliders-h', onClick: () => App.Criteria.openEditor() },
            { label: 'Valores por Defecto', icon: 'fa-user-cog', onClick: () => App.OrgDefaults.openEditor() },
            {
                label: 'Catálogo de Activos', icon: 'fa-boxes', onClick: () => {
                    App.Navigation.switchPage('assets');
                    App.AssetCatalog.load();
                },
            },
        ]);
    }
};

App.ConfigMenu = ConfigMenu;
