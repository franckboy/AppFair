import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { evaluateTreatment } from "../fair/treatment.js";
import type { Treatment } from "../generated/prisma/client.js";

const treatmentBase = z.object({
  strategy: z.enum(["MITIGATE", "TRANSFER", "AVOID", "ACCEPT"]),
  name: z.string().min(1),
  annualCost: z.number().nonnegative(),
  reductionPct: z.number().min(0).max(100).optional(),
});

const treatmentInput = treatmentBase.refine(
  (t) => (t.strategy === "MITIGATE" || t.strategy === "TRANSFER" ? t.reductionPct !== undefined : true),
  { message: "reductionPct is required for MITIGATE and TRANSFER strategies" },
);

function toDto(treatment: Treatment) {
  return {
    id: treatment.id,
    riskScenarioId: treatment.riskScenarioId,
    strategy: treatment.strategy,
    name: treatment.name,
    annualCost: treatment.annualCost,
    reductionPct: treatment.reductionPct,
    createdAt: treatment.createdAt,
    updatedAt: treatment.updatedAt,
  };
}

/** Scoped under /api/risk-scenarios/:scenarioId/treatments — list and create. */
export const scenarioTreatmentsRouter = Router({ mergeParams: true });

scenarioTreatmentsRouter.get<{ scenarioId: string }>("/", async (req, res) => {
  const scenario = await prisma.riskScenario.findUnique({ where: { id: req.params.scenarioId } });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }

  const treatments = await prisma.treatment.findMany({
    where: { riskScenarioId: req.params.scenarioId },
    orderBy: { createdAt: "asc" },
  });

  const lossCategories = await prisma.lossCategory.findMany({ where: { riskScenarioId: req.params.scenarioId } });

  const scenarioInput = {
    threatEventFrequency: { min: scenario.tefMin, mostLikely: scenario.tefMostLikely, max: scenario.tefMax },
    vulnerability: { min: scenario.vulnMin, mostLikely: scenario.vulnMostLikely, max: scenario.vulnMax },
    lossMagnitudeCategories: lossCategories.map((c) => ({
      key: c.key,
      estimate: { min: c.min, mostLikely: c.mostLikely, max: c.max },
    })),
  };

  const withEvaluation = treatments.map((treatment) => ({
    ...toDto(treatment),
    evaluation: evaluateTreatment(scenarioInput, {
      strategy: treatment.strategy,
      annualCost: treatment.annualCost,
      reductionPct: treatment.reductionPct ?? undefined,
    }),
  }));

  res.json(withEvaluation);
});

scenarioTreatmentsRouter.post<{ scenarioId: string }>("/", async (req, res) => {
  const input = treatmentInput.parse(req.body);
  const treatment = await prisma.treatment.create({
    data: { ...input, riskScenarioId: req.params.scenarioId },
  });
  res.status(201).json(toDto(treatment));
});

/** Mounted at /api/treatments — update and delete by id, independent of the parent scenario route. */
export const treatmentsRouter = Router();

treatmentsRouter.patch("/:id", async (req, res) => {
  const input = treatmentBase.partial().parse(req.body);
  const treatment = await prisma.treatment.update({ where: { id: req.params.id }, data: input });
  res.json(toDto(treatment));
});

treatmentsRouter.delete("/:id", async (req, res) => {
  await prisma.treatment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
