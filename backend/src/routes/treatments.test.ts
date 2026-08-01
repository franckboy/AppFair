import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { createAsset, createRiskScenario, createThreat } from "../test/fixtures.js";
import { resetDb } from "../test/db.js";

afterEach(resetDb);

async function setupScenario() {
  const asset = await createAsset();
  const threat = await createThreat();
  return createRiskScenario(asset.id, threat.id);
}

describe("treatments routes", () => {
  it("creates a treatment and lists it with an evaluation", async () => {
    const scenario = await setupScenario();

    const created = await request(app)
      .post(`/api/risk-scenarios/${scenario.id}/treatments`)
      .send({ strategy: "MITIGATE", name: "Instalar CCTV", annualCost: 5000, reductionPct: 50 });
    expect(created.status).toBe(201);

    const list = await request(app).get(`/api/risk-scenarios/${scenario.id}/treatments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].evaluation).toMatchObject({
      aleBefore: expect.any(Number),
      aleAfter: expect.any(Number),
      riskReduction: expect.any(Number),
    });
    expect(list.body[0].evaluation.aleAfter).toBeLessThan(list.body[0].evaluation.aleBefore);
  });

  it("rejects MITIGATE/TRANSFER without reductionPct", async () => {
    const scenario = await setupScenario();
    const res = await request(app)
      .post(`/api/risk-scenarios/${scenario.id}/treatments`)
      .send({ strategy: "MITIGATE", name: "Sin reduccion", annualCost: 1000 });
    expect(res.status).toBe(400);
  });

  it("404s listing treatments for a nonexistent scenario", async () => {
    const res = await request(app).get("/api/risk-scenarios/nope/treatments");
    expect(res.status).toBe(404);
  });

  it("updates and deletes a treatment", async () => {
    const scenario = await setupScenario();
    const created = (
      await request(app)
        .post(`/api/risk-scenarios/${scenario.id}/treatments`)
        .send({ strategy: "AVOID", name: "Cerrar sede", annualCost: 10000 })
    ).body;

    const updated = await request(app).patch(`/api/treatments/${created.id}`).send({ annualCost: 20000 });
    expect(updated.status).toBe(200);
    expect(updated.body.annualCost).toBe(20000);

    const deleted = await request(app).delete(`/api/treatments/${created.id}`);
    expect(deleted.status).toBe(204);

    const list = await request(app).get(`/api/risk-scenarios/${scenario.id}/treatments`);
    expect(list.body).toHaveLength(0);
  });
});
