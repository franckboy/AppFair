import type {
  Asset,
  Dashboard,
  PertEstimate,
  RiskScenario,
  SimulationResult,
  Threat,
  Treatment,
  TreatmentStrategy,
  TreatmentWithEvaluation,
} from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AssetInput {
  name: string;
  description?: string;
  value?: number;
}

export interface ThreatInput {
  name: string;
  description?: string;
}

export interface RiskScenarioInput {
  name: string;
  assetId: string;
  threatId: string;
  threatEventFrequency: PertEstimate;
  vulnerability: PertEstimate;
  lossMagnitude: PertEstimate;
}

export interface SimulateOptions {
  iterations?: number;
  seed?: number;
}

export interface TreatmentInput {
  strategy: TreatmentStrategy;
  name: string;
  annualCost: number;
  reductionPct?: number;
}

export const api = {
  listAssets: () => request<Asset[]>("/assets"),
  createAsset: (input: AssetInput) =>
    request<Asset>("/assets", { method: "POST", body: JSON.stringify(input) }),
  updateAsset: (id: string, input: Partial<AssetInput>) =>
    request<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),

  listThreats: () => request<Threat[]>("/threats"),
  createThreat: (input: ThreatInput) =>
    request<Threat>("/threats", { method: "POST", body: JSON.stringify(input) }),
  updateThreat: (id: string, input: Partial<ThreatInput>) =>
    request<Threat>(`/threats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteThreat: (id: string) => request<void>(`/threats/${id}`, { method: "DELETE" }),

  listRiskScenarios: () => request<RiskScenario[]>("/risk-scenarios"),
  getRiskScenario: (id: string) => request<RiskScenario>(`/risk-scenarios/${id}`),
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

  getDashboard: () => request<Dashboard>("/dashboard"),

  listTreatments: (scenarioId: string) => request<TreatmentWithEvaluation[]>(`/risk-scenarios/${scenarioId}/treatments`),
  createTreatment: (scenarioId: string, input: TreatmentInput) =>
    request<Treatment>(`/risk-scenarios/${scenarioId}/treatments`, { method: "POST", body: JSON.stringify(input) }),
  updateTreatment: (id: string, input: Partial<TreatmentInput>) =>
    request<Treatment>(`/treatments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteTreatment: (id: string) => request<void>(`/treatments/${id}`, { method: "DELETE" }),
};
