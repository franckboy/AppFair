import { useState } from "react";
import { currencyFull } from "../format";
import { ChartTooltip } from "./ChartTooltip";
import { textColorFor } from "./colorContrast";
import { RISK_LEVEL_COLOR, RISK_LEVEL_LABEL, riskLevelFor } from "./statusScale";
import { useChartTooltip } from "./useChartTooltip";

export interface RiskMatrixScenario {
  id: string;
  name: string;
  ale: number;
  likelihood: number;
  severity: number;
}

interface RiskHeatmapProps {
  scenarios: RiskMatrixScenario[];
}

const BINS = 4;

function binIndex(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const t = (value - min) / (max - min);
  return Math.min(BINS - 1, Math.floor(t * BINS));
}

export function RiskHeatmap({ scenarios }: RiskHeatmapProps) {
  const [showTable, setShowTable] = useState(false);
  const { containerRef, tooltip, showTooltipFromEvent, hideTooltip } = useChartTooltip<{
    level: string;
    scenarios: RiskMatrixScenario[];
  }>();

  if (scenarios.length === 0) {
    return <p className="empty-state">No hay escenarios simulados todavía.</p>;
  }

  const likelihoods = scenarios.map((s) => s.likelihood);
  const severities = scenarios.map((s) => s.severity);
  const minL = Math.min(...likelihoods);
  const maxL = Math.max(...likelihoods);
  const minS = Math.min(...severities);
  const maxS = Math.max(...severities);

  const cellsByKey = new Map<string, RiskMatrixScenario[]>();
  const scenarioBins = scenarios.map((s) => {
    const likelihoodBin = binIndex(s.likelihood, minL, maxL);
    const severityBin = binIndex(s.severity, minS, maxS);
    const key = `${likelihoodBin}:${severityBin}`;
    const bucket = cellsByKey.get(key);
    if (bucket) bucket.push(s);
    else cellsByKey.set(key, [s]);
    return { ...s, likelihoodBin, severityBin };
  });

  const severityRowsTopDown = [3, 2, 1, 0];
  const likelihoodColsLeftRight = [0, 1, 2, 3];

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3>Matriz de riesgo (probabilidad × severidad)</h3>
        <button type="button" className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Ver mapa" : "Ver tabla"}
        </button>
      </div>

      <div className="chart-legend">
        {(["low", "medium", "high", "critical"] as const).map((level) => (
          <span key={level} className="legend-item">
            <span className="legend-swatch" style={{ background: RISK_LEVEL_COLOR[level] }} />
            {RISK_LEVEL_LABEL[level]}
          </span>
        ))}
      </div>

      {showTable ? (
        <table className="params-table">
          <thead>
            <tr>
              <th>Escenario</th>
              <th>ALE</th>
              <th>Probabilidad (LEF/año)</th>
              <th>Severidad</th>
              <th>Nivel</th>
            </tr>
          </thead>
          <tbody>
            {[...scenarioBins]
              .sort((a, b) => b.ale - a.ale)
              .map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{currencyFull.format(s.ale)}</td>
                  <td>{s.likelihood.toFixed(2)}</td>
                  <td>{currencyFull.format(s.severity)}</td>
                  <td>{RISK_LEVEL_LABEL[riskLevelFor(s.likelihoodBin, s.severityBin)]}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <div ref={containerRef} style={{ position: "relative" }}>
          <div className="risk-matrix-layout">
            <div className="risk-matrix-yaxis">Severidad</div>
            <div className="risk-matrix-grid">
              {severityRowsTopDown.map((severityBin) =>
                likelihoodColsLeftRight.map((likelihoodBin) => {
                  const key = `${likelihoodBin}:${severityBin}`;
                  const cellScenarios = cellsByKey.get(key) ?? [];
                  const level = riskLevelFor(likelihoodBin, severityBin);
                  const color = RISK_LEVEL_COLOR[level];
                  return (
                    <div
                      key={key}
                      className="risk-matrix-cell"
                      style={{ background: color, color: textColorFor(color) }}
                      tabIndex={0}
                      onMouseEnter={(e) => showTooltipFromEvent(e, { level: RISK_LEVEL_LABEL[level], scenarios: cellScenarios })}
                      onFocus={(e) => showTooltipFromEvent(e, { level: RISK_LEVEL_LABEL[level], scenarios: cellScenarios })}
                      onMouseLeave={hideTooltip}
                      onBlur={hideTooltip}
                    >
                      <span>{RISK_LEVEL_LABEL[level]}</span>
                      {cellScenarios.length > 0 && <span className="risk-matrix-badge">{cellScenarios.length}</span>}
                    </div>
                  );
                }),
              )}
            </div>
            <div className="risk-matrix-xaxis">Probabilidad</div>
          </div>

          {tooltip && (
            <ChartTooltip x={tooltip.x} y={tooltip.y}>
              <strong>{tooltip.data.level}</strong>
              {tooltip.data.scenarios.length === 0 ? (
                <span>Sin escenarios en esta zona</span>
              ) : (
                tooltip.data.scenarios.map((s) => (
                  <span key={s.id}>
                    {s.name} · {currencyFull.format(s.ale)}
                  </span>
                ))
              )}
            </ChartTooltip>
          )}
        </div>
      )}
    </div>
  );
}
