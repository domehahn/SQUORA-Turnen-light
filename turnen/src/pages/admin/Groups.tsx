import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Group } from "../../lib/types";
import { FloatingInput } from "../../components/FloatingField";

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [minAge, setMinAge] = useState("3");
  const [maxAge, setMaxAge] = useState("6");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setGroups(await api.get<Group[]>("/api/groups"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(g: Group) {
    setEditingId(g.id);
    setName(g.name);
    setMinAge(String(g.minAge));
    setMaxAge(String(g.maxAge));
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setMinAge("3");
    setMaxAge("6");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name,
        minAge: Number(minAge),
        maxAge: Number(maxAge),
        sortOrder: Number(minAge),
      };
      if (editingId) await api.put(`/api/groups/${editingId}`, payload);
      else await api.post("/api/groups", payload);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Gruppe wirklich löschen? Zugewiesene Kinder verlieren die Gruppenzuordnung.")) return;
    try {
      await api.del(`/api/groups/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Gruppen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Altersgruppen, z.B. Minis 3–6 Jahre, Kids 6–9 Jahre.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[160px]">
          <FloatingInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Min. Alter"
            type="number"
            min={0}
            max={25}
            required
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
          />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Max. Alter"
            type="number"
            min={0}
            max={25}
            required
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600">
          {editingId ? "Speichern" : "Anlegen"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Abbrechen
          </button>
        )}
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Altersspanne</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{g.name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {g.minAge}–{g.maxAge} Jahre
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => startEdit(g)} className="mr-3 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
                      Bearbeiten
                    </button>
                    <button onClick={() => handleDelete(g.id)} className="text-sm text-red-600 hover:underline dark:text-red-400">
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Noch keine Gruppen angelegt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
