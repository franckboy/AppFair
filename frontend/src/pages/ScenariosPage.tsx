import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type RiskScenarioInput } from "../api/client";
import type { Asset, RiskScenarioSummary, Threat } from "../api/types";
import { RiskBadge } from "../components/RiskBadge";
import { ScenarioForm } from "../components/ScenarioForm";
import { riskLevelForAle } from "../components/statusScale";

export function ScenariosPage() {
  const [scenarios, setScenarios] = useState<RiskScenarioSummary[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.listRiskScenarios(), api.listAssets(), api.listThreats()])
      .then(([scenarioList, assetList, threatList]) => {
        setScenarios(scenarioList);
        setAssets(assetList);
        setThreats(threatList);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(input: RiskScenarioInput) {
    setSubmitting(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateRiskScenario(editingId, input);
      } else {
        await api.createRiskScenario(input);
      }
      setEditingId(null);
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
      if (editingId === id) setEditingId(null);
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
  const editingScenario = editingId ? scenarios.find((s) => s.id === editingId) : undefined;

  return (
    <div>
      <h1>Escenarios de riesgo</h1>
      {error && <p className="error">{error}</p>}

      {!loading && !canCreate && (
        <p>Registrá al menos un activo y una amenaza antes de crear un escenario.</p>
      )}

      {canCreate && (
        <ScenarioForm
          key={editingId ?? "new"}
          assets={assets}
          threats={threats}
          initialScenario={editingScenario}
          submitting={submitting}
          onSubmit={handleSubmit}
          onCancel={editingId ? () => setEditingId(null) : undefined}
        />
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
                  <button onClick={() => setEditingId(scenario.id)}>Editar</button>
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
