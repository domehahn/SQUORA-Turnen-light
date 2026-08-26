import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import type { Club } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput } from "../../components/FloatingField";

// Nur für die vereinsübergreifende Admin-Rolle (users.is_admin) sichtbar -
// siehe App.tsx (Route-Guard) und AppLayout.tsx (Nav-Filter). Wechseln setzt
// den eigenen Account als Jugendleitung des gewählten Vereins, statt eigene
// Admin-Ansichten für jede Seite der App nachzubauen: die komplette
// bestehende App funktioniert danach unverändert für den gewählten Verein.
export default function AdminClubs() {
  const { clubId, clubName, isAdmin, refreshClub } = useAuth();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setClubs(await api.get<Club[]>("/api/admin/clubs"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Client-seitig nur ein Hinweis - die eigentliche Absicherung übernimmt
  // requireAdmin auf jeder /api/admin/*-Route.
  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Diese Seite ist nur für die vereinsübergreifende Admin-Rolle sichtbar.
      </div>
    );
  }

  async function handleSwitch(club: Club) {
    setError(null);
    setSwitchingId(club.id);
    try {
      await api.post("/api/admin/switch-club", { clubId: club.id });
      await refreshClub();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Wechseln");
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/admin/clubs", { name: newName.trim() });
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.put(`/api/admin/clubs/${id}`, { name: editName.trim() });
      setEditingId(null);
      await load();
      if (id === clubId) await refreshClub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Umbenennen");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(club: Club) {
    if (club.memberCount > 0) {
      alert(
        `„${club.name}“ hat noch ${club.memberCount} zugeordnete Nutzer*in(nen). Bitte erst über „Admin: Nutzer*innen“ vom Verein lösen, dann kann der Verein gelöscht werden.`
      );
      return;
    }
    if (!confirm(`Verein „${club.name}“ wirklich unwiderruflich löschen? Gruppen bleiben erhalten, aber vereinslos. Das kann nicht rückgängig gemacht werden.`))
      return;
    setError(null);
    setBusy(true);
    try {
      await api.del(`/api/admin/clubs/${club.id}`);
      await load();
      if (club.id === clubId) await refreshClub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin – Vereine</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Vereine auf der Plattform. „Wechseln“ setzt deinen Account als Jugendleitung des gewählten Vereins -
          danach siehst und verwaltest du ihn wie gewohnt. Aktuell:{" "}
          {clubName ? <span className="font-medium text-slate-700 dark:text-slate-300">{clubName}</span> : "kein Verein"}.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="min-w-[200px] flex-1">
          <FloatingInput label="Neuer Verein" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </div>
        <button
          type="submit"
          disabled={busy || !newName.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Anlegen
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : clubs.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Noch keine Vereine angelegt.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Verein</th>
                <th className="px-4 py-2 font-medium">Vereinsnummer</th>
                <th className="px-4 py-2 text-center font-medium">Mitglieder</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                    {editingId === c.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                          autoFocus
                        />
                        <button
                          onClick={() => handleRename(c.id)}
                          disabled={busy || !editName.trim()}
                          className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/50 dark:text-emerald-300 dark:hover:bg-emerald-900"
                        >
                          Speichern
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <>
                        {c.name}
                        {c.id === clubId && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                            aktuell
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{c.clubNumber ?? "–"}</td>
                  <td className="px-4 py-2 text-center text-slate-600 dark:text-slate-300">{c.memberCount}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {c.id !== clubId && (
                        <button
                          onClick={() => handleSwitch(c)}
                          disabled={switchingId === c.id}
                          className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900"
                        >
                          {switchingId === c.id ? "Wechselt…" : "Wechseln"}
                        </button>
                      )}
                      {editingId !== c.id && (
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setEditName(c.name);
                          }}
                          className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          Umbenennen
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={busy}
                        title={c.memberCount > 0 ? "Erst Nutzer*innen vom Verein lösen (Admin: Nutzer*innen)" : undefined}
                        className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900"
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
