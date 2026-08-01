import { textColorFor } from "./colorContrast";
import { RISK_LEVEL_COLOR, RISK_LEVEL_LABEL, type RiskLevel } from "./statusScale";

interface RiskBadgeProps {
  level: RiskLevel;
}

/** A small colored pill (fixed status palette) marking a value's criticality — used consistently wherever an ALE appears on its own. */
export function RiskBadge({ level }: RiskBadgeProps) {
  const color = RISK_LEVEL_COLOR[level];
  return (
    <span className="risk-badge" style={{ background: color, color: textColorFor(color) }}>
      {RISK_LEVEL_LABEL[level]}
    </span>
  );
}
