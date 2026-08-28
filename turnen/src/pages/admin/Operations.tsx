import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../context/useAuth";

interface Summary {
  emailByStatus: { status: string; count: number }[];
  events: { eventType: string; severity: string; detailCode: string | null; occurredAt: string }[];
  cronRuns: { jobName: string; status: string; startedAt: string; finishedAt: string | null; detailCode: string | null }[];
}

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

  if (!isAdmin) return <p className="text-sm text-red-600">Diese Seite ist nur für die Admin-Rolle sichtbar.</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin – Betrieb</h2><p className="text-sm text-slate-500 dark:text-slate-400">E-Mail-Zustellung, Retry und die letzten App-Level-Fehler ohne Empfänger- oder Inhaltsdaten.</p></div><button type="button" onClick={retry} disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Fehlgeschlagene E-Mails erneut versuchen</button></div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">E-Mails · letzte 7 Tage</h3><div className="grid gap-2 sm:grid-cols-4">{summary?.emailByStatus.map((item) => <div key={item.status} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"><p className="text-xs uppercase text-slate-500">{item.status}</p><p className="text-2xl font-semibold">{item.count}</p></div>)}</div></section>
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Cron-Jobs</h3><div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"><table className="w-full text-left text-sm"><thead className="bg-slate-50 dark:bg-slate-900"><tr><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Letzter Start</th></tr></thead><tbody>{summary?.cronRuns.map((run) => <tr key={run.jobName} className="border-t border-slate-200 dark:border-slate-800"><td className="p-3">{run.jobName}</td><td className="p-3">{run.status}</td><td className="p-3">{run.startedAt}</td></tr>)}</tbody></table></div></section>
      <section><h3 className="mb-2 font-semibold text-slate-800 dark:text-slate-100">Ereignisse · letzte 7 Tage</h3>{summary?.events.length ? <ul className="space-y-2">{summary.events.map((event, index) => <li key={`${event.occurredAt}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"><span className={event.severity === "critical" ? "font-medium text-red-700" : "font-medium text-amber-700"}>{event.severity}</span> · {event.eventType}{event.detailCode ? ` · ${event.detailCode}` : ""}<span className="ml-2 text-xs text-slate-400">{event.occurredAt}</span></li>)}</ul> : <p className="text-sm text-emerald-700">Keine App-Level-Fehler im Zeitraum.</p>}</section>
    </div>
  );
}
