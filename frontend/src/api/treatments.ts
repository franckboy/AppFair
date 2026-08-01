import type { Treatment, TreatmentStrategy, TreatmentWithEvaluation } from "./types";
import { request } from "./request";

export interface TreatmentInput {
  strategy: TreatmentStrategy;
  name: string;
  annualCost: number;
  reductionPct?: number;
}

export const treatmentsApi = {
  listTreatments: (scenarioId: string) =>
    request<TreatmentWithEvaluation[]>(`/risk-scenarios/${scenarioId}/treatments`),
  createTreatment: (scenarioId: string, input: TreatmentInput) =>
    request<Treatment>(`/risk-scenarios/${scenarioId}/treatments`, { method: "POST", body: JSON.stringify(input) }),
  updateTreatment: (id: string, input: Partial<TreatmentInput>) =>
    request<Treatment>(`/treatments/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteTreatment: (id: string) => request<void>(`/treatments/${id}`, { method: "DELETE" }),
};
