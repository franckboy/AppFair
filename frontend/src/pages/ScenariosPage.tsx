import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Asset, PertEstimate, RiskScenario, Threat } from "../api/types";
import { PertEstimateInput } from "../components/PertEstimateInput";

const DEFAULT_TEF: PertEstimate = { min: 1, mostLikely: 3, max: 6 };
const DEFAULT_VULNERABILITY: PertEstimate = { min: 0.05, mostLikely: 0.15, max: 0.3 };
const DEFAULT_LOSS_MAGNITUDE: PertEstimate = { min: 1_000, mostLikely: 10_000, max: 50_000 };

export function ScenariosPage() {
  const [scenarios, setScenarios] = useState<RiskScenario[]>([]);
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
  const [lossMagnitude, setLossMagnitude] = useState<PertEstimate>(DEFAULT_LOSS_MAGNITUDE);
  const [submitting, setSubmitting] = useState(false);

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
    setLossMagnitude(DEFAULT_LOSS_MAGNITUDE);
  }

  function startEdit(scenario: RiskScenario) {
    setEditingId(scenario.id);
    setName(scenario.name);
    setAssetId(scenario.assetId);
    setThreatId(scenario.threatId);
    setTef(scenario.threatEventFrequency);
    setVulnerability(scenario.vulnerability);
    setLossMagnitude(scenario.lossMagnitude);
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
      lossMagnitude,
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

          <PertEstimateInput
            label="Frecuencia de eventos de amenaza (por año)"
            value={tef}
            onChange={setTef}
            min={0}
            step={0.1}
          />
          <PertEstimateInput
            label="Vulnerabilidad"
            hint="probabilidad 0-1 de que el evento se convierta en pérdida"
            value={vulnerability}
            onChange={setVulnerability}
            min={0}
            max={1}
            step={0.01}
          />
          <PertEstimateInput
            label="Magnitud de pérdida"
            hint="impacto económico por evento"
            value={lossMagnitude}
            onChange={setLossMagnitude}
            min={0}
          />

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
                <td className="row-actions">
                  <button onClick={() => startEdit(scenario)}>Editar</button>
                  <button onClick={() => handleDelete(scenario.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {scenarios.length === 0 && (
              <tr>
                <td colSpan={4}>No hay escenarios registrados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
