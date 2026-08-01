import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { LOSS_CATEGORY_KEYS, LOSS_CATEGORY_LABEL, type LossCategoryKey } from "../fair/lossCategories.js";
import { computeSensitivity } from "../fair/sensitivity.js";
import { runSimulation } from "../fair/simulate.js";
import type { LossCategory, RiskScenario } from "../generated/prisma/client.js";

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

/** Every scenario carries exactly the fixed set of loss categories (see fair/lossCategories.ts) — no more, no fewer. */
const lossCategoriesInput = z
  .array(z.object({ key: z.enum(LOSS_CATEGORY_KEYS as [LossCategoryKey, ...LossCategoryKey[]]), estimate: nonNegativePertEstimate }))
  .refine(
    (categories) => {
      const keys = new Set(categories.map((c) => c.key));
      return keys.size === LOSS_CATEGORY_KEYS.length && LOSS_CATEGORY_KEYS.every((k) => keys.has(k));
    },
    { message: `must include exactly these categories: ${LOSS_CATEGORY_KEYS.join(", ")}` },
  );

const riskScenarioInput = z.object({
  name: z.string().min(1),
  assetId: z.string().min(1),
  threatId: z.string().min(1),
  threatEventFrequency: nonNegativePertEstimate,
  vulnerability: probabilityPertEstimate,
  lossCategories: lossCategoriesInput,
});

const simulateOptions = z.object({
  iterations: z.number().int().positive().max(200_000).optional(),
  seed: z.number().int().optional(),
});

type RiskScenarioWithCategories = RiskScenario & { lossCategories: LossCategory[] };

/** Maps the flat Prisma columns + related rows to the nested shape the API and the FAIR engine use. */
function toDto(scenario: RiskScenarioWithCategories) {
  return {
    id: scenario.id,
    name: scenario.name,
    assetId: scenario.assetId,
    threatId: scenario.threatId,
    threatEventFrequency: { min: scenario.tefMin, mostLikely: scenario.tefMostLikely, max: scenario.tefMax },
    vulnerability: { min: scenario.vulnMin, mostLikely: scenario.vulnMostLikely, max: scenario.vulnMax },
    lossCategories: scenario.lossCategories.map((c) => ({
      key: c.key,
      label: LOSS_CATEGORY_LABEL[c.key as LossCategoryKey] ?? c.key,
      estimate: { min: c.min, mostLikely: c.mostLikely, max: c.max },
    })),
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}

type RiskScenarioInput = z.infer<typeof riskScenarioInput>;

function scalarFields(input: Partial<RiskScenarioInput>) {
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
  return data;
}

function toEngineInput(dto: ReturnType<typeof toDto>) {
  return {
    threatEventFrequency: dto.threatEventFrequency,
    vulnerability: dto.vulnerability,
    lossMagnitudeCategories: dto.lossCategories.map((c) => ({ key: c.key, estimate: c.estimate })),
  };
}

/** Adds a freshly-simulated ALE to a scenario DTO — used only by the list/detail GETs, where UI shows a criticality badge next to the scenario, not by create/update. */
function withAle(dto: ReturnType<typeof toDto>) {
  const { ale } = runSimulation(toEngineInput(dto));
  return { ...dto, ale };
}

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
