import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Threat } from "../api/types";

export function ThreatsPage() {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api
      .listThreats()
      .then(setThreats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
  }

  function startEdit(threat: Threat) {
    setEditingId(threat.id);
    setName(threat.name);
    setDescription(threat.description ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const input = { name, description: description || undefined };
    try {
      if (editingId) {
        await api.updateThreat(editingId, input);
      } else {
        await api.createThreat(input);
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
      await api.deleteThreat(id);
      if (editingId === id) resetForm();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Amenazas</h1>
      {error && <p className="error">{error}</p>}

      <form onSubmit={handleSubmit} className="stacked-form">
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Descripción
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar amenaza"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Descripción</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {threats.map((threat) => (
              <tr key={threat.id}>
                <td>{threat.name}</td>
                <td>{threat.description}</td>
                <td className="row-actions">
                  <button onClick={() => startEdit(threat)}>Editar</button>
                  <button onClick={() => handleDelete(threat.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {threats.length === 0 && (
              <tr>
                <td colSpan={3}>No hay amenazas registradas todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
