import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { AttendanceEntry, AttendanceSession, Child, ClubMember, Group, SubstituteRequest } from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { useAuth } from "../../context/useAuth";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

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
  const { userId, clubId } = useAuth();
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [members, setMembers] = useState<ClubMember[]>([]);
  // Termine, die der/die Nutzer:in aktuell als Vertretung übernommen hat -
  // für diese ist die Gruppe auch ohne eigenes Besitzrecht auswählbar, aber
  // nur genau an diesem einen Tag (siehe validDatesFor()).
  const [myClaims, setMyClaims] = useState<SubstituteRequest[]>([]);
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
      await api.put(`/api/attendance/${groupId}/${date}`, {
        entries,
        ledBy: ledBy || null,
        startTime: isSpecial ? overrideStartTime || null : null,
        endTime: isSpecial ? overrideEndTime || null : null,
        location: isSpecial ? overrideLocation || null : null,
        note: isSpecial ? overrideNote || null : null,
      });
      setSavedMessage("Anwesenheit gespeichert.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setSaving(false);
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

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isSpecial}
            onChange={(e) => setIsSpecial(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-emerald-600"
          />
          Abweichender Termin (z.B. Turnier) – andere Uhrzeit/Ort als sonst
        </label>
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
      ) : !dateValid ? null : (
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

      <button
        onClick={handleSave}
        disabled={saving || groupChildren.length === 0 || !dateValid}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
      >
        {saving ? "Speichert…" : "Anwesenheit speichern"}
      </button>
    </div>
  );
}
