/**
 * Attacker/defense presets and confidence-driven range spread, ported from the
 * original prototype: instead of typing a vulnerability range by hand, pick two
 * reusable profiles (a score 0-100 each, averaged from their named factors) and a
 * confidence level, and vulnerability's min/mostLikely/max derive automatically —
 * see computeVulnerability() below.
 */

export interface Profile {
  name: string;
  factors: Record<string, number>;
}

export const ATTACKER_PROFILES: Record<string, Profile> = {
  oportunista: {
    name: "Intruso Oportunista",
    factors: { motivacion: 30, recursos: 10, capacidad: 20, persistencia: 20, sofisticacion: 10 },
  },
  vandalismo: {
    name: "Vandalismo / Hurtos Comunes",
    factors: { motivacion: 70, recursos: 40, capacidad: 50, persistencia: 60, sofisticacion: 40 },
  },
  "empleado-desleal": {
    name: "Empleado Desleal",
    factors: { motivacion: 80, recursos: 60, capacidad: 70, persistencia: 70, sofisticacion: 60 },
  },
  organizado: {
    name: "Grupo Criminal Organizado",
    factors: { motivacion: 60, recursos: 60, capacidad: 60, persistencia: 40, sofisticacion: 50 },
  },
  "estado-nacion": {
    name: "Terrorista o Espía",
    factors: { motivacion: 90, recursos: 90, capacidad: 90, persistencia: 90, sofisticacion: 90 },
  },
};

export const DEFENSE_PROFILES: Record<string, Profile> = {
  basica: {
    name: "Básica",
    factors: { adaptabilidad: 20, respuesta: 30, prevencion: 30, deteccion: 30, contencion: 20, recuperacion: 30 },
  },
  estandar: {
    name: "Estándar",
    factors: { adaptabilidad: 50, respuesta: 50, prevencion: 60, deteccion: 60, contencion: 50, recuperacion: 60 },
  },
  avanzada: {
    name: "Avanzada",
    factors: { adaptabilidad: 70, respuesta: 70, prevencion: 75, deteccion: 80, contencion: 70, recuperacion: 75 },
  },
  elite: {
    name: "Defensa Élite",
    factors: { adaptabilidad: 90, respuesta: 90, prevencion: 90, deteccion: 95, contencion: 90, recuperacion: 90 },
  },
};

export type ConfidenceLevel = "alto" | "medio" | "bajo";

export const CONFIDENCE_SPREAD: Record<ConfidenceLevel, { min: number; max: number }> = {
  alto: { min: 0.85, max: 1.15 },
  medio: { min: 0.6, max: 1.4 },
  bajo: { min: 0.35, max: 1.8 },
};

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  alto: "Alta",
  medio: "Media",
  bajo: "Baja",
};

export function profileAverage(profile: Profile): number {
  const values = Object.values(profile.factors);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Vulnerability = attacker capability vs. defense strength (FAIR: Threat Capability
 * vs. Resistance Strength), not a number the user has to guess. Returns min/mostLikely/max
 * as 0-1 probabilities (this app's vulnerability unit), with the range width set by
 * confidence — low confidence in the estimate widens the range.
 */
export function computeVulnerability(
  attackerScore: number,
  defenseScore: number,
  confidence: ConfidenceLevel,
): { min: number; mostLikely: number; max: number; explanation: string } {
  const spread = CONFIDENCE_SPREAD[confidence];
  const modePct = Math.min(99, Math.max(1, Math.round(attackerScore * (1 - defenseScore / 100))));
  const minPct = Math.max(0, Math.round(modePct * spread.min));
  const maxPct = Math.min(100, Math.round(modePct * spread.max));

  return {
    min: minPct / 100,
    mostLikely: modePct / 100,
    max: maxPct / 100,
    explanation: `Calculado como: Factor de Amenaza (${attackerScore.toFixed(0)}%) × [1 − Nivel de Defensa (${defenseScore.toFixed(0)}%)] = ${modePct}%. Rango según Nivel de Confianza (${CONFIDENCE_LABEL[confidence]}).`,
  };
}
