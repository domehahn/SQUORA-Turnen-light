import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type {
  AttendanceEntry,
  AttendanceSession,
  Child,
  ClubMember,
  Group,
  SessionOverrideRequest,
  SubstituteRequest,
} from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { useAuth } from "../../context/useAuth";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

interface PendingOverrideApproval {
  status: "pending_override_approval";
  requestId: string;
  groupName: string;
}

function isPendingOverrideApproval(value: unknown): value is PendingOverrideApproval {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: unknown }).status === "pending_override_approval"
  );
}

// Bewusst NICHT toISOString() (rechnet nach UTC um - in Europe/Berlin kann
// lokale Mitternacht dadurch auf den Vortag fallen), sondern die lokalen
// Datumsanteile direkt formatieren.
function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function Attendance() {
  const { userId, clubId, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  // Termine, die der/die Nutzer:in aktuell als Vertretung übernommen hat -
  // für diese ist die Gruppe auch ohne eigenes Besitzrecht auswählbar, aber
  // nur genau an diesem einen Tag (siehe validDatesFor()).
  const [myClaims, setMyClaims] = useState<SubstituteRequest[]>([]);
  const [myOverrideRequests, setMyOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [incomingOverrideRequests, setIncomingOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(today());
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [ledBy, setLedBy] = useState<string>(userId ?? "");
  const [isSpecial, setIsSpecial] = useState(false);
  const [overrideStartTime, setOverrideStartTime] = useState("");
  const [overrideEndTime, setOverrideEndTime] = useState("");
  const [overrideLocation, setOverrideLocation] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState("");
  const [cancelling, setCancelling] = useState(false);
  // Gesetzt, wenn dieser Termin an eine Vertretung übergeben wurde und der/die
  // aktuelle Nutzer:in NICHT die Vertretung ist - dann ist die Erfassung
  // gesperrt (wie bei einer Absage) und die Stunde wird der Vertretung
  // angerechnet.
  const [handedToSubstitute, setHandedToSubstitute] = useState<{ name: string | null } | null>(null);
  // Gesetzt, wenn für diesen Termin eine Vertretung angefragt wurde, die noch
  // niemand übernommen hat - reiner Hinweis, blockiert die Erfassung nicht.
  const [substituteRequested, setSubstituteRequested] = useState(false);
  const blocked = cancelled || handedToSubstitute !== null;

  async function loadOverrideRequests() {
    try {
      const mine = await api.get<SessionOverrideRequest[]>("/api/session-override-requests/mine");
      setMyOverrideRequests(mine.filter((r) => r.status === "pending"));
    } catch {
      // Zusatzinfo - Ladefehler soll die restliche Seite nicht blockieren.
    }
    if (isJugendleiter) {
      try {
        setIncomingOverrideRequests(await api.get<SessionOverrideRequest[]>("/api/session-override-requests/incoming"));
      } catch {
        // s.o.
      }
    }
  }

  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      try {
        const [groupList, childrenList, claims] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
          api.get<SubstituteRequest[]>("/api/substitute-requests/mine"),
        ]);
        setAllGroups(groupList);
        setChildren(childrenList);
        setMyClaims(claims.filter((r) => r.status === "claimed" && r.claimedBy === userId));
        const writableGroups = groupList.filter((g) => g.canEdit);
        if (writableGroups.length > 0) setGroupId(writableGroups[0].id);
        if (clubId) setMembers(await api.get<ClubMember[]>("/api/clubs/mine/members"));
        await loadOverrideRequests();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auswählbare Gruppen: die eigenen (beschreibbaren) plus die, für die
  // aktuell eine Vertretung übernommen wurde - auch wenn die Gruppe sonst
  // jemand anderem gehört.
  const groups = useMemo(() => {
    const writable = allGroups.filter((g) => g.canEdit);
    const claimedGroupIds = new Set(myClaims.map((r) => r.groupId));
    const extra = allGroups.filter((g) => !g.canEdit && claimedGroupIds.has(g.id));
    return [...writable, ...extra];
  }, [allGroups, myClaims]);

  const currentGroup = groups.find((g) => g.id === groupId);

  // An welchen Tagen darf für die gewählte Gruppe Anwesenheit erfasst
  // werden? Normal nur der konfigurierte Trainingstag; zusätzlich jeder Tag,
  // an dem gerade eine eigene Vertretung übernommen wurde (kann vom
  // Wochentag abweichen bzw. eine fremde Gruppe betreffen).
  const claimedDatesForGroup = useMemo(
    () => new Set(myClaims.filter((r) => r.groupId === groupId).map((r) => r.sessionDate)),
    [myClaims, groupId]
  );
  const isSubstituteDate = claimedDatesForGroup.has(date);
  const dateValid =
    !currentGroup ||
    isSubstituteDate ||
    currentGroup.weekday === null ||
    new Date(`${date}T00:00:00`).getDay() === currentGroup.weekday;

  useEffect(() => {
    async function loadAttendance() {
      if (!groupId || !date || !dateValid) return;
      setError(null);
      setSavedMessage(null);
      setHandedToSubstitute(null);
      setSubstituteRequested(false);
      try {
        // Vertretungs-Status prüfen: "claimed" (nicht von mir) sperrt die
        // Erfassung, "open" ist nur ein Hinweis. Bei "claimed" würde ein
        // GET /api/attendance/... ohnehin mit 403 antworten.
        const subs = await api.get<
          Record<string, { status: "open" | "claimed"; claimedBy: string | null; claimedByName: string | null }>
        >(`/api/attendance-substitutes/${groupId}?from=${date}&to=${date}`);
        const sub = subs[date];
        if (sub?.status === "claimed" && sub.claimedBy !== userId) {
          setHandedToSubstitute({ name: sub.claimedByName });
          return;
        }
        if (sub?.status === "open") setSubstituteRequested(true);
      } catch {
        // Sperr-Info ist Zusatz - ein Ladefehler soll die Seite nicht blockieren.
      }
      try {
        const session = await api.get<AttendanceSession>(`/api/attendance/${groupId}/${date}`);
        const map: Record<string, boolean> = {};
        for (const entry of session.entries) map[entry.childId] = entry.present;
        setPresent(map);
        setLedBy(session.ledBy ?? userId ?? "");
        const hasOverride = Boolean(session.startTime || session.endTime || session.location || session.note);
        setIsSpecial(hasOverride);
        setOverrideStartTime(session.startTime ?? "");
        setOverrideEndTime(session.endTime ?? "");
        setOverrideLocation(session.location ?? "");
        setOverrideNote(session.note ?? "");
        setCancelled(session.cancelled);
        setCancelReason(session.cancelReason);
        setShowCancelForm(false);
        setCancelReasonInput("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden der Anwesenheit");
      }
    }
    loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, date, userId, dateValid]);

  const groupChildren = children.filter((c) => c.groupId === groupId);

  function toggle(childId: string) {
    setPresent((prev) => ({ ...prev, [childId]: !prev[childId] }));
  }

  async function handleSave() {
    if (!dateValid) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const entries: AttendanceEntry[] = groupChildren.map((c) => ({
        childId: c.id,
        present: present[c.id] ?? false,
      }));
      const result = await api.put<{ ok: true } | PendingOverrideApproval>(`/api/attendance/${groupId}/${date}`, {
        entries,
        ledBy: ledBy || null,
        startTime: isSpecial ? overrideStartTime || null : null,
        endTime: isSpecial ? overrideEndTime || null : null,
        location: isSpecial ? overrideLocation || null : null,
        note: isSpecial ? overrideNote || null : null,
      });
      if (isPendingOverrideApproval(result)) {
        setSavedMessage(
          `Anwesenheit gespeichert. Der abweichende Termin für „${result.groupName}“ wartet noch auf Freigabe der Jugendleitung.`
        );
        await loadOverrideRequests();
      } else {
        setSavedMessage("Anwesenheit gespeichert.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelSession() {
    setCancelling(true);
    setError(null);
    setSavedMessage(null);
    try {
      await api.post(`/api/attendance/${groupId}/${date}/cancel`, { reason: cancelReasonInput || null });
      setCancelled(true);
      setCancelReason(cancelReasonInput || null);
      setShowCancelForm(false);
      setSavedMessage("Termin abgesagt.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Absagen");
    } finally {
      setCancelling(false);
    }
  }

  async function handleUncancelSession() {
    setCancelling(true);
    setError(null);
    setSavedMessage(null);
    try {
      await api.post(`/api/attendance/${groupId}/${date}/uncancel`, {});
      setCancelled(false);
      setCancelReason(null);
      setSavedMessage("Absage aufgehoben.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Aufheben");
    } finally {
      setCancelling(false);
    }
  }

  async function handleCancelOverrideRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/session-override-requests/${id}/cancel`, {});
      await loadOverrideRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    }
  }

  async function handleApproveOverrideRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/session-override-requests/${id}/approve`, {});
      await loadOverrideRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    }
  }

  async function handleRejectOverrideRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/session-override-requests/${id}/reject`, {});
      await loadOverrideRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    }
  }

  const presentCount = groupChildren.filter((c) => present[c.id]).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Anwesenheit</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Anwesenheitsliste für eine Gruppe an einem bestimmten Termin.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-56">
          <FloatingSelect label="Gruppe" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.minAge}–{g.maxAge} Jahre)
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-44">
          <FloatingInput label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {isSubstituteDate && (
          <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
            Vertretungstermin
          </span>
        )}
        {members.length > 0 && (
          <div className="w-56">
            <FloatingSelect label="Wer hat geleitet?" value={ledBy} onChange={(e) => setLedBy(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </FloatingSelect>
          </div>
        )}
        <div className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          {presentCount} von {groupChildren.length} anwesend
        </div>
      </div>

      {dateValid && groupId && handedToSubstitute && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <span className="font-medium">An Vertretung übergeben.</span>{" "}
            {handedToSubstitute.name
              ? `${handedToSubstitute.name} übernimmt diesen Termin.`
              : "Eine Vertretung übernimmt diesen Termin."}{" "}
            Die Anwesenheit für diesen Termin kannst du nicht erfassen – die Stunde wird der Vertretung
            angerechnet. Über die Vertretungsbörse lässt sich der Termin zurückholen.
          </p>
        </div>
      )}

      {dateValid && groupId && !handedToSubstitute && substituteRequested && !cancelled && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/40">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <span className="font-medium">Für diesen Termin wurde eine Vertretung angefragt.</span> Noch hat sie
            niemand übernommen – bis dahin kannst du die Anwesenheit normal erfassen. Sobald jemand übernimmt, wird
            die Erfassung gesperrt und die Stunde der Vertretung angerechnet.
          </p>
        </div>
      )}

      {dateValid && groupId && !handedToSubstitute && (
        <div
          className={`rounded-lg border p-4 ${
            cancelled
              ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
              : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          }`}
        >
          {cancelled ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-red-800 dark:text-red-300">
                <span className="font-medium">Training fällt aus.</span>
                {cancelReason ? ` Grund: ${cancelReason}` : ""}
              </p>
              <button
                onClick={handleUncancelSession}
                disabled={cancelling}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-900/50"
              >
                Absage aufheben
              </button>
            </div>
          ) : showCancelForm ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <FloatingInput
                  label="Grund (optional), z.B. „Ferien“ oder „Trainer krank“"
                  value={cancelReasonInput}
                  onChange={(e) => setCancelReasonInput(e.target.value)}
                />
              </div>
              <button
                onClick={handleCancelSession}
                disabled={cancelling}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Termin absagen
              </button>
              <button
                onClick={() => setShowCancelForm(false)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Abbrechen
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCancelForm(true)}
              className="text-sm text-red-700 hover:underline dark:text-red-400"
            >
              Diesen Termin absagen (fällt aus)
            </button>
          )}
        </div>
      )}

      {!handedToSubstitute && (
      <div className={`rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${cancelled ? "opacity-50" : ""}`}>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isSpecial}
            disabled={cancelled}
            onChange={(e) => setIsSpecial(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-emerald-600"
          />
          Abweichender Termin (z.B. Turnier) – andere Uhrzeit/Ort als sonst
        </label>
        {isSpecial && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Wird zusammen mit der Anwesenheit über den Button „Anwesenheit speichern“ unten übernommen.
          </p>
        )}
        {isSpecial && !isJugendleiter && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Braucht die Freigabe der Jugendleitung, bevor der Termin wirksam wird - die Anwesenheit wird trotzdem
            sofort gespeichert.
          </p>
        )}
        {isSpecial && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-28">
              <FloatingInput
                label="Von"
                type="time"
                value={overrideStartTime}
                onChange={(e) => setOverrideStartTime(e.target.value)}
              />
            </div>
            <div className="w-28">
              <FloatingInput
                label="Bis"
                type="time"
                value={overrideEndTime}
                onChange={(e) => setOverrideEndTime(e.target.value)}
              />
            </div>
            <div className="w-44">
              <FloatingInput
                label="Ort (optional)"
                value={overrideLocation}
                onChange={(e) => setOverrideLocation(e.target.value)}
                placeholder={currentGroup?.location ?? ""}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <FloatingInput
                label="Bezeichnung, z.B. „Turnier in Simmern“"
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
      )}

      {incomingOverrideRequests.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            Anfragen für abweichende Termine ({incomingOverrideRequests.length})
          </h3>
          <ul className="space-y-2">
            {incomingOverrideRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-white p-3 text-sm dark:border-amber-800 dark:bg-slate-900"
              >
                <span className="text-slate-800 dark:text-slate-100">
                  {formatShortDate(r.sessionDate)} · {r.groupName}
                  {r.startTime && r.endTime ? ` · ${r.startTime}–${r.endTime}` : ""}
                  {r.location ? ` · ${r.location}` : ""}
                  {r.note ? ` · „${r.note}“` : ""}
                  {r.requestedByName ? ` · von ${r.requestedByName}` : ""}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => handleApproveOverrideRequest(r.id)}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Freigeben
                  </button>
                  <button
                    onClick={() => handleRejectOverrideRequest(r.id)}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    Ablehnen
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {myOverrideRequests.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Eigene offene Anfragen für abweichende Termine ({myOverrideRequests.length})
          </h3>
          <ul className="space-y-2">
            {myOverrideRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  {formatShortDate(r.sessionDate)} · {r.groupName} · wartet auf Freigabe der Jugendleitung
                </span>
                <button
                  onClick={() => handleCancelOverrideRequest(r.id)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Zurückziehen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {savedMessage && <p className="text-sm text-emerald-700 dark:text-emerald-400">{savedMessage}</p>}
      {!loading && currentGroup && !dateValid && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {currentGroup.weekday === null
            ? "Für diese Gruppe ist kein Trainingstag hinterlegt."
            : `„${currentGroup.name}“ trainiert nur ${WEEKDAY_NAMES[currentGroup.weekday]}s – wähle diesen Wochentag, oder einen Termin, den du als Vertretung übernommen hast.`}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : !dateValid || blocked ? null : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium text-right">Anwesend</th>
              </tr>
            </thead>
            <tbody>
              {groupChildren.map((child) => (
                <tr
                  key={child.id}
                  onClick={() => toggle(child.id)}
                  className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-emerald-50 dark:border-slate-800 dark:hover:bg-emerald-950/40"
                >
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                    {child.firstName} {child.lastName}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="checkbox"
                      checked={present[child.id] ?? false}
                      onChange={() => toggle(child.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </td>
                </tr>
              ))}
              {groupChildren.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Keine Kinder in dieser Gruppe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!blocked && (
        <button
          onClick={handleSave}
          disabled={saving || groupChildren.length === 0 || !dateValid}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {saving ? "Speichert…" : "Anwesenheit speichern"}
        </button>
      )}
    </div>
  );
}
