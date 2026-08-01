import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Asset, PertEstimate, RiskScenario, RiskScenarioSummary, Threat } from "../api/types";
import { PertEstimateInput } from "../components/PertEstimateInput";
import { RiskBadge } from "../components/RiskBadge";
import { riskLevelForAle } from "../components/statusScale";
import { LOSS_CATEGORIES } from "../fair/lossCategories";
import {
  ATTACKER_PROFILES,
  CONFIDENCE_LABEL,
  DEFENSE_PROFILES,
  computeVulnerability,
  profileAverage,
  type ConfidenceLevel,
} from "../fair/profiles";
import { useMode } from "../mode/useMode";

const DEFAULT_TEF: PertEstimate = { min: 1, mostLikely: 3, max: 6 };
const DEFAULT_VULNERABILITY: PertEstimate = { min: 0.05, mostLikely: 0.15, max: 0.3 };
const DEFAULT_LOSS_ESTIMATE: PertEstimate = { min: 1_000, mostLikely: 10_000, max: 50_000 };
const DEFAULT_LOSS_CATEGORIES: Record<string, PertEstimate> = Object.fromEntries(
  LOSS_CATEGORIES.map((c) => [c.key, DEFAULT_LOSS_ESTIMATE]),
);

export function ScenariosPage() {
  const { t } = useMode();
  const [scenarios, setScenarios] = useState<RiskScenarioSummary[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [assetId, setAssetId] = useState("");
  const [threatId, setThreatId] = useState("");
  const [tef, setTef] = useState<PertEstimate>(DEFAULT_TEF);
  const [vulnerability, setVulnerability] = useState<PertEstimate>(DEFAULT_VULNERABILITY);
  const [lossCategories, setLossCategories] = useState<Record<string, PertEstimate>>(DEFAULT_LOSS_CATEGORIES);
  const [submitting, setSubmitting] = useState(false);

  const [attackerKey, setAttackerKey] = useState(Object.keys(ATTACKER_PROFILES)[0]);
  const [defenseKey, setDefenseKey] = useState(Object.keys(DEFENSE_PROFILES)[0]);
  const [confidence, setConfidence] = useState<ConfidenceLevel>("medio");
  const [vulnExplanation, setVulnExplanation] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([api.listRiskScenarios(), api.listAssets(), api.listThreats()])
      .then(([scenarioList, assetList, threatList]) => {
        setScenarios(scenarioList);
        setAssets(assetList);
        setThreats(threatList);
        setAssetId((current) => current || assetList[0]?.id || "");
        setThreatId((current) => current || threatList[0]?.id || "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setAssetId(assets[0]?.id ?? "");
    setThreatId(threats[0]?.id ?? "");
    setTef(DEFAULT_TEF);
    setVulnerability(DEFAULT_VULNERABILITY);
    setLossCategories(DEFAULT_LOSS_CATEGORIES);
    setVulnExplanation(null);
  }

  function handleAutoVulnerability() {
    const attackerScore = profileAverage(ATTACKER_PROFILES[attackerKey]);
    const defenseScore = profileAverage(DEFENSE_PROFILES[defenseKey]);
    const { explanation, ...estimate } = computeVulnerability(attackerScore, defenseScore, confidence);
    setVulnerability(estimate);
    setVulnExplanation(explanation);
  }

  function startEdit(scenario: RiskScenario) {
    setEditingId(scenario.id);
    setName(scenario.name);
    setAssetId(scenario.assetId);
    setThreatId(scenario.threatId);
    setTef(scenario.threatEventFrequency);
    setVulnerability(scenario.vulnerability);
    setLossCategories(Object.fromEntries(scenario.lossCategories.map((c) => [c.key, c.estimate])));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const input = {
      name,
      assetId,
      threatId,
      threatEventFrequency: tef,
      vulnerability,
      lossCategories: LOSS_CATEGORIES.map((c) => ({ key: c.key, estimate: lossCategories[c.key] })),
    };
    try {
      if (editingId) {
        await api.updateRiskScenario(editingId, input);
      } else {
        await api.createRiskScenario(input);
      }
      resetForm();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await api.deleteRiskScenario(id);
      if (editingId === id) resetForm();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function assetName(id: string) {
    return assets.find((a) => a.id === id)?.name ?? id;
  }
  function threatName(id: string) {
    return threats.find((t) => t.id === id)?.name ?? id;
  }

  const canCreate = assets.length > 0 && threats.length > 0;

  return (
    <div>
      <h1>Escenarios de riesgo</h1>
      {error && <p className="error">{error}</p>}

      {!loading && !canCreate && (
        <p>Registrá al menos un activo y una amenaza antes de crear un escenario.</p>
      )}

      {canCreate && (
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
            <button type="button" onClick={handleAutoVulnerability}>
              Calcular vulnerabilidad automáticamente
            </button>
            {vulnExplanation && <p className="hint">{vulnExplanation}</p>}
          </fieldset>

          <PertEstimateInput
            label={t("vulnFieldLabel")}
            hint={t("vulnFieldHint")}
            value={vulnerability}
            onChange={setVulnerability}
            min={0}
            max={1}
            step={0.01}
          />

          <fieldset className="loss-categories">
            <legend>{t("lmFieldLabel")}</legend>
            <p className="hint">{t("lmFieldHint")} — una entrada por categoría, se suman por evento</p>
            {LOSS_CATEGORIES.map((category) => (
              <PertEstimateInput
                key={category.key}
                label={category.label}
                value={lossCategories[category.key]}
                onChange={(v) => setLossCategories((prev) => ({ ...prev, [category.key]: v }))}
                min={0}
              />
            ))}
          </fieldset>

          <div className="form-actions">
            <button type="submit" disabled={submitting}>
              {submitting ? "Guardando..." : editingId ? "Guardar cambios" : "Crear escenario"}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Activo</th>
              <th>Amenaza</th>
              <th>Nivel</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => (
              <tr key={scenario.id}>
                <td>
                  <Link to={`/scenarios/${scenario.id}`}>{scenario.name}</Link>
                </td>
                <td>{assetName(scenario.assetId)}</td>
                <td>{threatName(scenario.threatId)}</td>
                <td>
                  <RiskBadge level={riskLevelForAle(scenario.ale)} />
                </td>
                <td className="row-actions">
                  <button onClick={() => startEdit(scenario)}>Editar</button>
                  <button onClick={() => handleDelete(scenario.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {scenarios.length === 0 && (
              <tr>
                <td colSpan={5}>No hay escenarios registrados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
