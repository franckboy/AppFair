import { App } from './app-namespace.js';
import { state } from './state.js';
import { formatCurrency, severityToClasses } from './utils.js';

// ============================================================
// App.RiskSummaryBar — mosaico persistente entre el header y el contenido de cada página
// (ver #risk-summary-bar en app_fair.html): Riesgo Actual y Residual del PORTAFOLIO completo
// + el riesgo que se está analizando ahora mismo en el wizard de FAIR. Vive fuera de
// #fair-wizard-wrapper a propósito, para no desaparecer al navegar a otras páginas.
// ============================================================
export const RiskSummaryBar = {
    init() {
        document.getElementById('risk-summary-actual').addEventListener('click', () => {
            App.Navigation.switchPage('riskmgmt');
            App.RiskManagement.load();
        });
        document.getElementById('risk-summary-residual').addEventListener('click', () => {
            App.Navigation.switchPage('riskmgmt');
            App.RiskManagement.load();
        });
        document.getElementById('risk-summary-current').addEventListener('click', () => {
            App.Navigation.switchPage('fair');
            App.FairWizard.navigateWizard(4, true);
        });
    },

    // Se llama después de cada carga del Registro (App.FairRegister.loadRiskRegister, sin
    // importar su propio parámetro render — esta barra no depende de los <canvas> de Chart.js
    // de la página Registro) y después de cada cambio al riesgo en curso en el wizard
    // (displaySimulationResults/resetForm/restauración de borrador).
    render() {
        const bar = document.getElementById('risk-summary-bar');
        if (!bar) return;

        const inherent = state.fair.registerInherentPortfolio;
        const residual = state.fair.registerResidualPortfolio;
        const hasActual = !!(inherent && inherent.inherentRiskCount > 0);
        const hasResidual = !!(residual && residual.totalRiskCount > 0);

        const riskNameEl = document.getElementById('fair-riskName');
        const riskName = riskNameEl ? riskNameEl.value.trim() : '';
        const hasCurrent = !!(riskName && state.fair.lastEvaluation);

        const actualEl = document.getElementById('risk-summary-actual');
        if (hasActual) {
            // La evaluación del backend mira promedio Y cola (ver actualEvaluation en
            // GET /api/register). Antes esta tarjeta la calculaba con classifyAleAgainstCriteria,
            // que solo mira el promedio — así que quedaba ciega al "Crítico por cola de riesgo" y
            // podía contradecir a las otras dos tarjetas de al lado, que sí usan la del backend.
            // La copia local queda como respaldo para respuestas de un backend anterior.
            const severity = inherent.actualEvaluation
                ? inherent.actualEvaluation.severity
                : App.FairRegister.classifyAleAgainstCriteria(inherent.totalActualALE);
            actualEl.className = `p-3 rounded-lg border-l-4 shadow-sm cursor-pointer ${severityToClasses(severity)}`;
            document.getElementById('risk-summary-actual-value').textContent = formatCurrency(inherent.totalActualALE);
            document.getElementById('risk-summary-actual-detail').textContent =
                `${inherent.totalRiskCount} riesgo(s) — Pérdida Anual Esperada`;
        } else {
            actualEl.className =
                'p-3 rounded-lg border-l-4 shadow-sm cursor-pointer bg-gray-50 border-gray-400 text-gray-700';
            document.getElementById('risk-summary-actual-value').textContent = '—';
            document.getElementById('risk-summary-actual-detail').textContent = 'Sin riesgos analizados todavía';
        }

        const residualEl = document.getElementById('risk-summary-residual');
        if (hasResidual) {
            const severity = residual.evaluation ? residual.evaluation.severity : null;
            residualEl.className = `p-3 rounded-lg border-l-4 shadow-sm cursor-pointer ${severityToClasses(severity)}`;
            document.getElementById('risk-summary-residual-value').textContent = formatCurrency(
                residual.totalResidualALE,
            );
            document.getElementById('risk-summary-residual-detail').textContent =
                `${residual.treatedCount} de ${residual.totalRiskCount} con tratamiento adoptado`;
        } else {
            residualEl.className =
                'p-3 rounded-lg border-l-4 shadow-sm cursor-pointer bg-gray-50 border-gray-400 text-gray-700';
            document.getElementById('risk-summary-residual-value').textContent = '—';
            document.getElementById('risk-summary-residual-detail').textContent = 'Sin riesgos analizados todavía';
        }

        const currentEl = document.getElementById('risk-summary-current');
        currentEl.classList.toggle('hidden', !hasCurrent);
        if (hasCurrent) {
            currentEl.className = `p-3 rounded-lg border-l-4 shadow-sm cursor-pointer ${severityToClasses(state.fair.lastEvaluation.severity)}`;
            document.getElementById('risk-summary-current-value').textContent = formatCurrency(state.fair.simulatedALE);
            document.getElementById('risk-summary-current-detail').textContent = riskName;
        }

        bar.classList.toggle('hidden', !hasActual && !hasResidual && !hasCurrent);
    },
};

App.RiskSummaryBar = RiskSummaryBar;
