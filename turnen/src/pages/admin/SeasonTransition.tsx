import { useEffect, useState } from "react";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../context/useAuth";

interface Candidate { id: string; name: string; availablePlaces: number | null }
interface Proposal {
  childId: string;
  childName: string;
  birthDate: string;
  age: number;
  fromGroupId: string;
  fromGroupName: string;
  candidates: Candidate[];
}

function defaultReferenceDate(): string {
  const now = new Date();
  const year = now.getMonth() < 7 ? now.getFullYear() : now.getFullYear() + 1;
  return `${year}-08-01`;
}

export default function SeasonTransition() {
  const { clubRole, isAdmin } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  // Plattform-Admin darf mitlesen (wie überall), aber nichts anstoßen -
  // serverseitig ohnehin über den Read-only-Admin-Block abgesichert.
  const readOnly = !isJugendleiter;
  const [referenceDate, setReferenceDate] = useState(defaultReferenceDate());
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.get<{ proposals: Proposal[] }>(`/api/season-transition/proposals?referenceDate=${referenceDate}`);
      setProposals(result.proposals);
      setTargets(Object.fromEntries(result.proposals.map((p) => [p.childId, p.candidates[0]?.id ?? ""])));
      setSelected(Object.fromEntries(result.proposals.map((p) => [p.childId, p.candidates.length > 0])));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Vorschläge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function applySelected() {
    const work = proposals.filter((proposal) => selected[proposal.childId] && targets[proposal.childId]);
    if (!work.length) return;
    setBusy(true);
    let completed = 0;
    try {
      for (const proposal of work) {
        const body = { toGroupId: targets[proposal.childId], reason: `Saisonwechsel zum Stichtag ${referenceDate}` };
        try {
          await api.post(`/api/children/${proposal.childId}/move`, body);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && (error.data as { code?: string } | null)?.code === "capacity_exceeded") {
            await api.post(`/api/children/${proposal.childId}/move`, { ...body, confirmOverCapacity: true });
          } else {
            throw error;
          }
        }
        completed++;
      }
      await load();
      setMessage(`${completed} Gruppenwechsel erfolgreich angestoßen.`);
    } catch (error) {
      setMessage(`${completed} erledigt; danach Fehler: ${error instanceof Error ? error.message : "unbekannt"}`);
    } finally {
      setBusy(false);
    }
  }

  if (!isJugendleiter && !isAdmin)
    return <p className="text-sm text-red-600">Diese Seite ist nur für die Jugendleitung sichtbar.</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Saisonwechsel</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Findet Kinder, deren Alter am Stichtag nicht mehr zur aktuellen Gruppe passt. Kapazitätsprüfungen, Freigaben und Audit-Log bleiben vollständig aktiv.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="text-sm text-slate-700 dark:text-slate-300">Stichtag<br /><input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className="mt-1 rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" /></label>
        <button type="button" onClick={load} disabled={loading} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">Neu berechnen</button>
        <button type="button" onClick={applySelected} disabled={busy || loading || readOnly} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Ausgewählte Wechsel starten</button>
      </div>
      {readOnly && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nur-Lese-Ansicht als Plattform-Admin – die Vorschläge sind sichtbar, das Anstoßen der Wechsel bleibt der
          Jugendleitung vorbehalten.
        </p>
      )}
      {message && <p className="text-sm text-slate-700 dark:text-slate-300">{message}</p>}
      {loading ? <p className="text-sm text-slate-500">Berechnung läuft…</p> : proposals.length === 0 ? <p className="text-sm text-emerald-700">Am Stichtag passen alle zugeordneten Kinder in ihre Altersgruppen.</p> : (
        <div className="space-y-2">
          {proposals.map((proposal) => (
            <div key={proposal.childId} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-[auto_1fr_1fr] sm:items-center">
              <input type="checkbox" aria-label={`${proposal.childName} auswählen`} checked={Boolean(selected[proposal.childId])} disabled={!proposal.candidates.length} onChange={(e) => setSelected({ ...selected, [proposal.childId]: e.target.checked })} />
              <div><p className="font-medium text-slate-900 dark:text-slate-100">{proposal.childName}</p><p className="text-xs text-slate-500">{proposal.age} Jahre · bisher {proposal.fromGroupName}</p></div>
              {proposal.candidates.length ? <select value={targets[proposal.childId] ?? ""} onChange={(e) => setTargets({ ...targets, [proposal.childId]: e.target.value })} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">{proposal.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.availablePlaces === null ? "" : ` · ${candidate.availablePlaces} Plätze frei`}</option>)}</select> : <p className="text-sm text-amber-700">Keine passende Zielgruppe vorhanden.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
