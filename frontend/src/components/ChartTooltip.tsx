import type { ReactNode } from "react";

interface ChartTooltipProps {
  x: number;
  y: number;
  children: ReactNode;
}

/** Floating box anchored above a mark's own position (see useChartTooltip) — never gates a value, only enhances it. */
export function ChartTooltip({ x, y, children }: ChartTooltipProps) {
  return (
    <div className="chart-tooltip" style={{ left: x, top: y }} role="status">
      {children}
    </div>
  );
}
