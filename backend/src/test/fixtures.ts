import request from "supertest";
import { app } from "../app.js";
import { LOSS_CATEGORY_KEYS } from "../fair/lossCategories.js";

export async function createAsset(overrides: Partial<{ name: string; value: number }> = {}) {
  const res = await request(app)
    .post("/api/assets")
    .send({ name: "Test Asset", ...overrides });
  return res.body;
}

export async function createThreat(overrides: Partial<{ name: string }> = {}) {
  const res = await request(app)
    .post("/api/threats")
    .send({ name: "Test Threat", ...overrides });
  return res.body;
}

/** Every one of the fixed loss categories, all at the same estimate unless overridden by key. */
export function fullLossCategories(overrides: Record<string, { min: number; mostLikely: number; max: number }> = {}) {
  return LOSS_CATEGORY_KEYS.map((key) => ({
    key,
    estimate: overrides[key] ?? { min: 1_000, mostLikely: 5_000, max: 20_000 },
  }));
}

export async function createRiskScenario(
  assetId: string,
  threatId: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post("/api/risk-scenarios")
    .send({
      name: "Test Scenario",
      assetId,
      threatId,
      threatEventFrequency: { min: 1, mostLikely: 3, max: 6 },
      vulnerability: { min: 0.1, mostLikely: 0.2, max: 0.4 },
      lossCategories: fullLossCategories(),
      ...overrides,
    });
  return res.body;
}
