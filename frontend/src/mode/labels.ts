/**
 * Modo Simple / Modo Técnico: a language-only toggle, never a calculation
 * difference — Técnico uses standard FAIR terminology, Simple reframes the
 * same fields and results as plain conversational questions for a
 * non-technical user. Both modes read the exact same underlying numbers.
 */
export const LABELS = {
  tefFieldLabel: {
    tecnico: "Frecuencia de eventos de amenaza (por año)",
    simple: "¿Qué tan seguido pasaría? (veces por año)",
  },
  vulnFieldLabel: {
    tecnico: "Vulnerabilidad",
    simple: "¿Qué tan probable es que funcione, si lo intentan?",
  },
  vulnFieldHint: {
    tecnico: "probabilidad 0-1 de que el evento se convierta en pérdida",
    simple: "0 = nunca funciona, 1 = siempre funciona",
  },
  lmFieldLabel: {
    tecnico: "Magnitud de pérdida",
    simple: "¿Cuánto te costaría si pasa?",
  },
  lmFieldHint: {
    tecnico: "impacto económico por evento",
    simple: "el costo de un solo incidente",
  },
  scenarioParamFrequency: {
    tecnico: "Frecuencia anual",
    simple: "Qué tan seguido pasaría",
  },
  scenarioParamVulnerability: {
    tecnico: "Vulnerabilidad",
    simple: "Probabilidad de que funcione",
  },
  scenarioParamLossMagnitude: {
    tecnico: "Magnitud de pérdida",
    simple: "Costo si pasa",
  },
  runSimulationButton: {
    tecnico: "Ejecutar simulación Monte Carlo",
    simple: "Ver qué tan probable es que esto me cueste caro",
  },
  aleResultLabel: {
    tecnico: "Pérdida Anual Esperada (ALE)",
    simple: "En promedio, esto te podría costar por año",
  },
  cvarResultLabel: {
    tecnico: "CVaR 95%",
    simple: "Peor 5% de los casos",
  },
  simulatedRangeLabel: {
    tecnico: "Rango simulado",
    simple: "Entre lo mejor y lo peor que vimos",
  },
} as const;

export type LabelKey = keyof typeof LABELS;
