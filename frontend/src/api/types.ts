export interface Asset {
  id: string;
  name: string;
  description: string | null;
  value: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Threat {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PertEstimate {
  min: number;
  mostLikely: number;
  max: number;
}

export interface RiskScenario {
  id: string;
  name: string;
  assetId: string;
  threatId: string;
  threatEventFrequency: PertEstimate;
  vulnerability: PertEstimate;
  lossMagnitude: PertEstimate;
  createdAt: string;
  updatedAt: string;
}

/** GET list/detail responses add a freshly-simulated ALE (create/update via `RiskScenario` don't). */
export interface RiskScenarioSummary extends RiskScenario {
  ale: number;
}

export interface SimulationResult {
  ale: number;
  percentiles: {
    p10: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  cvar95: number;
  min: number;
  max: number;
  iterations: number;
}

export interface DashboardScenarioSummary {
  id: string;
  name: string;
  assetId: string;
  assetName: string;
  threatId: string;
  threatName: string;
  ale: number;
  cvar95: number;
  likelihood: number;
  severity: number;
}

export interface Dashboard {
  scenarios: DashboardScenarioSummary[];
  totals: {
    scenarioCount: number;
    ale: number;
    worstCaseCvar95: number;
    topRisk: DashboardScenarioSummary | null;
  };
}

export type TreatmentStrategy = "MITIGATE" | "TRANSFER" | "AVOID" | "ACCEPT";

export interface Treatment {
  id: string;
  riskScenarioId: string;
  strategy: TreatmentStrategy;
  name: string;
  annualCost: number;
  reductionPct: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentEvaluation {
  aleBefore: number;
  aleAfter: number;
  riskReduction: number;
  /** (risk reduction - annual cost) / annual cost; null when annualCost is 0. */
  rosi: number | null;
}

export interface TreatmentWithEvaluation extends Treatment {
  evaluation: TreatmentEvaluation;
}
