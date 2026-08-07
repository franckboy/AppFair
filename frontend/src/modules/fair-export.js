import { App } from './app-namespace.js';
import { state } from './state.js';
import { Modal } from './modal.js';
import { LOSS_FORMS_KEYS, LOSS_FORM_LABELS, sanitizeHTML, severityToHex } from './utils.js';

// ============================================================
// App.FairExport — arma el HTML imprimible y dispara window.print() para el Informe
// Consolidado (único PDF de la app: portafolio + detalle completo de cada riesgo). Antes
// había dos reportes separados (uno de un solo riesgo, leído del formulario en pantalla, y
// uno consolidado con solo una tarjeta resumida por riesgo) — se fusionaron en uno solo
// porque el Registro ya guarda todo lo necesario (ver App.FairRegister.saveToRiskRegister)
// para reconstruir el detalle completo de CUALQUIER riesgo guardado, no solo el que esté
// abierto en el wizard. Si el bug está en el PDF exportado, está aquí.
// ============================================================
export const FairExport = {
    // Mismos labels que los <select> del Paso 1/2 — se necesitan aquí porque el riesgo del
    // que se arma cada sección del reporte puede NO ser el que está abierto en el wizard
    // (viene del Registro guardado), así que no hay <select> del que leer el texto visible.
    EFFECT_LABELS: {
        material: 'Pérdida o Daño Material',
        personas: 'Impacto a la Integridad de las Personas',
        operativo: 'Interrupción Operativa',
        reputacional: 'Daño Reputacional',
    },
    DATA_SOURCE_LABELS: {
        historico: 'Histórico interno de incidentes',
        benchmark: 'Benchmark / referencia externa del sector',
        'experto-calibrado': 'Juicio experto calibrado (rangos de 3 puntos)',
        'experto-sin-calibrar': 'Juicio experto sin calibrar',
    },
    DATA_CONFIDENCE_LABELS: { alto: 'Alto', medio: 'Medio', bajo: 'Bajo' },
    RELIABILITY_LABELS: { alta: 'Alta', media: 'Media', baja: 'Baja' },

    // Redibuja, fuera de pantalla, el histograma de un riesgo YA guardado (a partir de
    // chartLabels/chartData del Registro — ver saveToRiskRegister) para poder incluirlo en
    // el reporte de CUALQUIER riesgo, no solo el que tiene el <canvas> real visible ahora
    // mismo. animation:false porque toDataURL() se llama en el siguiente frame — con
    // animación encendida capturaría un fotograma a medio dibujar (barras incompletas).
    renderOffscreenHistogram(labels, data) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 700;
            canvas.height = 350;
            canvas.style.position = 'fixed';
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);
            const chart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Frecuencia de Pérdida Anual',
                            data,
                            backgroundColor: 'rgba(54, 162, 235, 0.6)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1,
                        },
                    ],
                },
                options: {
                    responsive: false,
                    animation: false,
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'Nº de Simulaciones' } },
                        x: {
                            title: { display: true, text: 'Pérdida Anual Estimada' },
                            ticks: { autoSkip: true, maxRotation: 45, minRotation: 45 },
                        },
                    },
                },
            });
            requestAnimationFrame(() => {
                const img = canvas.toDataURL('image/png');
                chart.destroy();
                canvas.remove();
                resolve(img);
            });
        });
    },

    // Redibuja, fuera de pantalla, el Mapa de Calor Consolidado (mismo diseño que
    // App.FairRegister.renderRiskRegister: zonas de fondo Bajo/Medio/Alto/Crítico + número por
    // punto) — a propósito NO se lee el <canvas> #fair-register-chart real, porque ese solo se
    // dibuja al visitar "Registro de Riesgos" (ver el comentario en loadRiskRegister sobre
    // canvases de tamaño 0). El botón de exportar vive en "Análisis de Riesgo", así que exportar
    // sin haber visitado Registro antes capturaba ese <canvas> en blanco (300×150, el
    // tamaño por defecto del navegador) — un PNG casi vacío, estirado a max-width:100% en el
    // PDF. Tamaño fijo (responsive:false) por la misma razón que renderOffscreenHistogram: el
    // auto-tamaño de Chart.js depende del contenedor CSS, que aquí no existe.
    renderOffscreenHeatmap(threatRegister, heatmapZones) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 700;
            canvas.height = 400;
            canvas.style.position = 'fixed';
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);

            const textColorByLevel = { Bajo: '#000', Medio: '#000', Alto: '#fff', Crítico: '#fff' };
            const matrixBackgroundPlugin = {
                id: 'fairExportMatrixBackground',
                beforeDatasetsDraw(chart) {
                    const {
                        ctx,
                        scales: { x, y },
                    } = chart;
                    ctx.save();
                    (heatmapZones || []).forEach((zone) => {
                        ctx.fillStyle = zone.color;
                        ctx.fillRect(
                            x.getPixelForValue(zone.x[0]),
                            y.getPixelForValue(zone.y[1]),
                            x.getPixelForValue(zone.x[1]) - x.getPixelForValue(zone.x[0]),
                            y.getPixelForValue(zone.y[0]) - y.getPixelForValue(zone.y[1]),
                        );
                    });
                    ctx.font = 'bold 14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    (heatmapZones || []).forEach((zone) => {
                        const midX = x.getPixelForValue((zone.x[0] + zone.x[1]) / 2);
                        const midY = y.getPixelForValue((zone.y[0] + zone.y[1]) / 2);
                        ctx.fillStyle = textColorByLevel[zone.level] || '#000';
                        ctx.fillText(zone.level, midX, midY);
                    });
                    ctx.restore();
                },
            };
            const pointNumberPlugin = {
                id: 'fairExportPointNumbers',
                afterDatasetsDraw(chart) {
                    const {
                        ctx,
                        scales: { x, y },
                    } = chart;
                    ctx.save();
                    ctx.font = 'bold 11px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#fff';
                    threatRegister.forEach((r, i) => {
                        ctx.fillText(
                            String(i + 1),
                            x.getPixelForValue(r.impactPercent),
                            y.getPixelForValue(r.probabilityPercent),
                        );
                    });
                    ctx.restore();
                },
            };

            const chart = new Chart(canvas, {
                type: 'scatter',
                data: {
                    datasets: [
                        {
                            label: 'Riesgos FAIR',
                            data: threatRegister.map((r) => ({
                                x: r.impactPercent,
                                y: r.probabilityPercent,
                                name: r.riskName,
                                level: r.evaluationLevel,
                            })),
                            pointBackgroundColor: threatRegister.map((r) => severityToHex(r.severity)),
                            pointBorderColor: 'white',
                            pointRadius: 10,
                            // Mismo motivo que en App.FairRegister.renderRiskRegister: un riesgo en
                            // x=100 o y=100 (ALE que ya iguala/supera el umbral Crítico) cae exacto
                            // en el borde del eje, y Chart.js recorta el punto ahí por defecto.
                            clip: 16,
                        },
                    ],
                },
                options: {
                    responsive: false,
                    animation: false,
                    layout: {
                        padding: { top: 14, right: 14, bottom: 4, left: 4 },
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Impacto (ALE como % del umbral Crítico)' },
                            min: 0,
                            max: 100,
                            ticks: { stepSize: 25 },
                        },
                        y: {
                            title: { display: true, text: 'Probabilidad de superar el umbral de excedencia (%)' },
                            min: 0,
                            max: 100,
                            ticks: { stepSize: 25 },
                        },
                    },
                    plugins: { legend: { display: false } },
                },
                plugins: [matrixBackgroundPlugin, pointNumberPlugin],
            });
            requestAnimationFrame(() => {
                const img = canvas.toDataURL('image/png');
                chart.destroy();
                canvas.remove();
                resolve(img);
            });
        });
    },

    // Mismo motivo y misma técnica que renderOffscreenHeatmap — el <canvas> #fair-pareto-chart
    // real solo existe con contenido si se visitó "Registro de Riesgos" antes de exportar.
    renderOffscreenPareto(pareto) {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            canvas.width = 700;
            canvas.height = 350;
            canvas.style.position = 'fixed';
            canvas.style.left = '-9999px';
            document.body.appendChild(canvas);
            const formatCurrency = (value) =>
                new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                }).format(value);

            const chart = new Chart(canvas, {
                type: 'bar',
                data: {
                    // Números en vez del nombre completo — mismo motivo y mismo patrón que
                    // App.FairRegister.renderParetoChart (ver ese comentario): el nombre completo
                    // rotado 45° podía ocupar más alto que el gráfico mismo. El nombre de cada
                    // número vive en paretoLegendHTML, debajo de esta imagen en el PDF.
                    labels: pareto.risks.map((r, i) => String(i + 1)),
                    datasets: [
                        {
                            type: 'bar',
                            label: 'Pérdida Anual Esperada',
                            data: pareto.risks.map((r) => r.ale),
                            backgroundColor: 'rgba(124, 58, 237, 0.6)',
                            yAxisID: 'y',
                            // Mismo motivo que en App.FairRegister.renderParetoChart: con pocos
                            // riesgos, las barras se estiran a todo el ancho del canvas fijo.
                            maxBarThickness: 70,
                        },
                        {
                            type: 'line',
                            label: '% Acumulado',
                            data: pareto.risks.map((r) => r.cumulativePercent),
                            borderColor: '#B22222',
                            backgroundColor: '#B22222',
                            yAxisID: 'y1',
                            tension: 0.1,
                        },
                    ],
                },
                options: {
                    responsive: false,
                    animation: false,
                    scales: {
                        y: {
                            position: 'left',
                            beginAtZero: true,
                            title: { display: true, text: 'Pérdida Anual Esperada' },
                            ticks: { callback: (v) => formatCurrency(v) },
                        },
                        y1: {
                            position: 'right',
                            beginAtZero: true,
                            max: 100,
                            title: { display: true, text: '% Acumulado' },
                            grid: { drawOnChartArea: false },
                        },
                        x: { title: { display: true, text: 'Riesgo #' } },
                    },
                    plugins: { legend: { position: 'bottom' } },
                },
            });
            requestAnimationFrame(() => {
                const img = canvas.toDataURL('image/png');
                chart.destroy();
                canvas.remove();
                resolve(img);
            });
        });
    },

    // El detalle técnico completo de UN riesgo del Registro (Alcance, Gobernanza, Perfil de
    // Atacante/Defensa, Frecuencia/Vulnerabilidad, Magnitud de Pérdida, Simulación,
    // Evaluación, Sensibilidad, Tratamiento) — antes esto era el reporte de un solo riesgo,
    // aparte del Informe Consolidado; ahora es una sección más dentro de ese mismo informe,
    // una por cada riesgo guardado (ver exportConsolidatedReport). Async porque recalcula el
    // Tratamiento (POST /api/treatment/evaluate) y puede regenerar el histograma.
    async buildFullRiskReportSection(r, index) {
        const fmt = (v) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(v);
        const riskTypeLabel =
            r.riskType === 'oportunidad' ? 'Oportunidad (riesgo positivo)' : 'Amenaza (riesgo negativo)';
        const evalBadge = `<span class="px-2 py-1 rounded text-xs border-l-4 ${r.evaluationClasses}">${r.evaluationLevel}</span>`;

        const chartImg =
            r.chartLabels && r.chartData ? await this.renderOffscreenHistogram(r.chartLabels, r.chartData) : '';

        const lossRowsHTML = r.lossMagnitudes
            ? LOSS_FORMS_KEYS.map((key) => {
                  const f = r.lossMagnitudes[key];
                  if (!f) return '';
                  return `<tr><td>${LOSS_FORM_LABELS.tecnico[key]}</td><td>${fmt(f.min)}</td><td>${fmt(f.mode)}</td><td>${fmt(f.max)}</td></tr>`;
              }).join('')
            : '<tr><td colspan="4">Este riesgo se guardó antes de que se registrara este desglose.</td></tr>';

        // Tratamiento: no se guardó ya calculado (para no duplicar la lógica de negocio del
        // backend) — se guardaron los INSUMOS (mitigar/transferir/evitar, ver
        // saveToRiskRegister) y se recalcula aquí contra el ALE actual de este riesgo. Sin
        // los 10,000 resultados crudos de la simulación (no se guardan, ver chartLabels más
        // arriba), "Transferir" se evalúa de forma conservadora — ver evaluateTreatmentStrategies.
        let treatmentHTML = '';
        if (r.riskType === 'oportunidad') {
            treatmentHTML = `<p>El análisis de Mitigar/Transferir/Evitar/Aceptar (ISO 31000, cláusula 6.5) está diseñado para reducir una pérdida y no aplica a una Oportunidad.</p>`;
        } else if (r.mitigar && r.transferir && r.evitar) {
            let result = null;
            try {
                result = await App.Api.request('/api/treatment/evaluate', {
                    method: 'POST',
                    body: {
                        currentALE: r.ale,
                        mitigar: r.mitigar,
                        transferir: r.transferir,
                        evitar: r.evitar,
                        currency: 'USD',
                    },
                });
            } catch (e) {
                /* se muestra el mensaje de "sin datos" de abajo */
            }
            treatmentHTML = result
                ? `
                <table>
                    <tr><th>Estrategia</th><th>Costo Anual</th><th>Pérdida Residual</th><th>Beneficio Neto</th><th>Fiabilidad</th><th>Implementación</th></tr>
                    <tr><td>Mitigar</td><td>${fmt(result.mitigar.cost)}</td><td>${fmt(result.mitigar.residualALE)}</td><td>${fmt(result.mitigar.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.mitigar.reliability] || '—'}</td><td>${result.mitigar.delayDays} días</td></tr>
                    <tr><td>Transferir (Seguro)</td><td>${fmt(result.transferir.cost)}</td><td>${fmt(result.transferir.residualALE)}</td><td>${fmt(result.transferir.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.transferir.reliability] || '—'}</td><td>${result.transferir.delayDays} días</td></tr>
                    <tr><td>Evitar</td><td>${fmt(result.evitar.cost)}</td><td>${fmt(0)}</td><td>${fmt(result.evitar.netBenefit)}</td><td>${this.RELIABILITY_LABELS[result.evitar.reliability] || '—'}</td><td>${result.evitar.delayDays} días</td></tr>
                    <tr><td>Aceptar / Retener</td><td>${fmt(0)}</td><td>${fmt(r.ale)}</td><td>—</td><td>—</td><td>—</td></tr>
                </table>
                <p style="margin-top:8px; font-size:12px;"><strong>Justificación de aceptación (si aplica):</strong> ${sanitizeHTML(r.aceptarJustificacion) || '—'}</p>`
                : '<p>No se pudo calcular el tratamiento de este riesgo.</p>';
        } else {
            treatmentHTML =
                '<p>Este riesgo se guardó antes de que existiera esta sección — vuelve a correr su simulación desde Análisis FAIR para completarla.</p>';
        }

        return `
            <div class="print-section">
                <h2>${index}. ${sanitizeHTML(r.riskName)}</h2>
                <h3>Alcance del Riesgo</h3>
                <table>
                    <tr><td><strong>Activo Afectado</strong></td><td>${sanitizeHTML(r.asset) || '—'}</td></tr>
                    <tr><td><strong>Agente de Amenaza</strong></td><td>${sanitizeHTML(r.threat) || '—'}</td></tr>
                    <tr><td><strong>Efecto / Pérdida</strong></td><td>${this.EFFECT_LABELS[r.effect] || r.effect || '—'}</td></tr>
                    <tr><td><strong>Tipo de Riesgo</strong></td><td>${riskTypeLabel}</td></tr>
                    <tr><td><strong>Horizonte Temporal</strong></td><td>${r.timeHorizon || '1'} año(s)</td></tr>
                </table>
                <h3>Gobernanza y Calidad de la Información</h3>
                <table>
                    <tr><td><strong>Dueño del Riesgo</strong></td><td>${sanitizeHTML(r.owner) || '—'}</td></tr>
                    <tr><td><strong>Próxima Fecha de Revisión</strong></td><td>${r.reviewDate || '—'}</td></tr>
                    <tr><td><strong>Fuente de los Datos</strong></td><td>${this.DATA_SOURCE_LABELS[r.dataSource] || '—'}</td></tr>
                    <tr><td><strong>Nivel de Confianza</strong></td><td>${this.DATA_CONFIDENCE_LABELS[r.dataConfidence] || '—'}</td></tr>
                    <tr><td><strong>Notas / Justificación</strong></td><td>${sanitizeHTML(r.dataNotes) || '—'}</td></tr>
                    <tr><td><strong>Plan de Seguridad / Medidas Vigentes</strong></td><td>${sanitizeHTML(r.securityPlan) || '—'}</td></tr>
                    <tr><td><strong>Apreciador / Analista Responsable</strong></td><td>${sanitizeHTML(r.assessor) || '—'}</td></tr>
                    <tr><td><strong>Fecha de esta Apreciación</strong></td><td>${r.assessmentDate || '—'}</td></tr>
                    <tr><td><strong>Lugar / Ubicación Apreciada</strong></td><td>${sanitizeHTML(r.assessmentLocation) || '—'}</td></tr>
                </table>
                ${
                    r.attackerProfileName || r.defenseProfileName
                        ? `
                <h3>Perfil de Atacante y Defensa</h3>
                <table>
                    <tr><td>Perfil de Atacante</td><td>${sanitizeHTML(r.attackerProfileName) || '—'}${r.attackerScore != null ? ` (Factor de Amenaza: ${r.attackerScore.toFixed(1)}%)` : ''}</td></tr>
                    <tr><td>Nivel de Defensa</td><td>${sanitizeHTML(r.defenseProfileName) || '—'}${r.defenseScore != null ? ` (${r.defenseScore.toFixed(1)}%)` : ''}</td></tr>
                </table>`
                        : ''
                }
                ${
                    r.tef || r.vuln
                        ? `
                <h3>Frecuencia y Vulnerabilidad</h3>
                <table>
                    <tr><th></th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr>
                    ${r.tef ? `<tr><td>Frecuencia de Evento de Amenaza (contactos/año)</td><td>${r.tef.min}</td><td>${r.tef.mode}</td><td>${r.tef.max}</td></tr>` : ''}
                    ${r.vuln ? `<tr><td>Vulnerabilidad (%)</td><td>${r.vuln.min}%</td><td>${r.vuln.mode}%</td><td>${r.vuln.max}%</td></tr>` : ''}
                </table>`
                        : ''
                }
                <h3>Magnitud de Pérdida por Categoría</h3>
                <table>
                    <tr><th>Categoría</th><th>Mín</th><th>Más Probable</th><th>Máx</th></tr>
                    ${lossRowsHTML}
                </table>
                <h3>Resultados de la Simulación Monte Carlo${r.seed ? ` (semilla: ${r.seed})` : ''}</h3>
                <table>
                    <tr><td>Pérdida Anual Promedio (ALE)</td><td>${fmt(r.ale)}</td></tr>
                    ${r.median != null ? `<tr><td>Pérdida Anual Mediana (P50)</td><td>${fmt(r.median)}</td></tr>` : ''}
                    ${r.min != null ? `<tr><td>Pérdida Mínima Simulada</td><td>${fmt(r.min)}</td></tr>` : ''}
                    ${r.max != null ? `<tr><td>Pérdida Máxima Simulada</td><td>${fmt(r.max)}</td></tr>` : ''}
                    ${r.p90 != null ? `<tr><td>Peor 10% de los casos (P90)</td><td>> ${fmt(r.p90)}</td></tr>` : ''}
                    <tr><td>CVaR 95% (Expected Shortfall)</td><td>${fmt(r.cvar95)}</td></tr>
                </table>
                ${chartImg ? `<img src="${chartImg}" alt="Distribución de Pérdida Anual" style="max-width:100%; height:auto; display:block;">` : ''}
                <h3>Evaluación del Riesgo (contra Criterios de Riesgo definidos)</h3>
                <table>
                    <tr><td><strong>Clasificación</strong></td><td>${evalBadge}</td></tr>
                    <tr><td><strong>Justificación</strong></td><td>${sanitizeHTML(r.evaluationJustification) || ''}</td></tr>
                </table>
                <h3>Análisis de Sensibilidad</h3>
                <table>
                    <tr><th>Variable</th><th>Correlación con el resultado</th></tr>
                    ${(r.sensitivity || [])
                        .slice(0, 8)
                        .map(
                            (s) =>
                                `<tr><td>${sanitizeHTML(s.name)}</td><td>${(s.correlation * 100).toFixed(1)}%</td></tr>`,
                        )
                        .join('')}
                </table>
                <h3>Comparación de Estrategias de Tratamiento (ISO 31000 / Broder, 1984)</h3>
                ${treatmentHTML}
            </div>`;
    },

    async exportConsolidatedReport() {
        // El botón "Exportar Informe Consolidado" vive en Análisis de Riesgo (ver
        // app_fair.html), no en Registro de Riesgos — no se puede asumir que el usuario ya
        // visitó esa página en esta sesión. loadRiskRegister(false) sí deja
        // state.fair.riskRegister/registerPareto/registerHeatmapZones/
        // registerConsolidatedSensitivity al día siempre (vienen de GET /api/register), aunque
        // no dibuje ningún <canvas> — eso es justo lo que se necesita aquí: los datos, no los
        // gráficos ya dibujados en pantalla.
        await App.FairRegister.loadRiskRegister(false);
        const register = state.fair.riskRegister;
        if (!register || register.length === 0) {
            Modal.alert('Aún no tienes ningún riesgo guardado en el Registro.', 'Nada que exportar');
            return;
        }
        const formatCurrency = (value) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value);
        const ctx = App.OrgContext.context;

        // 'oportunidad' se excluye de la exposición total y del mapa de calor — su "ale" es
        // un beneficio esperado, no una pérdida (mismo criterio que calculateParetoAnalysis
        // en el backend; ver también renderRiskRegister).
        const threatRegister = register.filter((r) => r.riskType !== 'oportunidad');
        const opportunityCount = register.length - threatRegister.length;
        const totalALE = threatRegister.reduce((sum, r) => sum + r.ale, 0);
        const criticos = threatRegister.filter((r) => r.evaluationLevel.includes('Crítico')).length;
        const exposicionTotalTexto = formatCurrency(totalALE);

        // Interpretación General y Sensibilidad Consolidada son texto puro (sin canvas) — se
        // regeneran directo aquí, en vez de leer el DOM de "Registro de Riesgos" (que puede no
        // haberse dibujado nunca en esta sesión), mismo motivo que el mapa de calor/Pareto abajo.
        App.FairRegister.renderPortfolioInterpretation(register);
        App.FairRegister.renderConsolidatedSensitivity();
        const interpretationHTML = document.getElementById('fair-register-interpretation').innerHTML;
        const sensitivityHTML = document.getElementById('fair-consolidated-sensitivity-list').innerHTML;

        // Mapa de calor y Pareto: SIEMPRE se redibujan fuera de pantalla a tamaño fijo (ver
        // renderOffscreenHeatmap/renderOffscreenPareto) — nunca se lee el <canvas> real de
        // "Registro de Riesgos". Ese canvas solo tiene contenido si esa página ya se dibujó
        // (responsive:true necesita el tamaño de un contenedor visible); leerlo sin eso
        // capturaba un PNG en blanco de 300×150 (el tamaño por defecto del navegador),
        // estirado por CSS y viéndose "desparramado"/borroso en el PDF.
        const heatmapImg = await this.renderOffscreenHeatmap(threatRegister, state.fair.registerHeatmapZones);
        const pareto = state.fair.registerPareto;
        const paretoImg = pareto ? await this.renderOffscreenPareto(pareto) : '';
        const paretoSummaryText = pareto
            ? `${pareto.riskCountFor80Percent} de ${pareto.totalRiskCount} riesgo(s) concentran el 80% de tu exposición total (${formatCurrency(pareto.totalExposure)}/año). Prioriza el tratamiento en esos primero.`
            : 'Aún no hay suficientes riesgos guardados para el análisis de Pareto.';
        // Mismo orden que los puntos numerados del mapa de calor (ver renderRiskRegister) —
        // solo amenazas, para que el número en el mapa corresponda al mismo riesgo aquí.
        const heatmapLegendHTML = threatRegister
            .map((r, i) => `<li>${i + 1}. ${sanitizeHTML(r.riskName)}</li>`)
            .join('');
        // Mismo criterio que arriba, pero en el orden del Pareto (mayor a menor ALE) — no
        // necesariamente el mismo orden que threatRegister, así que es una lista aparte.
        const paretoLegendHTML = pareto
            ? pareto.risks.map((r, i) => `<li>${i + 1}. ${sanitizeHTML(r.riskName)}</li>`).join('')
            : '';

        // El backend guarda ale/cvar95 como números crudos (no strings ya formateados) — el
        // formateo es presentación, se hace aquí por entrada.
        const formatEntryCurrency = (value) =>
            new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
            }).format(value);
        const formatEntryDate = (r) =>
            new Date(r.date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });

        // Mismo badge de color que ya se ve en pantalla en la tabla del Registro
        // (r.evaluationClasses ya viene calculado por entrada, ver PUT /api/register) — antes
        // el PDF solo mostraba el texto de evaluationLevel plano, sin el color.
        const evalBadgeHTML = (r) =>
            `<span class="px-2 py-1 rounded text-xs border-l-4 ${r.evaluationClasses}">${r.evaluationLevel}</span>`;
        const riskRowsHTML = register
            .map(
                (r) =>
                    `<tr><td>${sanitizeHTML(r.riskName)}</td><td>${sanitizeHTML(r.asset)}</td><td>${sanitizeHTML(r.owner)}</td><td>${formatEntryCurrency(r.ale)}</td><td>${formatEntryCurrency(r.cvar95)}</td><td>${evalBadgeHTML(r)}</td><td>${formatEntryDate(r)}</td></tr>`,
            )
            .join('');

        // Detalle técnico completo de cada riesgo (Alcance, Gobernanza, Perfil de Atacante/
        // Defensa, Frecuencia/Vulnerabilidad, Magnitud de Pérdida, Simulación, Evaluación,
        // Sensibilidad, Tratamiento) — antes esto era un reporte aparte por cada riesgo
        // (App.FairExport.exportFairReport, ya eliminado); ahora es una sección de este mismo
        // informe, una por riesgo (ver buildFullRiskReportSection). Secuencial (no
        // Promise.all) para no disparar N peticiones simultáneas a /api/treatment/evaluate.
        const riskDetailSections = [];
        for (let i = 0; i < register.length; i++) {
            riskDetailSections.push(await this.buildFullRiskReportSection(register[i], i + 1));
        }
        const riskDetailHTML = riskDetailSections.join('');

        const reportHTML = `
            <div class="print-section">
                <h1>Informe Consolidado de Riesgos (FAIR)${ctx.nombreEmpresa ? ` — ${sanitizeHTML(ctx.nombreEmpresa)}` : ''}</h1>
                <p>Generado: ${new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <div class="print-section">
                <h2>Contexto Organizacional</h2>
                <table>
                    <tr><td><strong>Nombre de la Empresa</strong></td><td>${sanitizeHTML(ctx.nombreEmpresa) || '—'}</td></tr>
                    <tr><td><strong>Misión y Objetivos</strong></td><td>${sanitizeHTML(ctx.mision) || '—'}</td></tr>
                    <tr><td><strong>Naturaleza del Negocio</strong></td><td>${sanitizeHTML(ctx.naturalezaNegocio) || '—'}</td></tr>
                    <tr><td><strong>Apetito por el Riesgo</strong></td><td>${ctx.apetitoRiesgo}</td></tr>
                    <tr><td><strong>Partes Interesadas Clave</strong></td><td>${sanitizeHTML(ctx.partesInteresadas) || '—'}</td></tr>
                    <tr><td><strong>Entorno Legal/Regulatorio</strong></td><td>${sanitizeHTML(ctx.entornoLegal) || '—'}</td></tr>
                    <tr><td><strong>Alcance de la Cadena de Suministro Cubierta</strong></td><td>${sanitizeHTML(ctx.alcanceCadenaSuministro) || '—'}</td></tr>
                </table>
            </div>
            <div class="print-section">
                <h2>Resumen Ejecutivo</h2>
                <table>
                    <tr><td><strong>Riesgos Analizados</strong></td><td>${register.length}${opportunityCount > 0 ? ` (${threatRegister.length} amenaza${threatRegister.length === 1 ? '' : 's'}, ${opportunityCount} oportunidad${opportunityCount === 1 ? '' : 'es'})` : ''}</td></tr>
                    <tr><td><strong>Exposición Total (suma de ALE de las amenazas)</strong></td><td>${exposicionTotalTexto}</td></tr>
                    <tr><td><strong>Amenazas en nivel Crítico</strong></td><td>${criticos}</td></tr>
                </table>
            </div>
            <div class="print-section">
                <h2>Registro de Riesgos</h2>
                <table>
                    <tr><th>Riesgo</th><th>Activo</th><th>Dueño</th><th>ALE</th><th>CVaR 95%</th><th>Evaluación</th><th>Fecha</th></tr>
                    ${riskRowsHTML}
                </table>
            </div>
            <div class="print-section">
                <h2>Mapa de Calor Consolidado</h2>
                <table style="border:none;">
                    <tr>
                        <td style="width:65%; vertical-align:top; border:none; padding:0;"><img src="${heatmapImg}" alt="Mapa de calor consolidado" style="max-width:100%; height:auto; display:block;"></td>
                        <td style="width:35%; vertical-align:top; border:none; padding:0 0 0 12px;">
                            <strong style="font-size:12px;">Riesgos:</strong>
                            <ol style="margin:4px 0 0 16px; padding:0; font-size:11px;">${heatmapLegendHTML}</ol>
                        </td>
                    </tr>
                </table>
            </div>
            <div class="print-section">
                <h2>Análisis 80-20 (Pareto)</h2>
                <p style="font-size:12px;">${paretoSummaryText}</p>
                ${paretoImg ? `<img src="${paretoImg}" alt="Análisis de Pareto" style="max-width:100%; height:auto; display:block;">` : ''}
                ${
                    paretoLegendHTML
                        ? `<strong style="font-size:12px;">Riesgos:</strong><ol style="margin:4px 0 0 16px; padding:0; font-size:11px;">${paretoLegendHTML}</ol>`
                        : ''
                }
            </div>
            <div class="print-section">
                <h2>Sensibilidad Consolidada</h2>
                ${sensitivityHTML}
            </div>
            ${riskDetailHTML}
            <div class="print-section">
                <h2>Interpretación General</h2>
                ${interpretationHTML}
            </div>
            <div class="print-section" style="margin-top:24px; border-top:1px solid #999; padding-top:8px;">
                <p style="font-size:11px; color:#555;">Este documento contiene información confidencial de análisis de riesgo. Su distribución debe limitarse a las personas autorizadas por la organización apreciada.</p>
            </div>
        `;

        document.getElementById('fair-print-report').innerHTML = reportHTML;
        window.print();
    },
};

App.FairExport = FairExport;
