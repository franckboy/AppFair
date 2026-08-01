import type { PertEstimate } from "../api/types";

interface PertEstimateInputProps {
  label: string;
  hint?: string;
  value: PertEstimate;
  onChange: (value: PertEstimate) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function PertEstimateInput({ label, hint, value, onChange, min, max, step = 1 }: PertEstimateInputProps) {
  function setField(field: keyof PertEstimate, raw: string) {
    onChange({ ...value, [field]: raw === "" ? 0 : Number(raw) });
  }

  return (
    <fieldset className="pert-input">
      <legend>
        {label}
        {hint && <span className="hint"> — {hint}</span>}
      </legend>
      <label>
        Mínimo
        <input
          type="number"
          value={value.min}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setField("min", e.target.value)}
        />
      </label>
      <label>
        Más probable
        <input
          type="number"
          value={value.mostLikely}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setField("mostLikely", e.target.value)}
        />
      </label>
      <label>
        Máximo
        <input
          type="number"
          value={value.max}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setField("max", e.target.value)}
        />
      </label>
    </fieldset>
  );
}
