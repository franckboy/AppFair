import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "../app.js";
import { resetDb } from "../test/db.js";

afterEach(resetDb);

describe("assets routes", () => {
  it("creates and lists an asset", async () => {
    const create = await request(app).post("/api/assets").send({ name: "Data Center", value: 5000 });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: "Data Center", value: 5000 });

    const list = await request(app).get("/api/assets");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("Data Center");
  });

  it("rejects a missing name", async () => {
    const res = await request(app).post("/api/assets").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("updates and deletes an asset", async () => {
    const created = (await request(app).post("/api/assets").send({ name: "X" })).body;

    const updated = await request(app).patch(`/api/assets/${created.id}`).send({ value: 999 });
    expect(updated.status).toBe(200);
    expect(updated.body.value).toBe(999);
    expect(updated.body.name).toBe("X");

    const deleted = await request(app).delete(`/api/assets/${created.id}`);
    expect(deleted.status).toBe(204);

    const list = await request(app).get("/api/assets");
    expect(list.body).toHaveLength(0);
  });

  it("404s on updating a nonexistent asset", async () => {
    const res = await request(app).patch("/api/assets/does-not-exist").send({ name: "Y" });
    expect(res.status).toBe(404);
  });
});
