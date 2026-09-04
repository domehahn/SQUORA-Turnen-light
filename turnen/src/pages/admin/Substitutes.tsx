import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Group, SubstituteRequest } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export default function Substitutes() {
  const { userId, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [groups, setGroups] = useState<Group[]>([]);
  const [openRequests, setOpenRequests] = useState<SubstituteRequest[]>([]);
  const [myRequests, setMyRequests] = useState<SubstituteRequest[]>([]);
  const [clubRequests, setClubRequests] = useState<SubstituteRequest[]>([]);
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [groupList, open, mine, club] = await Promise.all([
        api.get<Group[]>("/api/groups"),
        api.get<SubstituteRequest[]>("/api/substitute-requests/open"),
        api.get<SubstituteRequest[]>("/api/substitute-requests/mine"),
        isJugendleiter ? api.get<SubstituteRequest[]>("/api/substitute-requests/club") : Promise.resolve([]),
      ]);
      const writable = groupList.filter((g) => g.canEdit);
      setGroups(writable);
      setOpenRequests(open);
      setMyRequests(mine);
      setClubRequests(club);
      if (writable.length > 0 && !groupId) setGroupId(writable[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!groupId || !date) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.post("/api/substitute-requests", { groupId, date, note: note || null });
      setInfo("Vertretungs-Anfrage veröffentlicht.");
      setDate("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anlegen");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(id: string) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.post(`/api/substitute-requests/${id}/claim`, {});
      setInfo("Vertretung übernommen – zählt jetzt in deinem Stundennachweis.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Übernehmen");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/substitute-requests/${id}/cancel`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn(id: string) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await api.post(`/api/substitute-requests/${id}/return`, {});
      setInfo("Vertretung zurückgegeben – die Schreibrechte für den Termin liegen wieder bei der Gruppenleitung.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückgeben");
    } finally {
      setBusy(false);
    }
  }

  const openRequestsFromOthers = openRequests.filter((r) => r.requestedBy !== userId && !r.archivedAt);
  const pendingMine = myRequests.filter((r) => r.status === "open" && r.requestedBy === userId && !r.archivedAt);
  // Verstrichene, nie übernommene Anfragen - nur noch zur Nachvollziehbarkeit,
  // nicht mehr übernehmbar.
  const expiredMine = myRequests.filter((r) => r.requestedBy === userId && r.archivedAt);
  // Übernommen von mir (ich bin die Vertretung, habe also aktuell die
  // Schreibrechte für den Termin) vs. von mir vergeben (jemand anderes
  // vertritt mich gerade) - beide können den Termin per "return" wieder an
  // die ursprüngliche Gruppenleitung zurückgeben.
  const claimedByMe = myRequests.filter((r) => r.status === "claimed" && r.claimedBy === userId);
  const claimedFromMe = myRequests.filter((r) => r.status === "claimed" && r.requestedBy === userId);
  const resolvedMine = myRequests.filter((r) => r.status === "cancelled" || r.status === "returned");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Vertretungsbörse</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Kannst du eine Turnstunde nicht selbst leiten? Hier suchst du eine Vertretung – die Stunde zählt dann
          automatisch im Stundennachweis der übernehmenden Person statt in deinem.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-56">
          <FloatingSelect label="Gruppe" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-44">
          <FloatingInput label="Termin" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <FloatingInput label="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button
          type="submit"
          disabled={busy || !groupId || !date}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Vertretung suchen
        </button>
        {groups.length === 0 && (
          <p className="w-full text-xs text-slate-400 dark:text-slate-500">Du hast keine eigenen Gruppen, für die du eine Vertretung suchen könntest.</p>
        )}
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Offene Anfragen im Verein ({openRequestsFromOthers.length})
            </h3>
            {openRequestsFromOthers.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Aktuell keine offenen Vertretungs-Anfragen.</p>
            ) : (
              <ul className="space-y-2">
                {openRequestsFromOthers.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
                  >
                    <span className="text-amber-900 dark:text-amber-200">
                      {formatDate(r.sessionDate)} · {r.groupName} · gesucht von {r.requestedByName ?? "unbekannt"}
                      {r.note ? ` · „${r.note}“` : ""}
                    </span>
                    <button
                      onClick={() => handleClaim(r.id)}
                      disabled={busy}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Übernehmen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pendingMine.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Meine offenen Anfragen ({pendingMine.length})
              </h3>
              <ul className="space-y-2">
                {pendingMine.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="text-slate-700 dark:text-slate-300">
                      {formatDate(r.sessionDate)} · {r.groupName} · wartet auf Übernahme
                    </span>
                    <button
                      onClick={() => handleCancel(r.id)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Zurückziehen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {expiredMine.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Abgelaufene Anfragen ({expiredMine.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Der Termin ist verstrichen, ohne dass jemand übernommen hat. Diese Anfragen sind nur noch zur
                Nachvollziehbarkeit hier und können nicht mehr übernommen werden.
              </p>
              <ul className="space-y-1 text-sm text-slate-500 dark:text-slate-400">
                {expiredMine.map((r) => (
                  <li key={r.id}>
                    {formatDate(r.sessionDate)} · {r.groupName} · abgelaufen
                    {r.note ? ` · „${r.note}“` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {claimedByMe.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Von mir übernommene Vertretungen ({claimedByMe.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Du hast für diese Termine gerade die Schreibrechte – die ursprüngliche Gruppenleitung kann für diese
                Tage keine Anwesenheit mehr erfassen, bis du zurückgibst.
              </p>
              <ul className="space-y-2">
                {claimedByMe.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40"
                  >
                    <span className="text-emerald-900 dark:text-emerald-200">
                      {formatDate(r.sessionDate)} · {r.groupName} · für {r.requestedByName ?? "jemanden"}
                    </span>
                    <button
                      onClick={() => handleReturn(r.id)}
                      disabled={busy}
                      className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                    >
                      Zurückgeben
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {claimedFromMe.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Meine vergebenen Vertretungen ({claimedFromMe.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Diese Termine werden aktuell von einer Vertretung geleitet und zählen in deren Stundennachweis. Bei
                Bedarf kannst du die Stunde kurzfristig wieder selbst übernehmen.
              </p>
              <ul className="space-y-2">
                {claimedFromMe.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="text-slate-700 dark:text-slate-300">
                      {formatDate(r.sessionDate)} · {r.groupName} · übernommen von {r.claimedByName ?? "jemandem"}
                    </span>
                    <button
                      onClick={() => handleReturn(r.id)}
                      disabled={busy}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Kurzfristig zurückholen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resolvedMine.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Verlauf</h3>
              <ul className="space-y-1 text-sm text-slate-500 dark:text-slate-400">
                {resolvedMine.map((r) => (
                  <li key={r.id}>
                    {formatDate(r.sessionDate)} · {r.groupName} ·{" "}
                    {r.status === "returned"
                      ? r.requestedBy === userId
                        ? `Vertretung zurückgegeben von ${r.claimedByName ?? "jemandem"}`
                        : `du hast die Vertretung zurückgegeben an ${r.requestedByName ?? "jemanden"}`
                      : "zurückgezogen"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isJugendleiter && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Vereinsweiter Verlauf ({clubRequests.length})
              </h3>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                Als Jugendleitung siehst du alle Vertretungs-Anfragen des Vereins und kannst auch fremde Anfragen
                zurückziehen bzw. übernommene Vertretungen zurückgeben.
              </p>
              {clubRequests.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">Noch keine Vertretungs-Anfragen im Verein.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {clubRequests.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <span className="text-slate-700 dark:text-slate-300">
                        {formatDate(r.sessionDate)} · {r.groupName} · gesucht von {r.requestedByName ?? "unbekannt"}
                        {r.status === "open" && !r.archivedAt && " · offen"}
                        {r.status === "open" && r.archivedAt && " · abgelaufen"}
                        {r.status === "claimed" && ` · übernommen von ${r.claimedByName ?? "jemandem"}`}
                        {r.status === "cancelled" && " · zurückgezogen"}
                        {r.status === "returned" && " · zurückgegeben"}
                      </span>
                      {r.status === "open" && !r.archivedAt && (
                        <button
                          onClick={() => handleCancel(r.id)}
                          disabled={busy}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Zurückziehen
                        </button>
                      )}
                      {r.status === "claimed" && (
                        <button
                          onClick={() => handleReturn(r.id)}
                          disabled={busy}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          Zurückgeben
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
