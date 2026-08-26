import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";

interface SystemAuditLogEntry {
  id: string;
  actorName: string | null;
  action: string;
  targetLabel: string;
  createdAt: string;
  clubName: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  "group.created": "Gruppe angelegt",
  "group.updated": "Gruppe bearbeitet",
  "group.deleted": "Gruppe gelöscht",
  "group.claimed": "Gruppe dem Verein zugeordnet",
  "child.created": "Kind angelegt",
  "child.moved": "Kind verschoben",
  "child.archived": "Kind ausgetreten",
  "child.reactivated": "Kind reaktiviert",
  "member.promoted": "zur Jugendleitung ernannt",
  "member.demoted": "als Jugendleitung zurückgestuft",
  "move_request.approved": "Verschiebe-Anfrage freigegeben",
  "move_request.rejected": "Verschiebe-Anfrage abgelehnt",
  "capacity_request.approved": "Kapazitäts-Anfrage freigegeben",
  "capacity_request.rejected": "Kapazitäts-Anfrage abgelehnt",
  "admin.club_switch": "Admin: Verein gewechselt",
  "admin.club_created": "Admin: Verein angelegt",
  "admin.club_renamed": "Admin: Verein umbenannt",
  "admin.club_deleted": "Admin: Verein gelöscht",
  "admin.user_updated": "Admin: Nutzer*in geändert",
  "admin.user_password_reset": "Admin: Passwort zurückgesetzt",
  "admin.user_deleted": "Admin: Nutzer*in gelöscht",
  "admin.user_created": "Admin: Nutzer*in angelegt",
  "profile.updated": "Profil bearbeitet",
  "profile.password_changed": "Passwort geändert",
  "club.created": "Verein angelegt",
  "club.number_updated": "Vereinsnummer geändert",
  "club.joined": "Verein beigetreten",
  "club.left": "Verein verlassen",
  "group.co_leader_removed": "Co-Leitung entfernt",
  "child.updated": "Kind bearbeitet",
  "child.deleted": "Kind gelöscht",
  "child.family_changed": "Familie des Kindes geändert",
  "family.created": "Familie angelegt",
  "family.updated": "Familie bearbeitet",
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
  "mfa.enabled": "Zwei-Faktor-Authentifizierung aktiviert",
  "mfa.disabled": "Zwei-Faktor-Authentifizierung deaktiviert",
  "mfa.backup_code_used": "MFA-Backup-Code verwendet",
};

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

// Systemweiter Verlauf über alle Vereine hinweg - nur für die Admin-Rolle,
// im Unterschied zu /verlauf (pro Verein, dort auf actor_id gefiltert für
// normale Turnleiter*innen).
export default function AdminAuditLog() {
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<SystemAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clubFilter, setClubFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    api
      .get<SystemAuditLogEntry[]>("/api/admin/audit-log?limit=500")
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "Fehler beim Laden"))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Diese Seite ist nur für die vereinsübergreifende Admin-Rolle sichtbar.
      </div>
    );
  }

  const availableClubs = useMemo(() => {
    const set = new Set(entries.map((e) => e.clubName).filter((n): n is string => Boolean(n)));
    return [...set].sort();
  }, [entries]);

  const availableActions = useMemo(() => {
    const set = new Set(entries.map((e) => e.action));
    return [...set].sort((a, b) => (ACTION_LABELS[a] ?? a).localeCompare(ACTION_LABELS[b] ?? b));
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (clubFilter && e.clubName !== clubFilter) return false;
      if (actionFilter && e.action !== actionFilter) return false;
      if (term) {
        const haystack = `${e.actorName ?? ""} ${e.targetLabel}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [entries, clubFilter, actionFilter, search]);

  function handleExportCsv() {
    const header = ["Zeitpunkt", "Verein", "Wer", "Aktion", "Betrifft"];
    const lines = [header.map(csvCell).join(";")];
    for (const e of filtered) {
      const cells = [
        formatTimestamp(e.createdAt),
        e.clubName ?? "–",
        e.actorName ?? "Unbekannt",
        ACTION_LABELS[e.action] ?? e.action,
        e.targetLabel,
      ];
      lines.push(cells.map(csvCell).join(";"));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "system_verlauf.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin – Systemweiter Verlauf</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Änderungen über alle Vereine hinweg, neueste zuerst.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-48">
          <FloatingSelect label="Verein" value={clubFilter} onChange={(e) => setClubFilter(e.target.value)}>
            <option value="">Alle</option>
            {availableClubs.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-56">
          <FloatingSelect label="Aktion" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">Alle</option>
            {availableActions.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a] ?? a}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="min-w-[200px] flex-1">
          <FloatingInput label="Suche (Name, betroffen)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          CSV herunterladen
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          Keine Einträge.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Zeitpunkt</th>
                <th className="px-4 py-2 font-medium">Verein</th>
                <th className="px-4 py-2 font-medium">Wer</th>
                <th className="px-4 py-2 font-medium">Aktion</th>
                <th className="px-4 py-2 font-medium">Betrifft</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatTimestamp(e.createdAt)}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{e.clubName ?? "–"}</td>
                  <td className="px-4 py-2 text-slate-800 dark:text-slate-100">{e.actorName ?? "Unbekannt"}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{e.targetLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
