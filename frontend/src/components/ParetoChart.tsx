import { useState } from "react";
import { currencyCompact, currencyFull, percent1 } from "../format";
import { ChartTooltip } from "./ChartTooltip";
import { useChartTooltip } from "./useChartTooltip";

export interface ParetoItem {
  id: string;
  name: string;
  ale: number;
}

interface ParetoChartProps {
  items: ParetoItem[];
}

const WIDTH = 720;
const LEFT_AXIS = 44;
const RIGHT_PAD = 16;
const TOP_PAD = 28;
const PLOT_HEIGHT = 220;
const X_AXIS_BAND = 68;
const BOTTOM_PAD = 8;
const HEIGHT = TOP_PAD + PLOT_HEIGHT + X_AXIS_BAND + BOTTOM_PAD;
const GRID_STEPS = [0, 25, 50, 75, 100];

function truncate(name: string, max = 14) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** Rounded-top, square-baseline bar path — the mark spec's "4px data-end, square at baseline". */
function roundedTopBarPath(x: number, y: number, w: number, h: number, r = 4) {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return `M ${x},${y + h} L ${x},${y + radius} Q ${x},${y} ${x + radius},${y} L ${x + w - radius},${y} Q ${x + w},${y} ${x + w},${y + radius} L ${x + w},${y + h} Z`;
}

export function ParetoChart({ items }: ParetoChartProps) {
  const [showTable, setShowTable] = useState(false);
  const { containerRef, tooltip, showTooltipAt, hideTooltip } = useChartTooltip<{
    name: string;
    ale: number;
    pct: number;
    cumPct: number;
  }>();

  if (items.length === 0) {
    return <p className="empty-state">No hay escenarios simulados todavía.</p>;
  }

  const sorted = [...items].sort((a, b) => b.ale - a.ale);
  const total = sorted.reduce((sum, item) => sum + item.ale, 0);
  let running = 0;
  const rows = sorted.map((item) => {
    const pct = total > 0 ? (item.ale / total) * 100 : 0;
    running += pct;
    return { ...item, pct, cumPct: running };
  });

  const n = rows.length;
  const plotWidth = WIDTH - LEFT_AXIS - RIGHT_PAD;
  const bandWidth = plotWidth / n;
  const barWidth = Math.min(24, bandWidth * 0.6);
  const yFor = (pct: number) => TOP_PAD + PLOT_HEIGHT - (pct / 100) * PLOT_HEIGHT;
  const centerX = (i: number) => LEFT_AXIS + i * bandWidth + bandWidth / 2;

  const linePoints = rows.map((row, i) => `${centerX(i)},${yFor(row.cumPct)}`).join(" ");
  const maxRow = rows[0];
  const lastIndex = n - 1;

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <h3>Pareto de riesgo (ALE por escenario)</h3>
        <button type="button" className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>

      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch" style={{ background: "var(--series-1)" }} />
          ALE (% del total)
        </span>
        <span className="legend-item">
          <span className="legend-key" style={{ background: "var(--series-2)" }} />
          Acumulado (%)
        </span>
      </div>

      {showTable ? (
        <table className="params-table">
          <thead>
            <tr>
              <th>Escenario</th>
              <th>ALE</th>
              <th>% del total</th>
              <th>% acumulado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{currencyFull.format(row.ale)}</td>
                <td>{percent1.format(row.pct)}%</td>
                <td>{percent1.format(row.cumPct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div ref={containerRef} style={{ position: "relative" }}>
          <div className="chart-scroll">
          <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Pareto de ALE por escenario">
            {GRID_STEPS.map((step) => (
              <line
                key={step}
                x1={LEFT_AXIS}
                x2={WIDTH - RIGHT_PAD}
                y1={yFor(step)}
                y2={yFor(step)}
                className="chart-gridline"
              />
            ))}
            {GRID_STEPS.map((step) => (
              <text key={step} x={LEFT_AXIS - 8} y={yFor(step)} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
                {step}%
              </text>
            ))}

            {rows.map((row, i) => {
              const x = LEFT_AXIS + i * bandWidth + (bandWidth - barWidth) / 2;
              const barHeight = (row.pct / 100) * PLOT_HEIGHT;
              const y = yFor(row.pct);
              return (
                <g key={row.id}>
                  <path d={roundedTopBarPath(x, y, barWidth, barHeight)} fill="var(--series-1)" />
                  {row.id === maxRow.id && (
                    <text x={x + barWidth / 2} y={y - 8} className="chart-direct-label" textAnchor="middle">
                      {currencyCompact.format(row.ale)}
                    </text>
                  )}
                  <text
                    x={centerX(i)}
                    y={TOP_PAD + PLOT_HEIGHT + 14}
                    className="chart-axis-label"
                    textAnchor="end"
                    transform={`rotate(-35 ${centerX(i)} ${TOP_PAD + PLOT_HEIGHT + 14})`}
                  >
                    {truncate(row.name)}
                  </text>
                  <rect
                    x={LEFT_AXIS + i * bandWidth}
                    y={TOP_PAD}
                    width={bandWidth}
                    height={PLOT_HEIGHT}
                    fill="transparent"
                    tabIndex={0}
                    onMouseEnter={() => showTooltipAt(centerX(i), y, row)}
                    onFocus={() => showTooltipAt(centerX(i), y, row)}
                    onMouseLeave={hideTooltip}
                    onBlur={hideTooltip}
                  />
                </g>
              );
            })}

            <polyline points={linePoints} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {rows.map((row, i) => (
              <g key={row.id}>
                <circle cx={centerX(i)} cy={yFor(row.cumPct)} r={6} fill="var(--surface-1)" />
                <circle cx={centerX(i)} cy={yFor(row.cumPct)} r={4} fill="var(--series-2)" />
                {i === lastIndex && (
                  <text x={centerX(i)} y={yFor(row.cumPct) - 12} className="chart-direct-label" textAnchor="end">
                    {percent1.format(row.cumPct)}%
                  </text>
                )}
              </g>
            ))}
          </svg>
          </div>

          {tooltip && (
            <ChartTooltip x={tooltip.x} y={tooltip.y}>
              <strong>{currencyFull.format(tooltip.data.ale)}</strong>
              <span>{tooltip.data.name}</span>
              <span>
                {percent1.format(tooltip.data.pct)}% del total · {percent1.format(tooltip.data.cumPct)}% acumulado
              </span>
            </ChartTooltip>
          )}
        </div>
      )}
    </div>
  );
}
