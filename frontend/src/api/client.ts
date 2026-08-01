import type { Asset, PertEstimate, RiskScenario, SimulationResult, Threat } from "./types";

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

export const api = {
  listAssets: () => request<Asset[]>("/assets"),
  createAsset: (input: AssetInput) =>
    request<Asset>("/assets", { method: "POST", body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),

  listThreats: () => request<Threat[]>("/threats"),
  createThreat: (input: ThreatInput) =>
    request<Threat>("/threats", { method: "POST", body: JSON.stringify(input) }),
  deleteThreat: (id: string) => request<void>(`/threats/${id}`, { method: "DELETE" }),

  listRiskScenarios: () => request<RiskScenario[]>("/risk-scenarios"),
  getRiskScenario: (id: string) => request<RiskScenario>(`/risk-scenarios/${id}`),
  createRiskScenario: (input: RiskScenarioInput) =>
    request<RiskScenario>("/risk-scenarios", { method: "POST", body: JSON.stringify(input) }),
  deleteRiskScenario: (id: string) => request<void>(`/risk-scenarios/${id}`, { method: "DELETE" }),
  simulateRiskScenario: (id: string, options: SimulateOptions = {}) =>
    request<SimulationResult>(`/risk-scenarios/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
};
