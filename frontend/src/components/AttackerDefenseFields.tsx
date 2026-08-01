import { useState } from "react";
import type { PertEstimate } from "../api/types";
import {
  ATTACKER_PROFILES,
  CONFIDENCE_LABEL,
  DEFENSE_PROFILES,
  computeVulnerability,
  profileAverage,
  type ConfidenceLevel,
} from "../fair/profiles";

interface AttackerDefenseFieldsProps {
  /** Called with the computed vulnerability estimate when the user clicks "Calcular". Never called automatically — the caller's vulnerability field stays editable/overridable afterward. */
  onCompute: (estimate: PertEstimate) => void;
}

/** Self-contained attacker/defense-profile picker that derives a vulnerability estimate — see fair/profiles.ts for the formula. Owns its own selection state; the parent only receives the computed result. */
export function AttackerDefenseFields({ onCompute }: AttackerDefenseFieldsProps) {
  const [attackerKey, setAttackerKey] = useState(Object.keys(ATTACKER_PROFILES)[0]);
  const [defenseKey, setDefenseKey] = useState(Object.keys(DEFENSE_PROFILES)[0]);
  const [confidence, setConfidence] = useState<ConfidenceLevel>("medio");
  const [explanation, setExplanation] = useState<string | null>(null);

  function handleCompute() {
    const attackerScore = profileAverage(ATTACKER_PROFILES[attackerKey]);
    const defenseScore = profileAverage(DEFENSE_PROFILES[defenseKey]);
    const { explanation: text, ...estimate } = computeVulnerability(attackerScore, defenseScore, confidence);
    setExplanation(text);
    onCompute(estimate);
  }

  return (
    <fieldset className="attacker-defense">
      <legend>Perfil de atacante y defensa (opcional)</legend>
      <p className="hint">Calcula la vulnerabilidad automáticamente en vez de estimarla a mano.</p>
      <label>
        Perfil de atacante
        <select value={attackerKey} onChange={(e) => setAttackerKey(e.target.value)}>
          {Object.entries(ATTACKER_PROFILES).map(([key, profile]) => (
            <option key={key} value={key}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nivel de defensa
        <select value={defenseKey} onChange={(e) => setDefenseKey(e.target.value)}>
          {Object.entries(DEFENSE_PROFILES).map(([key, profile]) => (
            <option key={key} value={key}>
              {profile.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nivel de confianza en la estimación
        <select value={confidence} onChange={(e) => setConfidence(e.target.value as ConfidenceLevel)}>
          {Object.entries(CONFIDENCE_LABEL).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={handleCompute}>
        Calcular vulnerabilidad automáticamente
      </button>
      {explanation && <p className="hint">{explanation}</p>}
    </fieldset>
  );
}
