import { useState } from "react";
import type { RiskScenarioInput } from "../api/client";
import type { Asset, PertEstimate, RiskScenario, Threat } from "../api/types";
import { LOSS_CATEGORIES } from "../fair/lossCategories";
import { useMode } from "../mode/useMode";
import { AttackerDefenseFields } from "./AttackerDefenseFields";
import { LossCategoryFields } from "./LossCategoryFields";
import { PertEstimateInput } from "./PertEstimateInput";

const DEFAULT_TEF: PertEstimate = { min: 1, mostLikely: 3, max: 6 };
const DEFAULT_VULNERABILITY: PertEstimate = { min: 0.05, mostLikely: 0.15, max: 0.3 };
const DEFAULT_LOSS_ESTIMATE: PertEstimate = { min: 1_000, mostLikely: 10_000, max: 50_000 };
const DEFAULT_LOSS_CATEGORIES: Record<string, PertEstimate> = Object.fromEntries(
  LOSS_CATEGORIES.map((c) => [c.key, DEFAULT_LOSS_ESTIMATE]),
);

interface ScenarioFormProps {
  assets: Asset[];
  threats: Threat[];
  /** undefined = create mode. Pass a `key` prop from the parent (e.g. the scenario id, or "new") so React remounts this component — and resets its state — when switching between scenarios. */
  initialScenario?: RiskScenario;
  submitting: boolean;
  onSubmit: (input: RiskScenarioInput) => void;
  onCancel?: () => void;
}

/** Create/edit form for a risk scenario: name + asset/threat + TEF + attacker/defense-derived or manual vulnerability + the 9 loss categories. */
export function ScenarioForm({ assets, threats, initialScenario, submitting, onSubmit, onCancel }: ScenarioFormProps) {
  const { t } = useMode();

  const [name, setName] = useState(initialScenario?.name ?? "");
  const [assetId, setAssetId] = useState(initialScenario?.assetId ?? assets[0]?.id ?? "");
  const [threatId, setThreatId] = useState(initialScenario?.threatId ?? threats[0]?.id ?? "");
  const [tef, setTef] = useState<PertEstimate>(initialScenario?.threatEventFrequency ?? DEFAULT_TEF);
  const [vulnerability, setVulnerability] = useState<PertEstimate>(initialScenario?.vulnerability ?? DEFAULT_VULNERABILITY);
  const [lossCategories, setLossCategories] = useState<Record<string, PertEstimate>>(
    initialScenario ? Object.fromEntries(initialScenario.lossCategories.map((c) => [c.key, c.estimate])) : DEFAULT_LOSS_CATEGORIES,
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      assetId,
      threatId,
      threatEventFrequency: tef,
      vulnerability,
      lossCategories: LOSS_CATEGORIES.map((c) => ({ key: c.key, estimate: lossCategories[c.key] })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="stacked-form">
      <label>
        Nombre del escenario
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Activo
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Amenaza
        <select value={threatId} onChange={(e) => setThreatId(e.target.value)} required>
          {threats.map((threat) => (
            <option key={threat.id} value={threat.id}>
              {threat.name}
            </option>
          ))}
        </select>
      </label>

      <PertEstimateInput label={t("tefFieldLabel")} value={tef} onChange={setTef} min={0} step={0.1} />

      <AttackerDefenseFields onCompute={setVulnerability} />

      <PertEstimateInput
        label={t("vulnFieldLabel")}
        hint={t("vulnFieldHint")}
        value={vulnerability}
        onChange={setVulnerability}
        min={0}
        max={1}
        step={0.01}
      />

      <LossCategoryFields
        label={t("lmFieldLabel")}
        hint={`${t("lmFieldHint")} — una entrada por categoría, se suman por evento`}
        value={lossCategories}
        onChange={(key, estimate) => setLossCategories((prev) => ({ ...prev, [key]: estimate }))}
      />

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : initialScenario ? "Guardar cambios" : "Crear escenario"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
