import { Router } from "express";
import { prisma } from "../db.js";
import { runSimulation } from "../fair/simulate.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res) => {
  const scenarios = await prisma.riskScenario.findMany({
    include: { asset: true, threat: true },
    orderBy: { createdAt: "asc" },
  });

  const items = scenarios.map((scenario) => {
    const result = runSimulation({
      threatEventFrequency: { min: scenario.tefMin, mostLikely: scenario.tefMostLikely, max: scenario.tefMax },
      vulnerability: { min: scenario.vulnMin, mostLikely: scenario.vulnMostLikely, max: scenario.vulnMax },
      lossMagnitude: { min: scenario.lmMin, mostLikely: scenario.lmMostLikely, max: scenario.lmMax },
    });

    return {
      id: scenario.id,
      name: scenario.name,
      assetId: scenario.assetId,
      assetName: scenario.asset.name,
      threatId: scenario.threatId,
      threatName: scenario.threat.name,
      ale: result.ale,
      cvar95: result.cvar95,
      // Loss Event Frequency (annual): the "likelihood" axis of a risk matrix — how often
      // the threat event is expected to actually become a loss, not just occur.
      likelihood: scenario.tefMostLikely * scenario.vulnMostLikely,
      // Most-likely per-event impact: the "severity" axis.
      severity: scenario.lmMostLikely,
    };
  });

  const totalAle = items.reduce((sum, item) => sum + item.ale, 0);
  const worstCaseCvar95 = items.reduce((max, item) => Math.max(max, item.cvar95), 0);
  const topRisk = items.reduce<(typeof items)[number] | null>(
    (top, item) => (top === null || item.ale > top.ale ? item : top),
    null,
  );

  res.json({
    scenarios: items,
    totals: {
      scenarioCount: items.length,
      ale: totalAle,
      worstCaseCvar95,
      topRisk,
    },
  });
});
