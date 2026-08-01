import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { runSimulation } from "../fair/simulate.js";
import type { RiskScenario } from "../generated/prisma/client.js";

const pertEstimate = z
  .object({
    min: z.number(),
    mostLikely: z.number(),
    max: z.number(),
  })
  .refine((p) => p.min <= p.mostLikely && p.mostLikely <= p.max, {
    message: "must satisfy min <= mostLikely <= max",
  });

const nonNegativePertEstimate = pertEstimate.refine((p) => p.min >= 0, {
  message: "must be non-negative",
});

const probabilityPertEstimate = pertEstimate.refine((p) => p.min >= 0 && p.max <= 1, {
  message: "must be within [0, 1]",
});

const riskScenarioInput = z.object({
  name: z.string().min(1),
  assetId: z.string().min(1),
  threatId: z.string().min(1),
  threatEventFrequency: nonNegativePertEstimate,
  vulnerability: probabilityPertEstimate,
  lossMagnitude: nonNegativePertEstimate,
});

const simulateOptions = z.object({
  iterations: z.number().int().positive().max(200_000).optional(),
  seed: z.number().int().optional(),
});

/** Maps the flat Prisma columns to the nested PERT-estimate shape the API and the FAIR engine use. */
function toDto(scenario: RiskScenario) {
  return {
    id: scenario.id,
    name: scenario.name,
    assetId: scenario.assetId,
    threatId: scenario.threatId,
    threatEventFrequency: { min: scenario.tefMin, mostLikely: scenario.tefMostLikely, max: scenario.tefMax },
    vulnerability: { min: scenario.vulnMin, mostLikely: scenario.vulnMostLikely, max: scenario.vulnMax },
    lossMagnitude: { min: scenario.lmMin, mostLikely: scenario.lmMostLikely, max: scenario.lmMax },
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}

type RiskScenarioInput = z.infer<typeof riskScenarioInput>;

function toPrismaData(input: RiskScenarioInput) {
  return {
    name: input.name,
    assetId: input.assetId,
    threatId: input.threatId,
    tefMin: input.threatEventFrequency.min,
    tefMostLikely: input.threatEventFrequency.mostLikely,
    tefMax: input.threatEventFrequency.max,
    vulnMin: input.vulnerability.min,
    vulnMostLikely: input.vulnerability.mostLikely,
    vulnMax: input.vulnerability.max,
    lmMin: input.lossMagnitude.min,
    lmMostLikely: input.lossMagnitude.mostLikely,
    lmMax: input.lossMagnitude.max,
  };
}

/** Only includes columns for the fields present in a partial update; each PERT estimate is replaced as a whole. */
function toPrismaUpdateData(input: Partial<RiskScenarioInput>) {
  const data: Record<string, string | number> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.assetId !== undefined) data.assetId = input.assetId;
  if (input.threatId !== undefined) data.threatId = input.threatId;
  if (input.threatEventFrequency) {
    data.tefMin = input.threatEventFrequency.min;
    data.tefMostLikely = input.threatEventFrequency.mostLikely;
    data.tefMax = input.threatEventFrequency.max;
  }
  if (input.vulnerability) {
    data.vulnMin = input.vulnerability.min;
    data.vulnMostLikely = input.vulnerability.mostLikely;
    data.vulnMax = input.vulnerability.max;
  }
  if (input.lossMagnitude) {
    data.lmMin = input.lossMagnitude.min;
    data.lmMostLikely = input.lossMagnitude.mostLikely;
    data.lmMax = input.lossMagnitude.max;
  }
  return data;
}

export const riskScenariosRouter = Router();

riskScenariosRouter.get("/", async (_req, res) => {
  const scenarios = await prisma.riskScenario.findMany({ orderBy: { createdAt: "desc" } });
  res.json(scenarios.map(toDto));
});

riskScenariosRouter.get("/:id", async (req, res) => {
  const scenario = await prisma.riskScenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }
  res.json(toDto(scenario));
});

riskScenariosRouter.post("/", async (req, res) => {
  const input = riskScenarioInput.parse(req.body);
  const scenario = await prisma.riskScenario.create({ data: toPrismaData(input) });
  res.status(201).json(toDto(scenario));
});

riskScenariosRouter.patch("/:id", async (req, res) => {
  const input = riskScenarioInput.partial().parse(req.body);
  const scenario = await prisma.riskScenario.update({
    where: { id: req.params.id },
    data: toPrismaUpdateData(input),
  });
  res.json(toDto(scenario));
});

riskScenariosRouter.delete("/:id", async (req, res) => {
  await prisma.riskScenario.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

riskScenariosRouter.post("/:id/simulate", async (req, res) => {
  const options = simulateOptions.parse(req.body ?? {});
  const scenario = await prisma.riskScenario.findUnique({ where: { id: req.params.id } });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }

  const dto = toDto(scenario);
  const result = runSimulation(
    {
      threatEventFrequency: dto.threatEventFrequency,
      vulnerability: dto.vulnerability,
      lossMagnitude: dto.lossMagnitude,
    },
    options,
  );

  res.json(result);
});
