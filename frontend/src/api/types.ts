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
