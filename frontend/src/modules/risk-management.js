import { App } from './app-namespace.js';
import { state } from './state.js';
import { debounce, formatCurrency, sanitizeHTML, severityToClasses, shortMetricLabel, showToast } from './utils.js';
import { STRATEGY_LABELS } from './treatment.js';

// ============================================================
// App.RiskManagement — Gobernanza/Revisión y Plan de Seguridad de cualquier riesgo ya guardado,
// en su propia página. Antes vivían dentro del Paso 4 del wizard, atado a que acabaras de correr
// una simulación — se sacaron de ahí porque son datos que se actualizan durante toda la vida del
// riesgo (reasignar dueño, mover la fecha de revisión, ajustar medidas de seguridad), no algo que
// solo se define una vez al simular. A diferencia de App.Treatment, aplica a Amenazas y
// Oportunidades por igual — el selector no excluye ningún tipo.
//
// "Calidad de la Información" (fair-data-source/fair-data-confidence/fair-data-notes) se queda en
// el wizard: fair-data-confidence es un insumo real del cálculo (alimenta en vivo el autocálculo
// de Vulnerabilidad y Magnitud de Pérdida, ver App.FairWizard._applyLossMagnitudeAuto), así que no
// se puede diferir a una página aparte sin romper eso.
// ============================================================

// Misma sugerencia de fecha de revisión que antes vivía en App.FairWizard.suggestReviewDate,
// justo después de simular — aquí corre al elegir un riesgo cuyo reviewDate sigue vacío, usando
// evaluationLevel ya guardado en el Registro (ISO 31000, cláusula 6.6: un riesgo Crítico se
// revisa pronto, uno Aceptable puede esperar un año).
function suggestedReviewDate(evaluationLevel) {
    const level = evaluationLevel || '';
    let months = 12;
    if (level.includes('Crítico')) {
        months = 3;
    } else if (level.includes('Requiere Tratamiento') || level.includes('Oportunidad Significativa')) {
        months = 6;
    } else if (level.includes('Medio')) {
        // Nivel Medio (ver evaluateFairThreat, backend/src/lib/evaluation.js) — a mitad de
        // camino entre Alto (6 meses) y Aceptable (12 meses), ni tan urgente como el primero
        // ni tan tranquilo como el segundo.
        months = 9;
    }
    const suggested = new Date();
    suggested.setMonth(suggested.getMonth() + months);
    return suggested.toISOString().split('T')[0];
}

