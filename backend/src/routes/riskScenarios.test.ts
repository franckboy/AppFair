import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { LOSS_CATEGORY_KEYS } from "../fair/lossCategories.js";
import { createAsset, createRiskScenario, createThreat, fullLossCategories } from "../test/fixtures.js";
import { resetDb } from "../test/db.js";

afterEach(resetDb);

describe("risk-scenarios routes", () => {
  it("creates a scenario with all 9 categories and includes them on GET", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const scenario = await createRiskScenario(asset.id, threat.id);

    expect(scenario.lossCategories).toHaveLength(LOSS_CATEGORY_KEYS.length);

    const fetched = await request(app).get(`/api/risk-scenarios/${scenario.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.lossCategories.map((c: { key: string }) => c.key).sort()).toEqual([...LOSS_CATEGORY_KEYS].sort());
    expect(typeof fetched.body.ale).toBe("number");
  });

  it("rejects a scenario missing a loss category", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const incomplete = fullLossCategories().slice(0, 3);

    const res = await request(app)
      .post("/api/risk-scenarios")
      .send({
        name: "Incompleto",
        assetId: asset.id,
        threatId: threat.id,
        threatEventFrequency: { min: 1, mostLikely: 3, max: 6 },
        vulnerability: { min: 0.1, mostLikely: 0.2, max: 0.4 },
        lossCategories: incomplete,
      });

    expect(res.status).toBe(400);
  });

  it("rejects vulnerability outside [0, 1]", async () => {
    const asset = await createAsset();
    const threat = await createThreat();

    const res = await request(app)
      .post("/api/risk-scenarios")
      .send({
        name: "Vuln inválida",
        assetId: asset.id,
        threatId: threat.id,
        threatEventFrequency: { min: 1, mostLikely: 3, max: 6 },
        vulnerability: { min: 0.1, mostLikely: 0.2, max: 1.5 },
        lossCategories: fullLossCategories(),
      });

    expect(res.status).toBe(400);
  });

  it("rejects an unknown assetId with a 400, not a 500", async () => {
    const threat = await createThreat();
    const res = await request(app)
      .post("/api/risk-scenarios")
      .send({
        name: "Activo inexistente",
        assetId: "does-not-exist",
        threatId: threat.id,
        threatEventFrequency: { min: 1, mostLikely: 3, max: 6 },
        vulnerability: { min: 0.1, mostLikely: 0.2, max: 0.4 },
        lossCategories: fullLossCategories(),
      });
    expect(res.status).toBe(400);
  });

  it("404s on a nonexistent scenario", async () => {
    expect((await request(app).get("/api/risk-scenarios/nope")).status).toBe(404);
  });

  it("partially updates scalar fields without touching loss categories", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const scenario = await createRiskScenario(asset.id, threat.id);

    const updated = await request(app).patch(`/api/risk-scenarios/${scenario.id}`).send({ name: "Nuevo nombre" });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Nuevo nombre");
    expect(updated.body.lossCategories).toHaveLength(LOSS_CATEGORY_KEYS.length);
  });

  it("replaces the whole loss-category set when provided in a PATCH", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const scenario = await createRiskScenario(asset.id, threat.id);

    const newCategories = fullLossCategories({ productividad: { min: 1, mostLikely: 2, max: 3 } });
    const updated = await request(app)
      .patch(`/api/risk-scenarios/${scenario.id}`)
      .send({ lossCategories: newCategories });

    expect(updated.status).toBe(200);
    const productividad = updated.body.lossCategories.find((c: { key: string }) => c.key === "productividad");
    expect(productividad.estimate).toEqual({ min: 1, mostLikely: 2, max: 3 });
  });

  it("deletes a scenario that still has loss categories and treatments (cascade)", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const scenario = await createRiskScenario(asset.id, threat.id);
    await request(app)
      .post(`/api/risk-scenarios/${scenario.id}/treatments`)
      .send({ strategy: "ACCEPT", name: "Aceptar", annualCost: 0 });

    const deleted = await request(app).delete(`/api/risk-scenarios/${scenario.id}`);
    expect(deleted.status).toBe(204);
  });

  it("simulates and returns sensitivity ranked by |correlation|", async () => {
    const asset = await createAsset();
    const threat = await createThreat();
    const scenario = await createRiskScenario(asset.id, threat.id);

    const result = await request(app)
      .post(`/api/risk-scenarios/${scenario.id}/simulate`)
      .send({ iterations: 2000, seed: 42 });

    expect(result.status).toBe(200);
    expect(typeof result.body.ale).toBe("number");
    expect(result.body.factorSamples).toBeUndefined();
    expect(result.body.losses).toBeUndefined();
    expect(Array.isArray(result.body.sensitivity)).toBe(true);
    expect(result.body.sensitivity.length).toBeGreaterThan(0);
    const correlations = result.body.sensitivity.map((f: { correlation: number }) => Math.abs(f.correlation));
    const sorted = [...correlations].sort((a, b) => b - a);
    expect(correlations).toEqual(sorted);
  });
});
