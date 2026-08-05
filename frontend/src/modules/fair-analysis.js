import { App } from './app-namespace.js';

// App.FairAnalysis — fachada delgada: solo orquesta el orden de arranque y
// reexpone (sin lógica propia) los 3 métodos que otros módulos (App.UIMode,
// App.Navigation, App.QuickAnalysis) siguen llamando por este nombre. Toda
// la lógica real vive en FairWizard/FairRegister/FairExport de arriba.
export const FairAnalysis = {
    init() {
        App.FairWizard.populateLossMagnitudeForms();
        App.FairWizard.bindEvents();
        App.FairRegister.loadRiskRegister(false);
        App.FairWizard.applyOrgDefaults();
        App.FairWizard.checkForResumableAnalysis();
    },
    loadRiskRegister(render = true) { return App.FairRegister.loadRiskRegister(render); },
    renderSensitivity(sensitivity) { return App.FairWizard.renderSensitivity(sensitivity); },
    receiveData(data) { return App.FairWizard.receiveData(data); },
};

App.FairAnalysis = FairAnalysis;
