import type { PertEstimate, RiskScenario, RiskScenarioSummary, SimulationResult } from "./types";
import { request } from "./request";

export interface RiskScenarioInput {
  name: string;
  assetId: string;
  threatId: string;
  threatEventFrequency: PertEstimate;
  vulnerability: PertEstimate;
  lossCategories: { key: string; estimate: PertEstimate }[];
}

export interface SimulateOptions {
  iterations?: number;
  seed?: number;
}

export const riskScenariosApi = {
  listRiskScenarios: () => request<RiskScenarioSummary[]>("/risk-scenarios"),
  getRiskScenario: (id: string) => request<RiskScenarioSummary>(`/risk-scenarios/${id}`),
  createRiskScenario: (input: RiskScenarioInput) =>
    request<RiskScenario>("/risk-scenarios", { method: "POST", body: JSON.stringify(input) }),
  updateRiskScenario: (id: string, input: Partial<RiskScenarioInput>) =>
    request<RiskScenario>(`/risk-scenarios/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteRiskScenario: (id: string) => request<void>(`/risk-scenarios/${id}`, { method: "DELETE" }),
  simulateRiskScenario: (id: string, options: SimulateOptions = {}) =>
    request<SimulationResult>(`/risk-scenarios/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
};
