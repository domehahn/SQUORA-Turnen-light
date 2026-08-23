import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AuditLogEntry } from "../../lib/types";
import { useAuth } from "../../context/useAuth";

const ACTION_LABELS: Record<string, string> = {
  "group.created": "Gruppe angelegt",
  "group.updated": "Gruppe bearbeitet",
  "group.deleted": "Gruppe gelöscht",
  "group.claimed": "Gruppe dem Verein zugeordnet",
  "member.promoted": "zur Jugendleitung ernannt",
  "member.demoted": "als Jugendleitung zurückgestuft",
  "move_request.approved": "Verschiebe-Anfrage freigegeben",
  "move_request.rejected": "Verschiebe-Anfrage abgelehnt",
  "capacity_request.approved": "Kapazitäts-Anfrage freigegeben",
  "capacity_request.rejected": "Kapazitäts-Anfrage abgelehnt",
};

function formatTimestamp(iso: string): string {
  // Backend liefert "YYYY-MM-DD HH:MM:SS" (UTC, SQLite datetime('now')).
  const isoWithZone = iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(isoWithZone));
}

export default function AuditLog() {
  const { clubId, clubName } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        setEntries(await api.get<AuditLogEntry[]>("/api/audit-log"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Verlauf</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nachvollziehbare Änderungen an den gemeinsamen Vereinsdaten von {clubName ?? "deinem Verein"}.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : !clubId ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Du bist aktuell keinem Verein zugeordnet – der Verlauf ist vereinsbezogen.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Zeitpunkt</th>
                <th className="px-4 py-2 font-medium">Wer</th>
                <th className="px-4 py-2 font-medium">Aktion</th>
                <th className="px-4 py-2 font-medium">Betrifft</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatTimestamp(entry.createdAt)}</td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{entry.actorName ?? "Unbekannt"}</td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{entry.targetLabel}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Noch keine Einträge.
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
