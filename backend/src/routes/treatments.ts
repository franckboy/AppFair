/** HTTP routing for the treatments resource only — see riskScenarios.ts for the same split rationale. */
import { Router } from "express";
import { prisma } from "../db.js";
import { evaluateTreatment } from "../fair/treatment.js";
import { toDto as toScenarioDto, toEngineInput } from "./riskScenarios.mapping.js";
import { toDto } from "./treatments.mapping.js";
import { treatmentBase, treatmentInput } from "./treatments.schema.js";

/** Scoped under /api/risk-scenarios/:scenarioId/treatments — list and create. */
export const scenarioTreatmentsRouter = Router({ mergeParams: true });

scenarioTreatmentsRouter.get<{ scenarioId: string }>("/", async (req, res) => {
  const scenario = await prisma.riskScenario.findUnique({
    where: { id: req.params.scenarioId },
    include: { lossCategories: true },
  });
  if (!scenario) {
    res.status(404).json({ error: "Risk scenario not found" });
    return;
  }

  const treatments = await prisma.treatment.findMany({
    where: { riskScenarioId: req.params.scenarioId },
    orderBy: { createdAt: "asc" },
  });

  const scenarioInput = toEngineInput(toScenarioDto(scenario));

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
