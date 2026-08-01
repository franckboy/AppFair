import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Asset, RiskScenario, SimulationResult, Threat } from "../api/types";
import { TreatmentsSection } from "../components/TreatmentsSection";

const currency = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export function ScenarioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [scenario, setScenario] = useState<RiskScenario | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [threat, setThreat] = useState<Threat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.getRiskScenario(id), api.listAssets(), api.listThreats()])
      .then(([scenarioData, assets, threats]) => {
        setScenario(scenarioData);
        setAsset(assets.find((a) => a.id === scenarioData.assetId) ?? null);
        setThreat(threats.find((t) => t.id === scenarioData.threatId) ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSimulate() {
    if (!id) return;
    setSimulating(true);
    setError(null);
    try {
      setResult(await api.simulateRiskScenario(id, { iterations: 20_000 }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSimulating(false);
    }
  }

  if (loading) return <p>Cargando...</p>;
  if (error && !scenario) return <p className="error">{error}</p>;
  if (!scenario) return <p>Escenario no encontrado.</p>;

  return (
    <div>
      <p>
        <Link to="/scenarios">&larr; Volver a escenarios</Link>
      </p>
      <h1>{scenario.name}</h1>
      <p>
        Activo: <strong>{asset?.name ?? scenario.assetId}</strong> — Amenaza:{" "}
        <strong>{threat?.name ?? scenario.threatId}</strong>
      </p>

      <table className="params-table">
        <thead>
          <tr>
            <th>Parámetro</th>
            <th>Mínimo</th>
            <th>Más probable</th>
            <th>Máximo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Frecuencia anual</td>
            <td>{scenario.threatEventFrequency.min}</td>
            <td>{scenario.threatEventFrequency.mostLikely}</td>
            <td>{scenario.threatEventFrequency.max}</td>
          </tr>
          <tr>
            <td>Vulnerabilidad</td>
            <td>{scenario.vulnerability.min}</td>
            <td>{scenario.vulnerability.mostLikely}</td>
            <td>{scenario.vulnerability.max}</td>
          </tr>
          <tr>
            <td>Magnitud de pérdida</td>
            <td>{currency.format(scenario.lossMagnitude.min)}</td>
            <td>{currency.format(scenario.lossMagnitude.mostLikely)}</td>
            <td>{currency.format(scenario.lossMagnitude.max)}</td>
          </tr>
        </tbody>
      </table>

      <button onClick={handleSimulate} disabled={simulating}>
        {simulating ? "Simulando..." : "Ejecutar simulación Monte Carlo"}
      </button>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="simulation-result">
          <h2>Resultado</h2>
          <p className="ale">
            Pérdida Anual Esperada (ALE): <strong>{currency.format(result.ale)}</strong>
          </p>
          <table className="params-table">
            <thead>
              <tr>
                <th>P10</th>
                <th>P50</th>
                <th>P90</th>
                <th>P95</th>
                <th>P99</th>
                <th>CVaR 95%</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{currency.format(result.percentiles.p10)}</td>
                <td>{currency.format(result.percentiles.p50)}</td>
                <td>{currency.format(result.percentiles.p90)}</td>
                <td>{currency.format(result.percentiles.p95)}</td>
                <td>{currency.format(result.percentiles.p99)}</td>
                <td>{currency.format(result.cvar95)}</td>
              </tr>
            </tbody>
          </table>
          <p className="hint">
            Rango simulado: {currency.format(result.min)} – {currency.format(result.max)} ({result.iterations.toLocaleString()}{" "}
            iteraciones)
          </p>
        </div>
      )}

      <TreatmentsSection scenarioId={scenario.id} />
    </div>
  );
}
