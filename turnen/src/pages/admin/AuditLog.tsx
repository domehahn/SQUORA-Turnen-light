import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { AuditLogEntry } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";

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
  "child.created": "Kind angelegt",
  "child.moved": "Kind verschoben",
  "child.archived": "Kind ausgetreten",
  "child.reactivated": "Kind reaktiviert",
  "child.updated": "Kind bearbeitet",
  "child.deleted": "Kind gelöscht",
  "child.family_changed": "Familie des Kindes geändert",
  "family.created": "Familie angelegt",
  "family.updated": "Familie bearbeitet",
  "profile.updated": "Profil bearbeitet",
  "profile.password_changed": "Passwort geändert",
  "club.number_updated": "Vereinsnummer geändert",
  "group.co_leader_removed": "Co-Leitung entfernt",
  "substitute_request.created": "Vertretung gesucht",
  "substitute_request.cancelled": "Vertretungsgesuch zurückgezogen",
  "move_request.withdrawn": "Verschiebe-Anfrage zurückgezogen",
  "capacity_request.withdrawn": "Kapazitäts-Anfrage zurückgezogen",
  "waitlist.added": "auf Warteliste gesetzt",
  "waitlist.removed": "von Warteliste entfernt",
  "club_waitlist.added": "auf Vereins-Warteliste gesetzt",
  "club_waitlist.cancelled": "Vereins-Warteliste-Eintrag zurückgezogen",
  "placement_request.proposed": "Platz vorgeschlagen",
  "placement_request.requested": "Übernahme angefragt",
  "placement_request.declined": "Platzvorschlag abgelehnt",
  "session_override_request.approved": "abweichender Termin freigegeben",
  "session_override_request.rejected": "abweichender Termin abgelehnt",
  "session_override_request.cancelled": "Anfrage für abweichenden Termin zurückgezogen",
  "attendance.cancelled": "Termin abgesagt",
  "attendance.uncancelled": "Termin-Absage zurückgenommen",
};

// Backend liefert "YYYY-MM-DD HH:MM:SS" (UTC, SQLite datetime('now')).
function withZone(iso: string): string {
  return iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`;
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(withZone(iso)));
}

function csvCell(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function AuditLog() {
  const { clubId, clubName, clubRole, isAdmin } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    async function load() {
      setLoading(true);
      try {
        // Höheres Limit als der Default (100), damit Filter/Export auf der
        // Seite selbst auch bei aktiveren Vereinen sinnvoll etwas zu tun haben.
        setEntries(await api.get<AuditLogEntry[]>("/api/audit-log?limit=500"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Diese Seite ist nur für die Admin-Rolle sichtbar.
      </div>
    );
  }

  const availableActions = useMemo(() => {
    const set = new Set(entries.map((e) => e.action));
    return [...set].sort((a, b) => (ACTION_LABELS[a] ?? a).localeCompare(ACTION_LABELS[b] ?? b));
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      const dateOnly = withZone(e.createdAt).slice(0, 10);
      if (fromDate && dateOnly < fromDate) return false;
      if (toDate && dateOnly > toDate) return false;
      if (actionFilter && e.action !== actionFilter) return false;
      if (term) {
        const haystack = `${e.actorName ?? ""} ${e.targetLabel}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [entries, fromDate, toDate, actionFilter, search]);

  function handleExportCsv() {
    const header = ["Zeitpunkt", "Wer", "Aktion", "Betrifft"];
    const lines = [header.map(csvCell).join(";")];
    for (const e of filtered) {
      const cells = [formatTimestamp(e.createdAt), e.actorName ?? "Unbekannt", ACTION_LABELS[e.action] ?? e.action, e.targetLabel];
      lines.push(cells.map(csvCell).join(";"));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `verlauf_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Verlauf</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isJugendleiter
            ? `Nachvollziehbare Änderungen an den gemeinsamen Vereinsdaten von ${clubName ?? "deinem Verein"}.`
            : "Nachvollziehbare Änderungen, die du selbst vorgenommen hast. Die Jugendleitung sieht den Verlauf des gesamten Vereins."}
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
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="w-40">
              <FloatingInput label="Von" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="w-40">
              <FloatingInput label="Bis" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="w-56">
              <FloatingSelect label="Aktion" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                <option value="">Alle Aktionen</option>
                {availableActions.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a] ?? a}
                  </option>
                ))}
              </FloatingSelect>
            </div>
            <div className="max-w-xs flex-1">
              <FloatingInput label="Suche nach Person oder Betrifft" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={filtered.length === 0}
              className="ml-auto rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              CSV herunterladen
            </button>
          </div>

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
                {filtered.map((entry) => (
                  <tr key={entry.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatTimestamp(entry.createdAt)}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{entry.actorName ?? "Unbekannt"}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{entry.targetLabel}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      {entries.length === 0 ? "Noch keine Einträge." : "Keine Treffer für diesen Filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
