/**
 * HTTP routing for the risk-scenarios resource only — request/response validation
 * lives in riskScenarios.schema.ts, DB<->API shape translation in
 * riskScenarios.mapping.ts. A handler here should read as "validate, hit Prisma,
 * map, respond"; if it's doing more than that, that logic likely belongs in one
 * of the other two files instead.
 */
import { Router } from "express";
import { prisma } from "../db.js";
import { LOSS_CATEGORY_LABEL } from "../fair/lossCategories.js";
import { computeSensitivity } from "../fair/sensitivity.js";
import { runSimulation } from "../fair/simulate.js";
import { scalarFields, toDto, toEngineInput, withAle } from "./riskScenarios.mapping.js";
import { riskScenarioInput, simulateOptions } from "./riskScenarios.schema.js";

export const riskScenariosRouter = Router();

riskScenariosRouter.get("/", async (_req, res) => {
  const scenarios = await prisma.riskScenario.findMany({
    include: { lossCategories: true },
    orderBy: { createdAt: "desc" },
  });
  res.json(scenarios.map(toDto).map(withAle));
});

riskScenariosRouter.get("/:id", async (req, res) => {
  const scenario = await prisma.riskScenario.findUnique({
    where: { id: req.params.id },
    include: { lossCategories: true },
  });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }
  res.json(withAle(toDto(scenario)));
});

riskScenariosRouter.post("/", async (req, res) => {
  const input = riskScenarioInput.parse(req.body);
  const scenario = await prisma.riskScenario.create({
    data: {
      name: input.name,
      assetId: input.assetId,
      threatId: input.threatId,
      tefMin: input.threatEventFrequency.min,
      tefMostLikely: input.threatEventFrequency.mostLikely,
      tefMax: input.threatEventFrequency.max,
      vulnMin: input.vulnerability.min,
      vulnMostLikely: input.vulnerability.mostLikely,
      vulnMax: input.vulnerability.max,
      lossCategories: {
        create: input.lossCategories.map((c) => ({
          key: c.key,
          min: c.estimate.min,
          mostLikely: c.estimate.mostLikely,
          max: c.estimate.max,
        })),
      },
    },
    include: { lossCategories: true },
  });
  res.status(201).json(toDto(scenario));
});

riskScenariosRouter.patch("/:id", async (req, res) => {
  const input = riskScenarioInput.partial().parse(req.body);
  const { lossCategories, ...rest } = input;

  const scenario = await prisma.$transaction(async (tx) => {
    if (lossCategories) {
      await tx.lossCategory.deleteMany({ where: { riskScenarioId: req.params.id } });
      await tx.lossCategory.createMany({
        data: lossCategories.map((c) => ({
          riskScenarioId: req.params.id,
          key: c.key,
          min: c.estimate.min,
          mostLikely: c.estimate.mostLikely,
          max: c.estimate.max,
        })),
      });
    }
    return tx.riskScenario.update({
      where: { id: req.params.id },
      data: scalarFields(rest),
      include: { lossCategories: true },
    });
  });

  res.json(toDto(scenario));
});

riskScenariosRouter.delete("/:id", async (req, res) => {
  await prisma.riskScenario.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

riskScenariosRouter.post("/:id/simulate", async (req, res) => {
  const options = simulateOptions.parse(req.body ?? {});
  const scenario = await prisma.riskScenario.findUnique({
    where: { id: req.params.id },
    include: { lossCategories: true },
  });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }

  const dto = toDto(scenario);
  const result = runSimulation(toEngineInput(dto), { ...options, trackFactors: true });

  const sensitivity = result.factorSamples
    ? computeSensitivity(result.factorSamples, LOSS_CATEGORY_LABEL, result.losses!)
    : undefined;

  res.json({ ...result, sensitivity, factorSamples: undefined, losses: undefined });
});
