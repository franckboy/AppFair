import { App } from './app-namespace.js';

export const Navigation = {
    init() {
        document.getElementById('nav-fair').addEventListener('click', () => {
            this.switchPage('fair');
            // La tabla concentrada (dentro de esta misma página, ver #quick-concentrated-table-body)
            // es la misma que la de Registro de Riesgos (App.FairRegister.renderConcentratedTable)
            // — sin esto, un riesgo analizado/simulado mientras se estaba en otra página no se
            // reflejaba aquí (etapa/CVaR/Evaluación) hasta guardar/borrar algo de nuevo.
            App.QuickAnalysis.loadHistory();
        });
        document.getElementById('nav-register').addEventListener('click', () => {
            this.switchPage('register');
            App.FairAnalysis.loadRiskRegister();
        });
        // El Catálogo de Activos ahora se abre desde el menú "Configuración" (ver
        // App.ConfigMenu) — el cambio de página en sí sigue siendo switchPage('assets').
    },
    switchPage(pageKey) {
        const pages = { fair: document.getElementById('fairAnalysisPage'), register: document.getElementById('registerPage'), assets: document.getElementById('assetsPage') };
        // "assets" resalta el botón "Configuración" (ya no tiene su propio botón de nav) —
        // así el usuario ve de dónde vino aunque haya entrado por un menú.
        const navs = { fair: document.getElementById('nav-fair'), register: document.getElementById('nav-register'), assets: document.getElementById('nav-config') };
        Object.keys(pages).forEach(key => {
            pages[key].classList.toggle('hidden', key !== pageKey);
            navs[key].classList.toggle('active', key === pageKey);
        });
    }
};

App.Navigation = Navigation;
