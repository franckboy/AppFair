/**
 * Request validation for the risk-scenarios resource. Kept separate from
 * riskScenarios.ts (HTTP routing) and riskScenarios.mapping.ts (DB <-> API shape
 * translation) so a new input rule doesn't require reading the route handlers,
 * and vice versa.
 */
import { z } from "zod";
import { LOSS_CATEGORY_KEYS, type LossCategoryKey } from "../fair/lossCategories.js";

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

export const riskScenarioInput = z.object({
  name: z.string().min(1),
  assetId: z.string().min(1),
  threatId: z.string().min(1),
  threatEventFrequency: nonNegativePertEstimate,
  vulnerability: probabilityPertEstimate,
  lossCategories: lossCategoriesInput,
});

export type RiskScenarioInput = z.infer<typeof riskScenarioInput>;

export const simulateOptions = z.object({
  iterations: z.number().int().positive().max(200_000).optional(),
  seed: z.number().int().optional(),
});
