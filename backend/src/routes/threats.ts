import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

const threatInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export const threatsRouter = Router();

threatsRouter.get("/", async (_req, res) => {
  const threats = await prisma.threat.findMany({ orderBy: { createdAt: "desc" } });
  res.json(threats);
});

threatsRouter.get("/:id", async (req, res) => {
  const threat = await prisma.threat.findUnique({ where: { id: req.params.id } });
  if (!threat) {
    res.status(404).json({ error: "Threat not found" });
    return;
  }
  res.json(threat);
});

threatsRouter.post("/", async (req, res) => {
  const data = threatInput.parse(req.body);
  const threat = await prisma.threat.create({ data });
  res.status(201).json(threat);
});

threatsRouter.patch("/:id", async (req, res) => {
  const data = threatInput.partial().parse(req.body);
  const threat = await prisma.threat.update({ where: { id: req.params.id }, data });
  res.json(threat);
});

threatsRouter.delete("/:id", async (req, res) => {
  await prisma.threat.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
