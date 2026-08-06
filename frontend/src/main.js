// --- MAIN APPLICATION LOGIC ---
import { App } from './modules/app-namespace.js';
// Imports por efecto secundario: cada uno se auto-registra en App.X al importarse (ver
// app-namespace.js). main.js ya no usa state/Modal/utils directamente (todo lo que los
// necesitaba se movió a su propio módulo) — solo arma App.init()/continueInit(), que llaman
// this.X.metodo() sobre lo que estos imports dejan registrado.
import './modules/api.js';
import './modules/navigation.js';
import './modules/criteria.js';
import './modules/autocomplete.js';
import './modules/risk-catalog.js';
import './modules/asset-catalog.js';
import './modules/risk-cascade-tree.js';
import './modules/treatment.js';
import './modules/ui-mode.js';
import './modules/org-defaults.js';
import './modules/org-context.js';
import './modules/config-menu.js';
import './modules/fair-export.js';
import './modules/fair-register.js';
import './modules/fair-wizard.js';
import './modules/quick-analysis.js';
import './modules/fair-analysis.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Main Application Manager ---
    Object.assign(App, {
        async init() {
            this.Api.initConnectionUI();
            const booted = await this.Api.bootstrap();
            if (!booted) return; // Api.bootstrap ya mostró la pantalla de error (boot-gate)

            if (!this.OrgContext.isComplete()) {
                // RIMS RA.1-2015 (5.2): entender la organización es un paso previo obligatorio,
                // no una configuración opcional más — bloquea el resto de la inicialización
                // hasta que se complete una vez (ver #orgcontext-gate).
                this.OrgContext.showGate(() => this.continueInit());
                return;
            }
            this.continueInit();
        },

        continueInit() {
            this.UIMode.init();
            this.Criteria.init();
            this.OrgDefaults.init();
            this.ConfigMenu.init();
            this.Autocomplete.init();
            this.Navigation.init();
            this.QuickAnalysis.init();
            this.RiskCatalog.init();
            this.AssetCatalog.init();
            this.RiskCascadeTree.init();
            this.Treatment.init();
            this.FairAnalysis.init();
            // Página de entrada por defecto — necesario porque OrgContext.showGate() oculta
            // #fairAnalysisPage mientras el gate está abierto (ver App.OrgContext.showGate) y
            // nada más la vuelve a mostrar; sin esto la app queda en blanco hasta que el
            // usuario haga clic en un botón del nav.
            this.Navigation.switchPage('fair');
            this.UIMode.applyLabels(); // vuelve a aplicar por si algún módulo restauró estado que afecta las etiquetas
        },
    });

    // Start the application
    App.init();
});
