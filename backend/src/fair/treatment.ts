import { runSimulation, type PertEstimate, type RiskScenarioInput, type SimulationOptions } from "./simulate.js";

export type TreatmentStrategy = "MITIGATE" | "TRANSFER" | "AVOID" | "ACCEPT";

export interface TreatmentInput {
  strategy: TreatmentStrategy;
  annualCost: number;
  /**
   * MITIGATE: % reduction applied to vulnerability (fewer threat events become loss events).
   * TRANSFER: % of each loss event's magnitude covered by a third party (e.g. insurance).
   * Ignored for AVOID (risk eliminated) and ACCEPT (unchanged).
   */
  reductionPct?: number;
}

export interface TreatmentEvaluation {
  aleBefore: number;
  aleAfter: number;
  riskReduction: number;
  /** (risk reduction - annual cost) / annual cost. null when annualCost is 0 (ACCEPT's baseline). */
  rosi: number | null;
}

function scalePert(estimate: PertEstimate, factor: number): PertEstimate {
  return {
    min: estimate.min * factor,
    mostLikely: estimate.mostLikely * factor,
    max: estimate.max * factor,
  };
}

function applyTreatment(scenario: RiskScenarioInput, treatment: TreatmentInput): RiskScenarioInput {
  const factor = 1 - (treatment.reductionPct ?? 0) / 100;
  switch (treatment.strategy) {
    case "MITIGATE":
      return { ...scenario, vulnerability: scalePert(scenario.vulnerability, factor) };
    case "TRANSFER":
      return { ...scenario, lossMagnitude: scalePert(scenario.lossMagnitude, factor) };
    case "ACCEPT":
    case "AVOID":
      return scenario;
  }
}

/**
 * Compares a scenario's baseline ALE against its ALE with a treatment applied, and
 * derives ROSI. Before/after share one seed (common random numbers) so the comparison
 * isn't muddied by independent Monte Carlo noise between the two runs.
 */
export function evaluateTreatment(
  scenario: RiskScenarioInput,
  treatment: TreatmentInput,
  options: SimulationOptions = {},
): TreatmentEvaluation {
  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const before = runSimulation(scenario, { ...options, seed });
  const aleAfter =
    treatment.strategy === "AVOID" ? 0 : runSimulation(applyTreatment(scenario, treatment), { ...options, seed }).ale;

  const riskReduction = before.ale - aleAfter;
  const rosi = treatment.annualCost > 0 ? (riskReduction - treatment.annualCost) / treatment.annualCost : null;

  return {
    aleBefore: before.ale,
    aleAfter,
    riskReduction,
    rosi,
  };
}
