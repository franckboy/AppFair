import type { PertEstimate } from "../api/types";
import { LOSS_CATEGORIES } from "../fair/lossCategories";
import { PertEstimateInput } from "./PertEstimateInput";

interface LossCategoryFieldsProps {
  label: string;
  hint: string;
  value: Record<string, PertEstimate>;
  onChange: (key: string, estimate: PertEstimate) => void;
}

/** One PertEstimateInput per fixed loss category (see fair/lossCategories.ts) — the categories a single loss event sums across. */
export function LossCategoryFields({ label, hint, value, onChange }: LossCategoryFieldsProps) {
  return (
    <fieldset className="loss-categories">
      <legend>{label}</legend>
      <p className="hint">{hint}</p>
      {LOSS_CATEGORIES.map((category) => (
        <PertEstimateInput
          key={category.key}
          label={category.label}
          value={value[category.key]}
          onChange={(v) => onChange(category.key, v)}
          min={0}
        />
      ))}
    </fieldset>
  );
}
