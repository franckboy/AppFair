import type { Asset } from "./types";
import { request } from "./request";

export interface AssetInput {
  name: string;
  description?: string;
  value?: number;
}

export const assetsApi = {
  listAssets: () => request<Asset[]>("/assets"),
  createAsset: (input: AssetInput) => request<Asset>("/assets", { method: "POST", body: JSON.stringify(input) }),
  updateAsset: (id: string, input: Partial<AssetInput>) =>
    request<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),
};
