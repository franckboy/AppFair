import { App } from './app-namespace.js';

export const Navigation = {
    init() {
        document.getElementById('nav-fair').addEventListener('click', () => this.switchPage('fair'));
        document.getElementById('nav-dashboard').addEventListener('click', () => {
            this.switchPage('dashboard');
            App.FairAnalysis.loadRiskRegister();
            // La tabla "Riesgos Guardados" vive ahora aquí (es el selector del detalle por riesgo),
            // así que refrescarla es responsabilidad de esta página, no de la del wizard.
            App.QuickAnalysis.loadHistory();
        });
        document.getElementById('nav-treatment').addEventListener('click', () => {
            this.switchPage('treatment');
            App.Treatment.load();
        });
        document.getElementById('nav-risk-mgmt').addEventListener('click', () => {
            this.switchPage('riskmgmt');
            App.RiskManagement.load();
        });
        document.getElementById('nav-risk-tree').addEventListener('click', () => {
            this.switchPage('tree');
            App.RiskCascadeTree.load();
        });
        // El Catálogo de Activos ahora se abre desde el menú "Configuración" (ver
        // App.ConfigMenu) — el cambio de página en sí sigue siendo switchPage('assets').
    },
    switchPage(pageKey) {
        const pages = {
            fair: document.getElementById('fairAnalysisPage'),
            dashboard: document.getElementById('dashboardPage'),
            treatment: document.getElementById('treatmentPage'),
            riskmgmt: document.getElementById('riskMgmtPage'),
            assets: document.getElementById('assetsPage'),
            tree: document.getElementById('riskTreePage'),
        };
        // "assets" resalta el botón "Configuración" (ya no tiene su propio botón de nav) —
        // así el usuario ve de dónde vino aunque haya entrado por un menú.
        const navs = {
            fair: document.getElementById('nav-fair'),
            dashboard: document.getElementById('nav-dashboard'),
            treatment: document.getElementById('nav-treatment'),
            riskmgmt: document.getElementById('nav-risk-mgmt'),
            assets: document.getElementById('nav-config'),
            tree: document.getElementById('nav-risk-tree'),
        };
        Object.keys(pages).forEach((key) => {
            pages[key].classList.toggle('hidden', key !== pageKey);
            navs[key].classList.toggle('active', key === pageKey);
        });
    },
};

App.Navigation = Navigation;
