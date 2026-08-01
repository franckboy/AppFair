/** Request validation for the treatments resource — see riskScenarios.schema.ts for why this lives apart from the routing. */
import { z } from "zod";

export const treatmentBase = z.object({
  strategy: z.enum(["MITIGATE", "TRANSFER", "AVOID", "ACCEPT"]),
  name: z.string().min(1),
  annualCost: z.number().nonnegative(),
  reductionPct: z.number().min(0).max(100).optional(),
});

export const treatmentInput = treatmentBase.refine(
  (t) => (t.strategy === "MITIGATE" || t.strategy === "TRANSFER" ? t.reductionPct !== undefined : true),
  { message: "reductionPct is required for MITIGATE and TRANSFER strategies" },
);
