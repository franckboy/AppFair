import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Dashboard } from "../api/types";
import { RiskHeatmap } from "../components/RiskHeatmap";
import { ParetoChart } from "../components/ParetoChart";
import { RiskBadge } from "../components/RiskBadge";
import { StatTile } from "../components/StatTile";
import { riskLevelForAle } from "../components/statusScale";
import { currencyCompact, currencyFull } from "../format";
import "./Dashboard.css";

export function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setDashboard)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Cargando...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!dashboard) return null;

  const { scenarios, totals } = dashboard;

  return (
    <div className="dashboard">
      <h1>Dashboard ejecutivo</h1>

      {scenarios.length === 0 ? (
        <p>Registrá escenarios de riesgo para ver el dashboard.</p>
      ) : (
        <>
          <div className="kpi-row">
            <StatTile label="ALE total del portafolio" value={currencyCompact.format(totals.ale)} hint={currencyFull.format(totals.ale)} />
            <StatTile label="Escenarios activos" value={String(totals.scenarioCount)} />
            <StatTile
              label="Escenario de mayor riesgo"
              value={totals.topRisk ? currencyCompact.format(totals.topRisk.ale) : "—"}
              hint={
                totals.topRisk && (
                  <>
                    {totals.topRisk.name} <RiskBadge level={riskLevelForAle(totals.topRisk.ale)} />
                  </>
                )
              }
            />
            <StatTile
              label="Peor caso individual (CVaR 95%)"
              value={currencyCompact.format(totals.worstCaseCvar95)}
              hint="mayor CVaR entre los escenarios"
            />
          </div>

          <ParetoChart items={scenarios.map((s) => ({ id: s.id, name: s.name, ale: s.ale }))} />

          <RiskHeatmap
            scenarios={scenarios.map((s) => ({ id: s.id, name: s.name, ale: s.ale, likelihood: s.likelihood, severity: s.severity }))}
          />
        </>
      )}
    </div>
  );
}
