import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { resetDb } from "../test/db.js";

afterEach(resetDb);

describe("threats routes", () => {
  it("creates, lists, updates, and deletes a threat", async () => {
    const created = (await request(app).post("/api/threats").send({ name: "Robo" })).body;
    expect(created.name).toBe("Robo");

    const list = await request(app).get("/api/threats");
    expect(list.body).toHaveLength(1);

    const updated = await request(app).patch(`/api/threats/${created.id}`).send({ description: "Con violencia" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("Con violencia");

    const deleted = await request(app).delete(`/api/threats/${created.id}`);
    expect(deleted.status).toBe(204);
    expect((await request(app).get("/api/threats")).body).toHaveLength(0);
  });

  it("rejects a missing name", async () => {
    const res = await request(app).post("/api/threats").send({});
    expect(res.status).toBe(400);
  });
});
