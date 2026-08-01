import { Fragment, useState } from "react";
import { currencyCompact, currencyFull } from "../format";
import { ChartTooltip } from "./ChartTooltip";
import { SEQUENTIAL_STEPS, sequentialColor, textColorFor } from "./sequentialScale";
import { useChartTooltip } from "./useChartTooltip";

export interface HeatmapCell {
  assetId: string;
  threatId: string;
  ale: number;
  scenarioNames: string[];
}

interface RiskHeatmapProps {
  assets: { id: string; name: string }[];
  threats: { id: string; name: string }[];
  cells: HeatmapCell[];
}

export function RiskHeatmap({ assets, threats, cells }: RiskHeatmapProps) {
  const [showTable, setShowTable] = useState(false);
  const { containerRef, tooltip, showTooltipFromEvent, hideTooltip } = useChartTooltip<{
    assetName: string;
    threatName: string;
    ale: number | null;
    scenarioNames: string[];
  }>();

  if (assets.length === 0 || threats.length === 0) {
    return <p className="empty-state">No hay escenarios simulados todavía.</p>;
  }

  const cellByKey = new Map(cells.map((c) => [`${c.assetId}:${c.threatId}`, c]));
  const maxAle = cells.reduce((max, c) => Math.max(max, c.ale), 0);

  const gradient = `linear-gradient(to right, ${SEQUENTIAL_STEPS.join(", ")})`;

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3>Mapa de calor: activo × amenaza (ALE)</h3>
        <button type="button" className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Ver mapa" : "Ver tabla"}
        </button>
      </div>

      {showTable ? (
        <table className="params-table">
          <thead>
            <tr>
              <th>Activo</th>
              <th>Amenaza</th>
              <th>ALE</th>
            </tr>
          </thead>
          <tbody>
            {[...cells]
              .sort((a, b) => b.ale - a.ale)
              .map((cell) => (
                <tr key={`${cell.assetId}:${cell.threatId}`}>
                  <td>{assets.find((a) => a.id === cell.assetId)?.name}</td>
                  <td>{threats.find((t) => t.id === cell.threatId)?.name}</td>
                  <td>{currencyFull.format(cell.ale)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="heatmap-scale">
            <span className="heatmap-scale-label">0</span>
            <span className="heatmap-scale-bar" style={{ background: gradient }} />
            <span className="heatmap-scale-label">{currencyCompact.format(maxAle)}</span>
          </div>

          <div ref={containerRef} style={{ position: "relative" }}>
            <div style={{ overflowX: "auto" }}>
            <div
              className="heatmap-grid"
              style={{ gridTemplateColumns: `160px repeat(${threats.length}, minmax(90px, 1fr))` }}
            >
              <div className="heatmap-corner" />
              {threats.map((threat) => (
                <div key={threat.id} className="heatmap-col-header" title={threat.name}>
                  {threat.name}
                </div>
              ))}
              {assets.map((asset) => (
                <Fragment key={asset.id}>
                  <div className="heatmap-row-header">{asset.name}</div>
                  {threats.map((threat) => {
                    const cell = cellByKey.get(`${asset.id}:${threat.id}`);
                    const color = cell ? sequentialColor(cell.ale, maxAle) : "var(--gridline)";
                    return (
                      <div
                        key={`${asset.id}:${threat.id}`}
                        className="heatmap-cell"
                        style={{ background: color, color: cell ? textColorFor(color) : "var(--text-muted)" }}
                        tabIndex={0}
                        onMouseEnter={(e) =>
                          showTooltipFromEvent(e, {
                            assetName: asset.name,
                            threatName: threat.name,
                            ale: cell?.ale ?? null,
                            scenarioNames: cell?.scenarioNames ?? [],
                          })
                        }
                        onFocus={(e) =>
                          showTooltipFromEvent(e, {
                            assetName: asset.name,
                            threatName: threat.name,
                            ale: cell?.ale ?? null,
                            scenarioNames: cell?.scenarioNames ?? [],
                          })
                        }
                        onMouseLeave={hideTooltip}
                        onBlur={hideTooltip}
                      >
                        {cell ? currencyCompact.format(cell.ale) : "—"}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
            </div>

            {tooltip && (
              <ChartTooltip x={tooltip.x} y={tooltip.y}>
                {tooltip.data.ale != null ? (
                  <>
                    <strong>{currencyFull.format(tooltip.data.ale)}</strong>
                    <span>
                      {tooltip.data.assetName} · {tooltip.data.threatName}
                    </span>
                    <span>{tooltip.data.scenarioNames.join(", ")}</span>
                  </>
                ) : (
                  <span>
                    {tooltip.data.assetName} · {tooltip.data.threatName} — sin escenario registrado
                  </span>
                )}
              </ChartTooltip>
            )}
          </div>
        </>
      )}
    </div>
  );
}
