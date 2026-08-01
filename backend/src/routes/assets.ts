import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

const assetInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  value: z.number().nonnegative().optional(),
});

export const assetsRouter = Router();

assetsRouter.get("/", async (_req, res) => {
  const assets = await prisma.asset.findMany({ orderBy: { createdAt: "desc" } });
  res.json(assets);
});

assetsRouter.get("/:id", async (req, res) => {
  const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  res.json(asset);
});

assetsRouter.post("/", async (req, res) => {
  const data = assetInput.parse(req.body);
  const asset = await prisma.asset.create({ data });
  res.status(201).json(asset);
});

assetsRouter.patch("/:id", async (req, res) => {
  const data = assetInput.partial().parse(req.body);
  const asset = await prisma.asset.update({ where: { id: req.params.id }, data });
  res.json(asset);
});

assetsRouter.delete("/:id", async (req, res) => {
  await prisma.asset.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
