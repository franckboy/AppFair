import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { TreatmentStrategy, TreatmentWithEvaluation } from "../api/types";
import { currencyFull, percent1 } from "../format";
import { RiskBadge } from "./RiskBadge";
import { riskLevelForAle } from "./statusScale";

const STRATEGY_LABEL: Record<TreatmentStrategy, string> = {
  MITIGATE: "Mitigar",
  TRANSFER: "Transferir",
  AVOID: "Evitar",
  ACCEPT: "Aceptar",
};

const REDUCTION_LABEL: Record<TreatmentStrategy, string> = {
  MITIGATE: "% de reducción de vulnerabilidad",
  TRANSFER: "% de la pérdida cubierta (ej. seguro)",
  AVOID: "",
  ACCEPT: "",
};

const STRATEGIES: TreatmentStrategy[] = ["MITIGATE", "TRANSFER", "AVOID", "ACCEPT"];

interface TreatmentsSectionProps {
  scenarioId: string;
}

export function TreatmentsSection({ scenarioId }: TreatmentsSectionProps) {
  const [treatments, setTreatments] = useState<TreatmentWithEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [strategy, setStrategy] = useState<TreatmentStrategy>("MITIGATE");
  const [name, setName] = useState("");
  const [annualCost, setAnnualCost] = useState("");
  const [reductionPct, setReductionPct] = useState("50");
  const [submitting, setSubmitting] = useState(false);

  const needsReduction = strategy === "MITIGATE" || strategy === "TRANSFER";

  function load() {
    setLoading(true);
    api
      .listTreatments(scenarioId)
      .then(setTreatments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [scenarioId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createTreatment(scenarioId, {
        strategy,
        name,
        annualCost: Number(annualCost) || 0,
        reductionPct: needsReduction ? Number(reductionPct) : undefined,
      });
      setName("");
      setAnnualCost("");
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
      await api.deleteTreatment(id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const bestRosiId = treatments.reduce<string | null>((bestId, t) => {
    if (t.evaluation.rosi === null) return bestId;
    const best = bestId ? treatments.find((x) => x.id === bestId) : undefined;
    if (!best || best.evaluation.rosi === null || t.evaluation.rosi > best.evaluation.rosi) return t.id;
    return bestId;
  }, null);

  return (
    <div className="treatments-section">
      <h2>Estrategias de tratamiento</h2>
      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit} className="stacked-form">
        <label>
          Estrategia
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as TreatmentStrategy)}>
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {STRATEGY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Costo anual
          <input type="number" min={0} value={annualCost} onChange={(e) => setAnnualCost(e.target.value)} required />
        </label>
        {needsReduction && (
          <label>
            {REDUCTION_LABEL[strategy]}
            <input
              type="number"
              min={0}
              max={100}
              value={reductionPct}
              onChange={(e) => setReductionPct(e.target.value)}
              required
            />
          </label>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : "Agregar estrategia"}
        </button>
      </form>

      {loading ? (
        <p>Cargando...</p>
      ) : treatments.length === 0 ? (
        <p className="empty-state">No hay estrategias cargadas para este escenario todavía.</p>
      ) : (
        <table className="params-table">
          <thead>
            <tr>
              <th>Estrategia</th>
              <th>Nombre</th>
              <th>Costo anual</th>
              <th>ALE antes</th>
              <th>ALE después</th>
              <th>Reducción de riesgo</th>
              <th>ROSI</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {treatments.map((t) => (
              <tr key={t.id} className={t.id === bestRosiId ? "best-rosi" : undefined}>
                <td>{STRATEGY_LABEL[t.strategy]}</td>
                <td>{t.name}</td>
                <td>{currencyFull.format(t.annualCost)}</td>
                <td>{currencyFull.format(t.evaluation.aleBefore)}</td>
                <td>
                  {currencyFull.format(t.evaluation.aleAfter)} <RiskBadge level={riskLevelForAle(t.evaluation.aleAfter)} />
                </td>
                <td>{currencyFull.format(t.evaluation.riskReduction)}</td>
                <td>{t.evaluation.rosi !== null ? `${percent1.format(t.evaluation.rosi * 100)}%` : "—"}</td>
                <td>
                  <button onClick={() => handleDelete(t.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
