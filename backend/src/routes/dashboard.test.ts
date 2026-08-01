import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { createAsset, createRiskScenario, createThreat } from "../test/fixtures.js";
import { resetDb } from "../test/db.js";

afterEach(resetDb);

describe("dashboard route", () => {
  it("returns empty scenarios and zeroed totals with no data", async () => {
    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toEqual([]);
    expect(res.body.totals).toMatchObject({ scenarioCount: 0, ale: 0, worstCaseCvar95: 0, topRisk: null });
  });

  it("aggregates a single scenario into totals and identifies it as the top risk", async () => {
    const asset = await createAsset({ name: "Sede" });
    const threat = await createThreat({ name: "Robo" });
    const scenario = await createRiskScenario(asset.id, threat.id, { name: "Escenario único" });

    const res = await request(app).get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.scenarios).toHaveLength(1);
    expect(res.body.scenarios[0]).toMatchObject({ id: scenario.id, assetName: "Sede", threatName: "Robo" });
    expect(res.body.totals.scenarioCount).toBe(1);
    expect(res.body.totals.ale).toBeCloseTo(res.body.scenarios[0].ale, 5);
    expect(res.body.totals.topRisk.id).toBe(scenario.id);
  });
});