export const RiskManagement = {
    // Guardados pendientes de disparar (debounce) — selectRisk() los vacía ANTES de cambiar de
    // riesgo (ver _flushPendingSaves), para no perder una edición en curso silenciosamente.
    _pendingSaves: [],

    init() {
        this._pendingSaves = [];
        document
            .getElementById('riskmgmt-risk-select')
            .addEventListener('change', (e) => this.selectRisk(e.target.value));

        const debouncedSave = debounce(() => this.persist(), 500);
        this._pendingSaves.push(debouncedSave);
        ['fair-owner', 'fair-review-date', 'fair-assessor', 'fair-assessment-date', 'fair-assessment-location'].forEach(
            (id) => {
                document.getElementById(id).addEventListener('input', debouncedSave);
                document.getElementById(id).addEventListener('change', debouncedSave);
            },
        );
        const debouncedSecurityPlan = debounce(() => this.persist(), 600);
        this._pendingSaves.push(debouncedSecurityPlan);
        document.getElementById('fair-security-plan').addEventListener('input', debouncedSecurityPlan);

        document.getElementById('riskmgmt-goto-treatment-btn').addEventListener('click', () => {
            const entry = state.riskManagement.currentEntry;
            if (!entry) return;
            App.Navigation.switchPage('treatment');
            App.Treatment.load(entry.riskName);
        });
    },

    _flushPendingSaves() {
        this._pendingSaves.forEach((debounced) => debounced.flush());
    },

    // riskNameToSelect: para llegar aquí con un riesgo específico ya elegido (ver "Gestionar este
    // riesgo" en el wizard) — si no está entre los riesgos disponibles (ej. ya no existe), cae al
    // primero de la lista.
    async load(riskNameToSelect = null) {
        await App.FairRegister.loadRiskRegister(false);
        this.populateRiskSelect(riskNameToSelect);
    },

    populateRiskSelect(riskNameToSelect = null) {
        const select = document.getElementById('riskmgmt-risk-select');
        const empty = document.getElementById('riskmgmt-empty');
        const content = document.getElementById('riskmgmt-content');
        const risks = state.fair.riskRegister || [];

        if (risks.length === 0) {
            empty.classList.remove('hidden');
            content.classList.add('hidden');
            select.innerHTML = '';
            state.riskManagement.currentEntry = null;
            return;
        }
        empty.classList.add('hidden');
        content.classList.remove('hidden');

        this.renderResidualPortfolio();
        this.renderResidualPareto();

        const currentValue = riskNameToSelect || select.value;
        select.innerHTML = risks
            .map((r) => `<option value="${sanitizeOption(r.riskName)}">${sanitizeOption(r.riskName)}</option>`)
            .join('');
        const toSelect = risks.some((r) => r.riskName === currentValue) ? currentValue : risks[0].riskName;
        select.value = toSelect;
        this.selectRisk(toSelect);
    },

    // Riesgo Residual del PORTAFOLIO — a diferencia de renderResidualStatus (un riesgo a la vez),
    // esto agrega el residual vigente de TODOS los riesgos tipo Amenaza del Registro. Ya viene
    // calculado del lado del servidor (ver GET /api/register, App.FairRegister.loadRiskRegister)
    // — no depende de qué riesgo esté elegido abajo, así que se llama una sola vez aquí, no desde
    // selectRisk(). Sin llamada de red propia.
    // El CVaR95/p90 de arriba son la SUMA de los individuales. El ALE sí se puede sumar (la
    // esperanza es lineal), pero un percentil no: p90(X+Y) != p90(X) + p90(Y). Como CVaR es una
    // medida coherente y por tanto subaditiva, sumarlos SOBRESTIMA la cola salvo que todos los
    // riesgos se materialicen el mismo año.
    //
    // Esta línea trae el valor REAL, simulando el portafolio completo a la vez (ver
    // lib/portfolioSimulation.js en el backend). Se muestra JUNTO a la suma, no en su lugar: el
    // usuario debe poder ver de cuánto era la diferencia, no encontrarse el número cambiado sin
    // explicación.
    //
    // Guardián de condición de carrera, mismo patrón que residualRequestId: la simulación es cara
    // (10.000 iteraciones por riesgo) y una respuesta vieja no debe pisar a una nueva.
    async renderPortfolioMonteCarlo() {
        const el = document.getElementById('riskmgmt-portfolio-mc');
        if (!el) return;
        const requestId = ++this._portfolioMcRequestId;
        el.classList.add('hidden');

        let data;
        try {
            data = await App.Api.request('/api/register/portfolio-simulation');
        } catch {
            return; // silencioso: es información complementaria, no debe romper la página
        }
        if (requestId !== this._portfolioMcRequestId || !data || !data.summary) return;

        const ahorro = data.diversificationBenefit;
        const pct = data.sumOfIndividualCVaR > 0 ? (100 * ahorro) / data.sumOfIndividualCVaR : 0;
        const nota =
            data.includedCount > 1 && ahorro > 0
                ? ` — ${formatCurrency(ahorro)} menos que la suma (${pct.toFixed(0)}%), porque no todos los riesgos ocurren el mismo año.`
                : '.';
        // Si hay dependencias declaradas en el Árbol de Cascada, la simulación ya las usó: los
        // riesgos encadenados caen juntos y eso engorda la cola. Decirlo explícitamente, porque
        // cambia cómo se lee el número de arriba.
        const cascada =
            data.cascadeEdgeCount > 0
                ? ` <span class="text-gray-600">Incluye ${data.cascadeEdgeCount} ${data.cascadeEdgeCount === 1 ? 'dependencia declarada' : 'dependencias declaradas'} en el Árbol de Cascada: esos riesgos caen juntos, y por eso diversifican menos.</span>`
                : '';
        // Modo Simple prohíbe los acrónimos (ver simple-mode-no-jargon.spec.js): se dice lo mismo
        // en palabras. Los dos textos describen exactamente las mismas dos cifras.
        const simple = App.UIMode.mode === 'simple';
        const cifras = simple
            ? `en el 5% de años peores se perderían <strong>${formatCurrency(data.summary.cvar95)}</strong> en promedio, ` +
              `y 1 de cada 10 años pasaría de <strong>${formatCurrency(data.summary.p90)}</strong>`
            : `CVaR95 <strong>${formatCurrency(data.summary.cvar95)}</strong>, p90 <strong>${formatCurrency(data.summary.p90)}</strong>`;
        el.innerHTML =
            `<strong>Simulando el portafolio completo a la vez</strong> (${data.includedCount} amenazas): ` +
            `${cifras}${nota}${cascada}` +
            (data.skippedCount > 0
                ? ` <span class="text-gray-500">(${data.skippedCount} sin datos suficientes para simular)</span>`
                : '');
        el.classList.remove('hidden');
    },

    _portfolioMcRequestId: 0,

    renderResidualPortfolio() {
        const section = document.getElementById('riskmgmt-portfolio-section');
        const portfolio = state.fair.registerResidualPortfolio;

        if (!portfolio || portfolio.totalRiskCount === 0) {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');

        document.getElementById('riskmgmt-portfolio-ale').textContent = formatCurrency(portfolio.totalResidualALE);
        document.getElementById('riskmgmt-portfolio-cvar').textContent = formatCurrency(portfolio.totalResidualCVaR);

        document.getElementById('riskmgmt-portfolio-detail').textContent =
            `${portfolio.treatedCount} de ${portfolio.totalRiskCount} amenazas con tratamiento adoptado`;

        this.renderPortfolioMonteCarlo();

        // Waterfall Inherente (sin controles) → Actual (con controles vigentes) → Residual
        // (después de Tratamiento) — las 3 etapas, en dólares. inherentPortfolio ya trae también
        // el total Actual (autocontenido, ver calculateInherentPortfolio en el backend) para no
        // depender de que también se haya cargado el Pareto de Registro de Riesgos.
        const inherent = state.fair.registerInherentPortfolio;
        const waterfallEl = document.getElementById('riskmgmt-portfolio-waterfall');
        const effectivenessEl = document.getElementById('riskmgmt-portfolio-effectiveness');
        const inherentNote = document.getElementById('riskmgmt-portfolio-inherent-note');
        if (inherent && inherent.inherentRiskCount > 0) {
            const inherentLevel = inherent.evaluation ? ` (${inherent.evaluation.level})` : '';
            const residualLevel = portfolio.evaluation ? ` (${portfolio.evaluation.level})` : '';
            // El Actual que se compara contra el Inherente es SIEMPRE comparableActualALE (la
            // misma canasta de riesgos que sí tienen Inherente calculado), nunca totalActualALE
            // (todas las amenazas) — ver el comentario de calculateInherentPortfolio en el
            // backend: mezclarlos daba efectividades negativas y un Inherente menor que el Actual.
            // Con cobertura completa ambos valen lo mismo, así que el caso limpio no cambia.
            const incompleto = inherent.inherentMissingCount > 0;
            const comparableActual = inherent.comparableActualALE;
            // La etapa Residual cubre TODAS las amenazas, así que solo se suma al waterfall
            // cuando el Inherente también las cubre — si no, serían tres cifras sobre canastas
            // distintas puestas en fila como si fueran la misma historia.
            waterfallEl.textContent = incompleto
                ? `Riesgo Inherente: ${formatCurrency(inherent.totalInherentALE)}${inherentLevel} → ` +
                  `Riesgo Actual: ${formatCurrency(comparableActual)} ` +
                  `(comparación sobre las ${inherent.inherentRiskCount} de ${inherent.totalRiskCount} amenazas que ya tienen Riesgo Inherente calculado)`
                : `Riesgo Inherente: ${formatCurrency(inherent.totalInherentALE)}${inherentLevel} → ` +
                  `Riesgo Actual: ${formatCurrency(comparableActual)} → ` +
                  `Riesgo Residual: ${formatCurrency(portfolio.totalResidualALE)}${residualLevel}`;
            waterfallEl.classList.remove('hidden');

            if (inherent.totalInherentALE > 0 && typeof comparableActual === 'number') {
                const effectiveness =
                    ((inherent.totalInherentALE - comparableActual) / inherent.totalInherentALE) * 100;
                effectivenessEl.textContent = `Efectividad de Controles: ${effectiveness.toFixed(1)}%`;
                effectivenessEl.classList.remove('hidden');
            } else {
                effectivenessEl.classList.add('hidden');
            }

            if (incompleto) {
                inherentNote.textContent = `Riesgo Inherente calculado para ${inherent.inherentRiskCount} de ${inherent.totalRiskCount} amenazas — el resto se estima la próxima vez que se vuelvan a simular.`;
                inherentNote.classList.remove('hidden');
            } else {
                inherentNote.classList.add('hidden');
            }
        } else {
            waterfallEl.classList.add('hidden');
            effectivenessEl.classList.add('hidden');
            inherentNote.classList.add('hidden');
        }

        const cvarNote = document.getElementById('riskmgmt-portfolio-cvar-note');
        if (portfolio.cvarSkippedCount > 0) {
            const cvarShort = shortMetricLabel('cvar95', 'CVaR95');
            cvarNote.textContent = `Suma de ${cvarShort} de ${portfolio.cvarRiskCount} de ${portfolio.totalRiskCount} amenazas — ${portfolio.cvarSkippedCount} sin ${cvarShort} residual conocido (ej. Transferir).`;
            cvarNote.classList.remove('hidden');
        } else {
            cvarNote.classList.add('hidden');
        }

        if (portfolio.evaluation) {
            section.className = `p-4 rounded-lg mb-4 border-l-4 ${severityToClasses(portfolio.evaluation.severity)}`;
            document.getElementById('riskmgmt-portfolio-badge').textContent = portfolio.evaluation.level;
        } else {
            section.className = 'p-4 rounded-lg mb-4 border-l-4 bg-gray-50 border-gray-400 text-gray-700';
            document.getElementById('riskmgmt-portfolio-badge').textContent = 'Clasificación no disponible';
        }
    },

    // Concentración del Riesgo RESIDUAL (Pareto) — a diferencia del Pareto de Registro de
    // Riesgos (App.FairRegister.renderParetoChart, sobre el ALE ACTUAL — con el Nivel de Defensa
    // vigente, NO el Riesgo Inherente sin controles), este ordena por el
    // ALE residual vigente de cada Amenaza (ver calculateResidualParetoAnalysis, backend). Mismo
    // criterio que renderResidualPortfolio: ya viene calculado del lado del servidor, se llama
    // una sola vez aquí (no depende de qué riesgo esté elegido abajo), sin llamada de red propia.
    // Se muestra como tabla (no un gráfico Chart.js como el de Registro) — proporcional al resto
    // de esta página, que hasta ahora no usa gráficos.
    renderResidualPareto() {
        const section = document.getElementById('riskmgmt-residual-pareto-section');
        const pareto = state.fair.registerResidualPareto;

        if (!pareto || pareto.totalRiskCount === 0) {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');

        document.getElementById('riskmgmt-residual-pareto-summary').textContent =
            `${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount} riesgo(s) concentran el 80% de tu exposición residual (${formatCurrency(pareto.totalExposure)}/año).`;

        // Solo hasta el corte del 80% (riskCountFor80Percent) — son los que de verdad importa
        // priorizar; listar el resto no aporta a la pregunta que responde este Pareto.
        const topRisks = pareto.risks.slice(0, pareto.riskCountFor80Percent);
        document.getElementById('riskmgmt-residual-pareto-tbody').innerHTML = topRisks
            .map(
                (r, i) => `
                <tr class="border-b last:border-0">
                    <td class="py-1 pr-2">${i + 1}</td>
                    <td class="py-1 pr-2">${sanitizeHTML(r.riskName)}</td>
                    <td class="py-1 pr-2">${formatCurrency(r.residualALE)}</td>
                    <td class="py-1 pr-2">${r.cumulativePercent.toFixed(1)}%</td>
                    <td class="py-1 pr-2">${r.treated ? '<span class="text-green-700">Tratado</span>' : '<span class="text-amber-700">Sin tratar</span>'}</td>
                </tr>`,
            )
            .join('');
    },

    selectRisk(riskName) {
        const entry = (state.fair.riskRegister || []).find((r) => r.riskName === riskName);
        if (!entry) return;
        // Dispara YA cualquier guardado pendiente del riesgo ANTERIOR (ver _pendingSaves) — antes
        // de este flush, cambiar de riesgo mientras el debounce seguía en vuelo perdía la edición
        // en curso en silencio.
        this._flushPendingSaves();
        state.riskManagement.currentEntry = entry;
        document.getElementById('riskmgmt-risk-select').value = riskName;

        document.getElementById('fair-owner').value = entry.owner && entry.owner !== '—' ? entry.owner : '';
        document.getElementById('fair-review-date').value =
            entry.reviewDate || suggestedReviewDate(entry.evaluationLevel);
        document.getElementById('fair-assessor').value = entry.assessor || '';
        document.getElementById('fair-assessment-date').value = entry.assessmentDate || '';
        document.getElementById('fair-assessment-location').value = entry.assessmentLocation || '';
        document.getElementById('fair-security-plan').value =
            entry.securityPlan && entry.securityPlan !== '—' ? entry.securityPlan : '';

        this.renderResidualStatus(entry);
    },

    // Muestra el Riesgo Residual VIGENTE (paso 2 del rediseño de Tratamiento, ver la
    // conversación) — hasta ahora, Gestión de Riesgos no mostraba ningún número, solo
    // gobernanza. Solo aplica a Amenazas ya analizadas: una Oportunidad no tiene Tratamiento (su
    // "ale" es un beneficio, no una pérdida) y un stub "Sin analizar" (creado desde el árbol con
    // "+") no tiene ninguna clasificación todavía.
    //
    // Sin treatmentDecision: el residual es igual al ACTUAL (con el Nivel de Defensa vigente,
    // entry.ale/cvar95 — NO el Riesgo Inherente sin controles, ver renderResidualPortfolio) — se
    // reutiliza entry.evaluationLevel/severity YA guardados, sin ninguna llamada de red.
    // Con treatmentDecision: se reclasifica el residualALE/residualCVaR contra los Criterios de
    // Riesgo (POST /api/simulate/evaluate, misma lógica que ya clasifica el actual) porque
    // puede caer en una banda distinta — un riesgo Crítico que se trató puede haber bajado a
    // Aceptable, y la cadencia de revisión (suggestedReviewDate) debe reflejar eso, no el
    // actual. requestId sigue el mismo patrón de guardián contra condición de carrera que
    // App.Treatment.updateReduccionALEAuto (ver state.riskManagement.residualRequestId).
    async renderResidualStatus(entry) {
        const section = document.getElementById('riskmgmt-residual-section');
        const gotoTreatmentBtn = document.getElementById('riskmgmt-goto-treatment-btn');

        if (entry.riskType !== 'amenaza' || !entry.evaluationLevel) {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');

        const applyBadge = (severity, label) => {
            section.className = `p-4 rounded-lg mb-4 border-l-4 ${severityToClasses(severity)}`;
            document.getElementById('riskmgmt-residual-badge').textContent = label;
        };

        const decision = entry.treatmentDecision;
        if (!decision) {
            document.getElementById('riskmgmt-residual-note').textContent =
                'Sin tratamiento decidido — el riesgo vigente es igual al actual (con el Nivel de Defensa vigente):';
            document.getElementById('riskmgmt-residual-ale').textContent = formatCurrency(entry.ale);
            document.getElementById('riskmgmt-residual-cvar').textContent = formatCurrency(entry.cvar95);
            applyBadge(entry.severity, entry.evaluationLevel);
            gotoTreatmentBtn.classList.remove('hidden');
            return;
        }

        gotoTreatmentBtn.classList.add('hidden');
        const decidedAt = decision.decidedAt ? new Date(decision.decidedAt).toLocaleDateString('es-MX') : '—';
        document.getElementById('riskmgmt-residual-note').textContent =
            `Con tratamiento (${STRATEGY_LABELS[decision.strategy] || decision.strategy}) — decidido el ${decidedAt}:`;
        document.getElementById('riskmgmt-residual-ale').textContent = formatCurrency(decision.residualALE);
        document.getElementById('riskmgmt-residual-cvar').textContent = formatCurrency(decision.residualCVaR);

        // Sin residualCVaR conocido (ej. Transferir — ver evaluateTreatmentStrategies, fuera de
        // alcance a propósito) no se puede reclasificar de forma honesta: inventar un CVaR (ej.
        // usando el ALE en su lugar) subestimaría sistemáticamente el riesgo de cola real, que
        // casi siempre es mayor al promedio — mismo criterio conservador de toda la app, no
        // afirmar una precisión que no se puede verificar. Se muestra el ALE residual solo, sin
        // badge de clasificación ni cambio en la fecha de revisión sugerida.
        if (typeof decision.residualCVaR !== 'number') {
            section.className = 'p-4 rounded-lg mb-4 border-l-4 bg-gray-50 border-gray-400 text-gray-700';
            document.getElementById('riskmgmt-residual-badge').textContent =
                `Clasificación no disponible (esta estrategia no calcula ${shortMetricLabel('cvar95', 'CVaR residual')})`;
            return;
        }

        document.getElementById('riskmgmt-residual-badge').textContent = 'Calculando…';
        section.className = 'p-4 rounded-lg mb-4 border-l-4 bg-gray-50 border-gray-400 text-gray-700';

        const requestId = ++state.riskManagement.residualRequestId;
        let data;
        try {
            data = await App.Api.request('/api/simulate/evaluate', {
                method: 'POST',
                body: {
                    ale: decision.residualALE,
                    cvar95: decision.residualCVaR,
                    riskCriteriaOverride: entry.riskCriteriaOverride,
                },
            });
        } catch {
            if (requestId !== state.riskManagement.residualRequestId) return; // ver el guardián documentado arriba
            document.getElementById('riskmgmt-residual-badge').textContent = 'No se pudo reclasificar';
            return;
        }
        // Respuesta vieja, ya superada por otra más nueva (ej. el usuario cambió de riesgo
        // mientras esta petición estaba en vuelo) — mismo bug real ya documentado y arreglado
        // para Vulnerabilidad/Magnitud de Pérdida en el wizard y Reducción de ALE en Tratamiento.
        if (requestId !== state.riskManagement.residualRequestId) return;

        applyBadge(data.evaluation.severity, data.evaluation.level);

        // Solo actualiza la fecha sugerida si TODAVÍA está vacía (sin reviewDate ya guardado ni
        // escrito mientras esta petición estaba en vuelo) — nunca pisa una fecha que ya exista.
        const reviewDateInput = document.getElementById('fair-review-date');
        if (!reviewDateInput.value) {
            reviewDateInput.value = suggestedReviewDate(data.evaluation.level);
        }
    },

    // Igual que App.Treatment.persistTreatment: PUT reemplaza la entrada completa (no es un PATCH
    // parcial, ver backend/src/routes/register.js), así que se manda la entrada entera tal cual ya
    // estaba (spread) y solo se pisan estos campos, para no perder el resto de sus datos.
    async persist() {
        const entry = state.riskManagement.currentEntry;
        if (!entry) return;

        const body = {
            ...entry,
            owner: document.getElementById('fair-owner').value.trim() || '—',
            reviewDate: document.getElementById('fair-review-date').value || null,
            assessor: document.getElementById('fair-assessor').value.trim() || null,
            assessmentDate: document.getElementById('fair-assessment-date').value || null,
            assessmentLocation: document.getElementById('fair-assessment-location').value.trim() || null,
            securityPlan: document.getElementById('fair-security-plan').value.trim() || '—',
        };

        let res;
        try {
            res = await App.Api.request(`/api/register/${encodeURIComponent(entry.riskName)}`, {
                method: 'PUT',
                body,
            });
        } catch (e) {
            showToast(e.userMessage || 'No se pudo guardar la gestión de este riesgo.');
            return;
        }
        // Solo pisa currentEntry/el formulario visible si TODAVÍA es este mismo riesgo el que
        // está siendo mostrado — si el usuario ya cambió a otro riesgo mientras este guardado
        // estaba en vuelo (un solo await, pero igual posible), currentEntry no debe volver a
        // apuntar al riesgo anterior.
        if (state.riskManagement.currentEntry && state.riskManagement.currentEntry.id === entry.id) {
            state.riskManagement.currentEntry = res.entry;
        }
        const idx = (state.fair.riskRegister || []).findIndex((r) => r.id === entry.id);
        if (idx !== -1) state.fair.riskRegister[idx] = res.entry;
    },
};

// Nombres de riesgo pueden traer comillas dobles — sanitizeHTML no las escapa (ver
// risk-cascade-tree.js), pero <option value="..."> sí las necesita escapadas para no romper el
// atributo. select.value ya devuelve el string decodificado tal cual al leerlo después.
function sanitizeOption(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

App.RiskManagement = RiskManagement;
