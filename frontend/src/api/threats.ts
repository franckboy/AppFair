import type { Threat } from "./types";
import { request } from "./request";

export interface ThreatInput {
  name: string;
  description?: string;
}

export const threatsApi = {
  listThreats: () => request<Threat[]>("/threats"),
  createThreat: (input: ThreatInput) => request<Threat>("/threats", { method: "POST", body: JSON.stringify(input) }),
  updateThreat: (id: string, input: Partial<ThreatInput>) =>
    request<Threat>(`/threats/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteThreat: (id: string) => request<void>(`/threats/${id}`, { method: "DELETE" }),
};
