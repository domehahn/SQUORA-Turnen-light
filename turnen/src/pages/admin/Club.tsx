import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Club, ClubMember } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";

export default function ClubPage() {
  const { clubId, clubName, refreshClub } = useAuth();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [selectedClubId, setSelectedClubId] = useState("");
  const [newClubName, setNewClubName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [clubList, memberList] = await Promise.all([
        api.get<Club[]>("/api/clubs"),
        api.get<ClubMember[]>("/api/clubs/mine/members"),
      ]);
      setClubs(clubList);
      setMembers(memberList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [clubId]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!selectedClubId) return;
    setError(null);
    setBusy(true);
    try {
      await api.put("/api/me/club", { clubId: selectedClubId });
      await refreshClub();
      setSelectedClubId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Beitreten");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newClubName.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.post("/api/clubs", { name: newClubName.trim() });
      await refreshClub();
      setNewClubName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    if (!confirm("Verein wirklich verlassen? Deine eigenen Gruppen bleiben erhalten, sind aber für andere Vereinsmitglieder nicht mehr sichtbar.")) return;
    setError(null);
    setBusy(true);
    try {
      await api.put("/api/me/club", { clubId: null });
      await refreshClub();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Verlassen");
    } finally {
      setBusy(false);
    }
  }

  const joinableClubs = clubs.filter((c) => c.id !== clubId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Verein</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Turnleiter im selben Verein sehen die Gruppen und Kinderlisten der anderen Mitglieder lesend – bearbeiten
          kann jede*r nur die eigenen Gruppen.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : clubId ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Aktueller Verein</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{clubName}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Mitglieder ({members.length})
            </p>
            <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300">
              {members.map((m) => (
                <li key={m.id}>{m.name ?? m.email}</li>
              ))}
            </ul>
          </div>
          <button
            onClick={handleLeave}
            disabled={busy}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Verein verlassen
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Du bist aktuell keinem Verein zugeordnet. Deine Gruppen sind nur für dich sichtbar.
        </p>
      )}

      {!clubId && (
        <div className="grid gap-4 sm:grid-cols-2">
          <form
            onSubmit={handleJoin}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Bestehendem Verein beitreten</h3>
            <FloatingSelect label="Verein" value={selectedClubId} onChange={(e) => setSelectedClubId(e.target.value)}>
              <option value="">Verein wählen</option>
              {joinableClubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.memberCount} {c.memberCount === 1 ? "Mitglied" : "Mitglieder"})
                </option>
              ))}
            </FloatingSelect>
            <button
              type="submit"
              disabled={busy || !selectedClubId}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Beitreten
            </button>
            {joinableClubs.length === 0 && (
              <p className="text-xs text-slate-400 dark:text-slate-500">Noch keine Vereine vorhanden.</p>
            )}
          </form>

          <form
            onSubmit={handleCreate}
            className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Neuen Verein anlegen</h3>
            <FloatingInput label="Vereinsname" value={newClubName} onChange={(e) => setNewClubName(e.target.value)} />
            <button
              type="submit"
              disabled={busy || !newClubName.trim()}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Anlegen &amp; beitreten
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
