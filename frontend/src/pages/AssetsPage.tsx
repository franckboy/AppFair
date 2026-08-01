import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Asset } from "../api/types";

export function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    api
      .listAssets()
      .then(setAssets)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setValue("");
  }

  function startEdit(asset: Asset) {
    setEditingId(asset.id);
    setName(asset.name);
    setDescription(asset.description ?? "");
    setValue(asset.value != null ? String(asset.value) : "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const input = {
      name,
      description: description || undefined,
      value: value ? Number(value) : undefined,
    };
    try {
      if (editingId) {
        await api.updateAsset(editingId, input);
      } else {
        await api.createAsset(input);
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
      await api.deleteAsset(id);
      if (editingId === id) resetForm();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1>Activos</h1>
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
        <label>
          Valor económico estimado
          <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "Guardando..." : editingId ? "Guardar cambios" : "Agregar activo"}
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
              <th>Valor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td>{asset.name}</td>
                <td>{asset.description}</td>
                <td>{asset.value != null ? asset.value.toLocaleString() : "—"}</td>
                <td className="row-actions">
                  <button onClick={() => startEdit(asset)}>Editar</button>
                  <button onClick={() => handleDelete(asset.id)}>Eliminar</button>
                </td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr>
                <td colSpan={4}>No hay activos registrados todavía.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
