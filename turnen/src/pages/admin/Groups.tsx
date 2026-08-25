import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { CapacityRequest, Child, ClubMember, Group, GroupCoLeader, MoveRequest, WaitlistEntry } from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { useAuth } from "../../context/useAuth";
import { CAPACITY_CANCELLED, withCapacityConfirm } from "../../lib/capacityConfirm";

type CapacityLevel = "unset" | "ok" | "warn" | "over";

const CAPACITY_BADGE_CLASSES: Record<CapacityLevel, string> = {
  unset: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  over: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function capacityLevel(count: number, max: number | null): CapacityLevel {
  if (max === null || max === 0) return "unset";
  const ratio = count / max;
  if (ratio <= 1) return "ok";
  if (ratio <= 1.15) return "warn";
  return "over";
}

function scheduleLabel(g: Group): string | null {
  if (g.weekday === null && !g.startTime) return null;
  const day = g.weekday !== null ? WEEKDAY_SHORT[g.weekday] : "";
  const time = g.startTime && g.endTime ? `${g.startTime}–${g.endTime}` : g.startTime ?? "";
  return [day, time].filter(Boolean).join(" ");
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Zwei Gruppen kollidieren, wenn sie denselben Ort, denselben Wochentag und
// eine überlappende Uhrzeit haben.
function findScheduleConflicts(groups: Group[]): { a: Group; b: Group }[] {
  const withSchedule = groups.filter((g) => g.location && g.weekday !== null && g.startTime && g.endTime);
  const conflicts: { a: Group; b: Group }[] = [];
  for (let i = 0; i < withSchedule.length; i++) {
    for (let j = i + 1; j < withSchedule.length; j++) {
      const a = withSchedule[i];
      const b = withSchedule[j];
      if (a.location !== b.location || a.weekday !== b.weekday) continue;
      const aStart = timeToMinutes(a.startTime as string);
      const aEnd = timeToMinutes(a.endTime as string);
      const bStart = timeToMinutes(b.startTime as string);
      const bEnd = timeToMinutes(b.endTime as string);
      if (aStart < bEnd && bStart < aEnd) conflicts.push({ a, b });
    }
  }
  return conflicts;
}

export default function Groups() {
  const { userId, clubId, clubName, clubRole } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<MoveRequest[]>([]);
  const [incomingCapacityRequests, setIncomingCapacityRequests] = useState<CapacityRequest[]>([]);
  const [waitlist, setWaitlist] = useState<Record<string, WaitlistEntry[]>>({});
  const [coLeaders, setCoLeaders] = useState<Record<string, GroupCoLeader[]>>({});
  const [clubMembers, setClubMembers] = useState<ClubMember[]>([]);
  const [addCoLeaderSelection, setAddCoLeaderSelection] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [minAge, setMinAge] = useState("3");
  const [maxAge, setMaxAge] = useState("6");
  const [maxChildren, setMaxChildren] = useState("");
  const [weekday, setWeekday] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([api.get<Group[]>("/api/groups"), api.get<Child[]>("/api/children")]);
      setGroups(g);
      setChildren(c);
      const writable = g.filter((group) => group.canEdit);
      const [lists, coLeaderLists] = await Promise.all([
        Promise.all(writable.map((group) => api.get<WaitlistEntry[]>(`/api/groups/${group.id}/waitlist`).catch(() => []))),
        Promise.all(writable.map((group) => api.get<GroupCoLeader[]>(`/api/groups/${group.id}/co-leaders`).catch(() => []))),
      ]);
      const map: Record<string, WaitlistEntry[]> = {};
      const coLeaderMap: Record<string, GroupCoLeader[]> = {};
      writable.forEach((group, i) => {
        if (lists[i].length > 0) map[group.id] = lists[i];
        coLeaderMap[group.id] = coLeaderLists[i];
      });
      setWaitlist(map);
      setCoLeaders(coLeaderMap);
      if (clubId) setClubMembers(await api.get<ClubMember[]>("/api/clubs/mine/members"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  async function loadMoveRequests() {
    try {
      setIncomingRequests(await api.get<MoveRequest[]>("/api/move-requests/incoming"));
    } catch {
      // Anfragen sind ein Zusatzfeature - ein Ladefehler soll die restliche
      // Seite nicht blockieren.
    }
  }

  async function loadCapacityRequests() {
    try {
      setIncomingCapacityRequests(await api.get<CapacityRequest[]>("/api/capacity-requests/incoming"));
    } catch {
      // s.o.
    }
  }

  useEffect(() => {
    load();
    loadMoveRequests();
    loadCapacityRequests();
  }, []);

  function startEdit(g: Group) {
    setEditingId(g.id);
    setName(g.name);
    setMinAge(String(g.minAge));
    setMaxAge(String(g.maxAge));
    setMaxChildren(g.maxChildren != null ? String(g.maxChildren) : "");
    setWeekday(g.weekday != null ? String(g.weekday) : "");
    setStartTime(g.startTime ?? "");
    setEndTime(g.endTime ?? "");
    setLocation(g.location ?? "");
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setMinAge("3");
    setMaxAge("6");
    setMaxChildren("");
    setWeekday("");
    setStartTime("");
    setEndTime("");
    setLocation("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        name,
        minAge: Number(minAge),
        maxAge: Number(maxAge),
        sortOrder: Number(minAge),
        maxChildren: maxChildren === "" ? null : Number(maxChildren),
        weekday: weekday === "" ? null : Number(weekday),
        startTime: startTime || null,
        endTime: endTime || null,
        location: location || null,
      };
      if (editingId) await api.put(`/api/groups/${editingId}`, payload);
      else await api.post("/api/groups", payload);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Gruppe wirklich löschen? Zugewiesene Kinder verlieren die Gruppenzuordnung.")) return;
    try {
      await api.del(`/api/groups/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  async function handleClaim(id: string) {
    setError(null);
    try {
      await api.post(`/api/groups/${id}/claim`, {});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zuordnen");
    }
  }

  async function handleApproveRequest(id: string) {
    setError(null);
    try {
      const result = await withCapacityConfirm((confirmOverCapacity) =>
        api.post(`/api/move-requests/${id}/approve`, { confirmOverCapacity })
      );
      if (result === CAPACITY_CANCELLED) return;
      await Promise.all([load(), loadMoveRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    }
  }

  async function handleRejectRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/move-requests/${id}/reject`, {});
      await loadMoveRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    }
  }

  async function handleApproveCapacityRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/capacity-requests/${id}/approve`, {});
      await Promise.all([load(), loadCapacityRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    }
  }

  async function handleRejectCapacityRequest(id: string) {
    setError(null);
    try {
      await api.post(`/api/capacity-requests/${id}/reject`, {});
      await loadCapacityRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    }
  }

  async function handleAddCoLeader(groupId: string) {
    const targetUserId = addCoLeaderSelection[groupId];
    if (!targetUserId) return;
    setError(null);
    try {
      await api.post(`/api/groups/${groupId}/co-leaders`, { userId: targetUserId });
      setAddCoLeaderSelection((prev) => ({ ...prev, [groupId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Hinzufügen");
    }
  }

  async function handleRemoveCoLeader(groupId: string, targetUserId: string) {
    setError(null);
    try {
      await api.del(`/api/groups/${groupId}/co-leaders/${targetUserId}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Entfernen");
    }
  }

  async function handleCancelWaitlistEntry(id: string) {
    setError(null);
    try {
      await api.del(`/api/waitlist/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Entfernen");
    }
  }

  const scheduleConflicts = useMemo(() => findScheduleConflicts(groups), [groups]);

  function capacityActionLabel(action: CapacityRequest["action"]): string {
    switch (action) {
      case "create_child":
        return "neu anlegen";
      case "update_child":
        return "bearbeiten";
      case "move_child":
      case "approve_move_request":
        return "verschieben";
      default:
        return action;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Gruppen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Altersgruppen, z.B. Minis 3–6 Jahre, Kids 6–9 Jahre.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[160px]">
          <FloatingInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Min. Alter"
            type="number"
            min={0}
            max={25}
            required
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
          />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Max. Alter"
            type="number"
            min={0}
            max={25}
            required
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
          />
        </div>
        <div className="w-36">
          <FloatingInput
            label="Max. Kinder"
            type="number"
            min={0}
            required
            value={maxChildren}
            onChange={(e) => setMaxChildren(e.target.value)}
          />
        </div>
        <div className="w-full" />
        <div className="w-40">
          <FloatingSelect label="Trainingstag" required value={weekday} onChange={(e) => setWeekday(e.target.value)}>
            <option value="">–</option>
            {WEEKDAY_NAMES.map((day, i) => (
              <option key={i} value={i}>
                {day}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-28">
          <FloatingInput label="Von" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="w-28">
          <FloatingInput label="Bis" type="time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <div className="w-full" />
        <div className="w-40">
          <FloatingInput
            label="Ort/Halle"
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600">
          {editingId ? "Speichern" : "Anlegen"}
        </button>
        {editingId && (
          <button
            type="button"
            onClick={resetForm}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Abbrechen
          </button>
        )}
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {scheduleConflicts.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
          <h3 className="mb-1 text-sm font-semibold text-red-800 dark:text-red-300">
            Hallenbelegungs-Konflikt ({scheduleConflicts.length})
          </h3>
          <ul className="space-y-1 text-sm text-red-900 dark:text-red-200">
            {scheduleConflicts.map(({ a, b }, i) => (
              <li key={i}>
                „{a.name}“ und „{b.name}“ überschneiden sich am {WEEKDAY_NAMES[a.weekday as number]} in {a.location}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Altersspanne</th>
                <th className="px-4 py-2 font-medium">Training</th>
                <th className="px-4 py-2 font-medium">Kinder</th>
                <th className="px-4 py-2 font-medium">Turnleiter</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const count = children.filter((c) => c.groupId === g.id).length;
                const level = capacityLevel(count, g.maxChildren);
                const label = g.maxChildren != null ? `${count} / ${g.maxChildren}` : `${count}`;
                const requestsForGroup = incomingRequests.filter((r) => r.toGroupId === g.id);
                const capacityRequestsForGroup = incomingCapacityRequests.filter((r) => r.groupId === g.id);
                const waitlistForGroup = waitlist[g.id] ?? [];
                const schedule = scheduleLabel(g);
                return (
                <Fragment key={g.id}>
                <tr className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{g.name}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {g.minAge}–{g.maxAge} Jahre
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {schedule ?? "–"}
                    {g.location && <span className="block text-xs text-slate-400 dark:text-slate-500">{g.location}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAPACITY_BADGE_CLASSES[level]}`}>
                      {label}
                    </span>
                    {waitlistForGroup.length > 0 && (
                      <span className="ml-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                        +{waitlistForGroup.length} Warteliste
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                    {g.editableAsLeadership && g.ownerId !== null ? (
                      <span
                        className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                        title={`Als Jugendleitung bearbeitbar – Gruppenleitung: ${g.ownerName ?? "unbekannt"}`}
                      >
                        Jugendleitung ({g.ownerName ?? "unbekannt"})
                      </span>
                    ) : g.canEdit && g.ownerId !== null && g.ownerId !== userId ? (
                      <span
                        className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                        title={`Mit-Trainer*in – Gruppenleitung: ${g.ownerName ?? "unbekannt"}`}
                      >
                        Mit-Trainer*in ({g.ownerName ?? "unbekannt"})
                      </span>
                    ) : g.canEdit && g.ownerId !== null ? (
                      <span className="flex flex-col text-xs leading-tight">
                        <span className="text-slate-400 dark:text-slate-500">eigene Gruppe</span>
                        {g.clubId ? (
                          <span
                            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                            title="Für andere Mitglieder dieses Vereins lesend sichtbar"
                          >
                            ✓ {g.clubId === clubId ? clubName : "Verein"}
                          </span>
                        ) : (
                          <span
                            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                            title="Keinem Verein zugeordnet – für andere Turnleiter nicht sichtbar"
                          >
                            kein Verein
                          </span>
                        )}
                      </span>
                    ) : g.canEdit && g.ownerId === null ? (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        title="Noch keinem Turnleiter/Verein zugeordnet – aktuell für alle bearbeitbar"
                      >
                        unzugeordnet
                      </span>
                    ) : (
                      <span
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        title="Nur lesbar – gehört einem anderen Turnleiter im Verein"
                      >
                        {g.ownerName ?? "anderer Turnleiter"} · nur lesbar
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {g.canEdit ? (
                      <>
                        {g.ownerId === null && (
                          <button
                            onClick={() => handleClaim(g.id)}
                            disabled={!clubId || clubRole !== "jugendleiter"}
                            title={
                              !clubId
                                ? "Erst einem Verein beitreten, um Gruppen zuzuordnen"
                                : clubRole !== "jugendleiter"
                                  ? "Nur die Jugendleitung kann Gruppen dem Verein zuordnen"
                                  : `Dieser Gruppe deinen Verein (${clubName}) zuordnen`
                            }
                            className="mr-3 text-sm text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline dark:text-emerald-400 dark:disabled:text-slate-600"
                          >
                            Verein zuordnen
                          </button>
                        )}
                        <button onClick={() => startEdit(g)} className="mr-3 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
                          Bearbeiten
                        </button>
                        <button onClick={() => handleDelete(g.id)} className="text-sm text-red-600 hover:underline dark:text-red-400">
                          Löschen
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-slate-300 dark:text-slate-600">–</span>
                    )}
                  </td>
                </tr>
                {requestsForGroup.length > 0 && (
                  <tr className="border-t border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                    <td colSpan={6} className="px-4 py-2">
                      <p className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        Offene Verschiebe-Anfragen für „{g.name}“ ({requestsForGroup.length})
                      </p>
                      <ul className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
                        {requestsForGroup.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {r.childName} – von {r.fromGroupName ?? "keine Gruppe"}
                              {r.requestedByName ? ` (angefragt von ${r.requestedByName})` : ""}
                            </span>
                            <span className="flex gap-2">
                              <button
                                onClick={() => handleApproveRequest(r.id)}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              >
                                Freigeben
                              </button>
                              <button
                                onClick={() => handleRejectRequest(r.id)}
                                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                Ablehnen
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                {capacityRequestsForGroup.length > 0 && (
                  <tr className="border-t border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
                    <td colSpan={6} className="px-4 py-2">
                      <p className="mb-1 text-xs font-semibold text-red-800 dark:text-red-300">
                        Kapazitäts-Anfragen für „{g.name}“ ({capacityRequestsForGroup.length})
                      </p>
                      <ul className="space-y-1 text-sm text-red-900 dark:text-red-200">
                        {capacityRequestsForGroup.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {r.childName} ({capacityActionLabel(r.action)})
                              {r.requestedByName ? ` · angefragt von ${r.requestedByName}` : ""}
                            </span>
                            <span className="flex gap-2">
                              <button
                                onClick={() => handleApproveCapacityRequest(r.id)}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                              >
                                Freigeben
                              </button>
                              <button
                                onClick={() => handleRejectCapacityRequest(r.id)}
                                className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                Ablehnen
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
                {g.canEdit && g.ownerId === userId && (
                  <tr className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
                    <td colSpan={6} className="px-4 py-2">
                      <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Mit-Trainer*innen für „{g.name}“ – gleichberechtigte Leitung, kein einzelner Vertretungstermin
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {(coLeaders[g.id] ?? []).map((cl) => (
                          <span
                            key={cl.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                          >
                            {cl.name ?? cl.email}
                            <button
                              type="button"
                              onClick={() => handleRemoveCoLeader(g.id, cl.id)}
                              aria-label={`${cl.name ?? cl.email} als Mit-Trainer*in entfernen`}
                              className="text-emerald-500 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-100"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <select
                          value={addCoLeaderSelection[g.id] ?? ""}
                          onChange={(e) => setAddCoLeaderSelection((prev) => ({ ...prev, [g.id]: e.target.value }))}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <option value="">+ Mit-Trainer*in hinzufügen…</option>
                          {clubMembers
                            .filter((m) => m.id !== userId && !(coLeaders[g.id] ?? []).some((cl) => cl.id === m.id))
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name ?? m.email}
                              </option>
                            ))}
                        </select>
                        <button
                          onClick={() => handleAddCoLeader(g.id)}
                          disabled={!addCoLeaderSelection[g.id]}
                          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Hinzufügen
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {waitlistForGroup.length > 0 && (
                  <tr className="border-t border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30">
                    <td colSpan={6} className="px-4 py-2">
                      <p className="mb-1 text-xs font-semibold text-purple-800 dark:text-purple-300">
                        Warteliste für „{g.name}“ ({waitlistForGroup.length})
                      </p>
                      <ol className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
                        {waitlistForGroup.map((w) => (
                          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {w.position}. {w.childName}
                              {w.requestedByName ? ` · eingetragen von ${w.requestedByName}` : ""}
                            </span>
                            <button
                              onClick={() => handleCancelWaitlistEntry(w.id)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              Entfernen
                            </button>
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {groups.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Noch keine Gruppen angelegt.
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
