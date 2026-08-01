import type { ReactNode } from "react";

interface StatTileProps {
  label: string;
  value: string;
  hint?: ReactNode;
}

/** Figure contract: label (sentence case) + semibold value in proportional figures. No delta/trend yet — the dashboard has no historical series. */
export function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className="stat-tile">
      <p className="stat-tile-label">{label}</p>
      <p className="stat-tile-value">{value}</p>
      {hint && <p className="stat-tile-hint">{hint}</p>}
    </div>
  );
}
