import { App } from './app-namespace.js';
import { state } from './state.js';
import { showToast } from './utils.js';

// --- Historial de riesgos (/api/risks) ---
// La "Vista Rápida" (estimado instantáneo de un solo punto: ARO/Vulnerabilidad/Impacto →
// Riesgo Inherente/Residual/ALE, con su propio Mapa de Riesgo) se eliminó por completo —
// duplicaba, con menos rigor, lo que FAIR ya calcula: el mismo descuento "capacidad del
// atacante menos tu defensa" que da Vulnerabilidad en FAIR (ver
// backend/src/lib/autocalc.js:calculateVulnerability), y un desglose de Magnitud de Pérdida
// en 9 categorías (Paso 3 de FAIR) en vez de un solo Costo Mín/Máx sin categorizar. Este
// módulo solo conserva lo que sigue siendo necesario: la lista de riesgos que ya existen en
// /api/risks (creados antes de este cambio, o vía la API directamente) — para que sigan
// siendo visibles en la tabla concentrada y se puedan cargar en FAIR, en vez de quedar
// huérfanos o inaccesibles.
export const QuickAnalysis = {
    init() {
        this.loadHistory();
    },

    async loadHistory() {
        try {
            const res = await App.Api.request('/api/risks');
            state.quick.history = res.risks;
        } catch (e) {
            showToast(e.userMessage || 'No se pudo cargar el historial de riesgos.');
        }
        // La tabla en sí vive en App.FairRegister (ver #quick-concentrated-table-body),
        // para que Análisis de Riesgo y Registro de Riesgos siempre muestren exactamente lo
        // mismo en vez de dos versiones distintas de la misma información.
        await App.FairRegister.loadRiskRegister();
    },
};

App.QuickAnalysis = QuickAnalysis;
