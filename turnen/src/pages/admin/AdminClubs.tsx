import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import type { Club } from "../../lib/types";
import { useAuth } from "../../context/useAuth";

// Nur für die vereinsübergreifende Admin-Rolle (users.is_admin) sichtbar -
// siehe App.tsx (Route-Guard) und AppLayout.tsx (Nav-Filter). Wechselt den
// eigenen Account in einen Verein, statt eigene Admin-Ansichten für jede
// Seite der App nachzubauen: die komplette bestehende App funktioniert
// danach unverändert für den gewählten Verein.
export default function AdminClubs() {
  const { clubId, clubName, isAdmin, refreshClub } = useAuth();
  const navigate = useNavigate();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<Club[]>("/api/admin/clubs")
      .then(setClubs)
      .catch((err) => setError(err instanceof Error ? err.message : "Fehler beim Laden"))
      .finally(() => setLoading(false));
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
                    {c.name}
                    {c.id === clubId && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        aktuell
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{c.clubNumber ?? "–"}</td>
                  <td className="px-4 py-2 text-center text-slate-600 dark:text-slate-300">{c.memberCount}</td>
                  <td className="px-4 py-2 text-right">
                    {c.id === clubId ? (
                      <span className="text-xs text-slate-400 dark:text-slate-500">Bereits aktiv</span>
                    ) : (
                      <button
                        onClick={() => handleSwitch(c)}
                        disabled={switchingId === c.id}
                        className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900"
                      >
                        {switchingId === c.id ? "Wechselt…" : "Wechseln"}
                      </button>
                    )}
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
