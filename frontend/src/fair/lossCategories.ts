/** Must match backend/src/fair/lossCategories.ts exactly — the API rejects a scenario that doesn't carry precisely this set. */
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
