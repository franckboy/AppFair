/**
 * The fixed set of loss-magnitude categories a RiskScenario is broken into,
 * instead of one aggregate figure — a single loss event typically triggers
 * costs across several of these at once (e.g. a robbery causes both
 * replacement costs and reputational damage), and separating them is what
 * lets sensitivity analysis attribute variance to a specific driver.
 */
export const LOSS_CATEGORIES = [
  { key: "productividad", label: "Pérdida de Productividad" },
  { key: "respuesta", label: "Costos de Respuesta" },
  { key: "reemplazo", label: "Costos de Reemplazo" },
  { key: "multas", label: "Multas y Sanciones" },
  { key: "reputacion", label: "Daño Reputacional" },
  { key: "investigacion", label: "Costos de Investigación" },
  { key: "oportunidad", label: "Pérdida de Oportunidad" },
  { key: "comunitario", label: "Impacto Comunitario/Societario" },
  { key: "ambiental", label: "Impacto Ambiental" },
] as const;

export type LossCategoryKey = (typeof LOSS_CATEGORIES)[number]["key"];

export const LOSS_CATEGORY_KEYS: LossCategoryKey[] = LOSS_CATEGORIES.map((c) => c.key);

export const LOSS_CATEGORY_LABEL: Record<LossCategoryKey, string> = Object.fromEntries(
  LOSS_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<LossCategoryKey, string>;
