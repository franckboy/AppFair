/** Fixed status palette (never themed) from the design system's palette reference. */
export const STATUS_COLORS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_LEVEL_COLOR: Record<RiskLevel, string> = {
  low: STATUS_COLORS.good,
  medium: STATUS_COLORS.warning,
  high: STATUS_COLORS.serious,
  critical: STATUS_COLORS.critical,
};

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

/**
 * Standard diagonal-banded risk matrix: combines a 0-3 likelihood bin and a 0-3
 * severity bin into one of four qualitative levels. Not tuned to reproduce any
 * specific reference matrix cell-for-cell — this is the common industry pattern
 * (risk grows with both axes, severity and likelihood trade off near the middle).
 */
export function riskLevelFor(likelihoodBin: number, severityBin: number): RiskLevel {
  const score = likelihoodBin + severityBin;
  if (score >= 6) return "critical";
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

/**
 * Classifies a single ALE value against fixed absolute thresholds, for the
 * "criticality" badge shown wherever a scenario's ALE appears on its own
 * (list rows, a scenario's own detail page, a treatment's residual ALE) —
 * unlike `riskLevelFor`, which bins a *portfolio* of scenarios relative to
 * each other for the dashboard's risk matrix.
 *
 * Thresholds are provisional defaults (aligned to a low of $50k and a
 * critical floor of $250k), not yet user-configurable. Replace with the
 * organization's own "Criterios de Riesgo" once that feature exists.
 */
export function riskLevelForAle(ale: number): RiskLevel {
  if (ale > 250_000) return "critical";
  if (ale > 125_000) return "high";
  if (ale > 50_000) return "medium";
  return "low";
}
