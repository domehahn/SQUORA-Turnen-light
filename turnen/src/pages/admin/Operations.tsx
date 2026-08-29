import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/useAuth";

interface Summary {
  emailByStatus: { status: string; count: number }[];
  failedEmails: {
    id: string;
    category: string;
    status: string;
    attemptCount: number;
    retryable: boolean;
    lastErrorCode: string | null;
    nextRetryAt: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  events: { eventType: string; severity: string; detailCode: string | null; occurredAt: string }[];
  cronRuns: { jobName: string; status: string; startedAt: string; finishedAt: string | null; detailCode: string | null }[];
}

function formatDateTime(value: string | null): string {
  if (!value) return "–";
  const isoValue = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(isoValue);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

const EMAIL_STATUS_LABELS: Record<string, string> = {
  failed: "Fehlgeschlagen",
  bounced: "Abgewiesen",
  complained: "Als Spam gemeldet",
  suppressed: "Unterdrückt",
};

export default function Operations() {
  const { isAdmin } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get<Summary>("/api/admin/operations").then(setSummary).catch((e) => setError(e instanceof Error ? e.message : "Fehler beim Laden"));
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  async function retry() {
    setBusy(true);
    try { await api.post("/api/admin/operations/retry-emails", {}); await load(); } finally { setBusy(false); }
  }

  if (!isAdmin) return <p className="text-sm text-red-600 dark:text-red-400">Diese Seite ist nur für die Admin-Rolle sichtbar.</p>;
  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin – Betrieb</h2><p className="text-sm text-slate-500 dark:text-slate-400">E-Mail-Zustellung, Retry und die letzten App-Level-Fehler ohne Empfänger- oder Inhaltsdaten.</p></div><button type="button" onClick={retry} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Fehlgeschlagene E-Mails erneut versuchen</button></div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">E-Mails · letzte 7 Tage</h3><div className="grid gap-2 sm:grid-cols-4">{summary?.emailByStatus.map((item) => <div key={item.status} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs uppercase text-slate-500">{item.status}</p><p className="text-2xl font-semibold">{item.count}</p></div>)}</div></section>
      <section>
        <h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Fehlgeschlagene E-Mails · letzte 7 Tage</h3>
        {summary?.failedEmails.length ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900">
                <tr>
                  <th className="p-3">Zeitpunkt</th>
                  <th className="p-3">Kategorie</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Versuche</th>
                  <th className="p-3">Fehler</th>
                  <th className="p-3">Nächster Retry</th>
                  <th className="p-3">Vorgang</th>
                </tr>
              </thead>
              <tbody>
                {summary.failedEmails.map((delivery) => (
                  <tr key={delivery.id} className="border-t border-slate-200 dark:border-slate-800">
                    <td className="whitespace-nowrap p-3">{formatDateTime(delivery.updatedAt)}</td>
                    <td className="p-3">{delivery.category}</td>
                    <td className="p-3 font-medium text-red-700 dark:text-red-400">
                      {EMAIL_STATUS_LABELS[delivery.status] ?? delivery.status}
                    </td>
                    <td className="p-3">{delivery.attemptCount} / 3</td>
                    <td className="max-w-xs break-words p-3 font-mono text-xs">{delivery.lastErrorCode ?? "–"}</td>
                    <td className="whitespace-nowrap p-3">
                      {delivery.retryable ? formatDateTime(delivery.nextRetryAt) : "Nicht wiederholbar"}
                    </td>
                    <td className="p-3 font-mono text-xs" title={delivery.id}>{delivery.id.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Keine fehlgeschlagenen E-Mails im Zeitraum.</p>
        )}
      </section>
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Cron-Jobs</h3><div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-50 dark:bg-slate-900"><tr><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Letzter Start</th></tr></thead><tbody>{summary?.cronRuns.map((run) => <tr key={run.jobName} className="border-t border-slate-200 dark:border-slate-800"><td className="p-3">{run.jobName}</td><td className="p-3">{run.status}</td><td className="p-3">{run.startedAt}</td></tr>)}</tbody></table></div></section>
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Ereignisse · letzte 7 Tage</h3>{summary?.events.length ? <ul className="space-y-2">{summary.events.map((event, index) => <li key={`${event.occurredAt}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"><span className={event.severity === "critical" ? "font-medium text-red-700 dark:text-red-400" : "font-medium text-amber-700 dark:text-amber-400"}>{event.severity}</span> · {event.eventType}{event.detailCode ? ` · ${event.detailCode}` : ""}<span className="ml-2 text-xs text-slate-400">{event.occurredAt}</span></li>)}</ul> : <p className="text-sm text-emerald-700 dark:text-emerald-400">Keine App-Level-Fehler im Zeitraum.</p>}</section>
    </div>
  );
}
