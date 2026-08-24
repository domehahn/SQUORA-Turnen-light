import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type {
  AttendanceSummary,
  CapacityRequest,
  Child,
  Group,
  MoveChildResponse,
  MoveRequest,
  PendingCapacityApproval,
  WaitlistEntry,
} from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { CAPACITY_CANCELLED, withCapacityConfirm } from "../../lib/capacityConfirm";
import {
  calculateAgeYears,
  formatMonthYear,
  groupForAge,
  nextGroup,
  nextGroupSwitchDate,
  switchUrgency,
  type SwitchUrgency,
} from "../../lib/age";

const emptyForm = {
  firstName: "",
  lastName: "",
  birthDate: "",
  groupId: "",
  notes: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  healthNotes: "",
};

const STALE_ATTENDANCE_WEEKS = 4;
const WAITLIST_PREFIX = "waitlist:";

function isPendingCapacityApproval(value: unknown): value is PendingCapacityApproval {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    (value as { status: unknown }).status === "pending_capacity_approval"
  );
}

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

interface UpcomingSwitch {
  child: Child;
  switchDate: Date;
  targetGroup: Group | undefined;
}

interface MismatchedChild {
  child: Child;
  currentGroup: Group;
  targetGroup: Group | undefined;
}

const URGENCY_SECTIONS: {
  urgency: SwitchUrgency;
  title: string;
  classes: string;
}[] = [
  {
    urgency: "next-month",
    title: "Wechsel im nächsten Monat",
    classes: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  },
  {
    urgency: "next-3-months",
    title: "Wechsel in den nächsten 3 Monaten",
    classes: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  },
  {
    urgency: "this-year",
    title: "Wechsel noch dieses Jahr",
    classes: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  },
];

export default function Children() {
  // Enthält auch ausgetretene (archivierte) Kinder - `children` weiter unten
  // filtert auf aktive, damit der ganze bestehende Code unverändert nur mit
  // aktiven Kindern arbeitet; `archivedChildren` bedient die eigene
  // Archiv-Ansicht.
  const [allChildren, setAllChildren] = useState<Child[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [moveSelection, setMoveSelection] = useState<Record<string, string>>({});
  const [incomingRequests, setIncomingRequests] = useState<MoveRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<MoveRequest[]>([]);
  const [incomingCapacityRequests, setIncomingCapacityRequests] = useState<CapacityRequest[]>([]);
  const [outgoingCapacityRequests, setOutgoingCapacityRequests] = useState<CapacityRequest[]>([]);
  const [myWaitlistEntries, setMyWaitlistEntries] = useState<WaitlistEntry[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<Record<string, AttendanceSummary>>({});
  const [search, setSearch] = useState("");
  const [printGroupIds, setPrintGroupIds] = useState<string[]>([]);

  // Geschwister-Verknüpfung: statt einer separat zu benennenden "Familie"
  // wählt man hier direkt die Geschwister aus der Kinder-Liste aus - das
  // Familien-Konzept dahinter ist reines Verknüpfungs-Werkzeug und bleibt
  // unsichtbar. `originalFamilyId` merkt sich beim Bearbeiten, in welcher
  // Familie das Kind vorher steckte, damit beim Speichern erkannt wird,
  // welche Geschwister entfernt wurden.
  const [siblingIds, setSiblingIds] = useState<string[]>([]);
  const [originalFamilyId, setOriginalFamilyId] = useState<string | null>(null);
  const [addSiblingValue, setAddSiblingValue] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [childrenList, groupList] = await Promise.all([
        api.get<Child[]>("/api/children?includeArchived=true"),
        api.get<Group[]>("/api/groups"),
      ]);
      setAllChildren(childrenList);
      setGroups(groupList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  const children = useMemo(() => allChildren.filter((c) => c.status === "active"), [allChildren]);
  const archivedChildren = useMemo(() => allChildren.filter((c) => c.status === "archived"), [allChildren]);

  async function handleArchive(id: string) {
    if (!confirm("Kind austreten lassen? Die Anwesenheitshistorie bleibt erhalten, das Kind kann jederzeit reaktiviert werden.")) return;
    setError(null);
    try {
      await api.post(`/api/children/${id}/archive`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Austragen");
    }
  }

  async function handleReactivate(id: string) {
    setError(null);
    try {
      await api.post(`/api/children/${id}/reactivate`, {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Reaktivieren");
    }
  }

  async function loadMoveRequests() {
    try {
      const [incoming, outgoing] = await Promise.all([
        api.get<MoveRequest[]>("/api/move-requests/incoming"),
        api.get<MoveRequest[]>("/api/move-requests/outgoing"),
      ]);
      setIncomingRequests(incoming);
      setOutgoingRequests(outgoing.filter((r) => r.status === "pending"));
    } catch {
      // Anfragen sind ein Zusatzfeature - ein Ladefehler soll die restliche
      // Seite nicht blockieren.
    }
  }

  async function loadCapacityRequests() {
    try {
      const [incoming, outgoing] = await Promise.all([
        api.get<CapacityRequest[]>("/api/capacity-requests/incoming"),
        api.get<CapacityRequest[]>("/api/capacity-requests/outgoing"),
      ]);
      setIncomingCapacityRequests(incoming);
      setOutgoingCapacityRequests(outgoing.filter((r) => r.status === "pending"));
    } catch {
      // Anfragen sind ein Zusatzfeature - ein Ladefehler soll die restliche
      // Seite nicht blockieren.
    }
  }

  async function loadWaitlist() {
    try {
      setMyWaitlistEntries(await api.get<WaitlistEntry[]>("/api/waitlist/mine"));
    } catch {
      // s.o.
    }
  }

  async function loadAttendanceSummary() {
    try {
      const summary = await api.get<AttendanceSummary[]>("/api/children/attendance-summary");
      const map: Record<string, AttendanceSummary> = {};
      for (const entry of summary) map[entry.childId] = entry;
      setAttendanceSummary(map);
    } catch {
      // Zusatzinfo - Ladefehler soll die Seite nicht blockieren.
    }
  }

  useEffect(() => {
    load();
    loadMoveRequests();
    loadCapacityRequests();
    loadWaitlist();
    loadAttendanceSummary();
  }, []);

  async function handleMove(childId: string, toGroupId: string) {
    if (!toGroupId) return;
    setError(null);
    setInfo(null);
    try {
      const res = await withCapacityConfirm((confirmOverCapacity) =>
        api.post<MoveChildResponse | PendingCapacityApproval>(`/api/children/${childId}/move`, {
          toGroupId,
          confirmOverCapacity,
        })
      );
      if (res === CAPACITY_CANCELLED) return;
      if (isPendingCapacityApproval(res)) {
        setInfo(`Kapazität von „${res.groupName}“ ist ausgeschöpft – Anfrage an die Jugendleitung gesendet.`);
      } else if (res.status === "pending") {
        const targetName = groups.find((g) => g.id === toGroupId)?.name ?? "die Zielgruppe";
        setInfo(`Kind erfüllt die Altersvoraussetzung nicht – Anfrage an den Turnleiter von „${targetName}“ gesendet.`);
      }
      await Promise.all([load(), loadMoveRequests(), loadCapacityRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Verschieben");
    } finally {
      setMoveSelection((prev) => ({ ...prev, [childId]: "" }));
    }
  }

  async function handleApprove(id: string) {
    setError(null);
    try {
      const result = await withCapacityConfirm((confirmOverCapacity) =>
        api.post<{ ok: true } | PendingCapacityApproval>(`/api/move-requests/${id}/approve`, { confirmOverCapacity })
      );
      if (result === CAPACITY_CANCELLED) return;
      if (isPendingCapacityApproval(result)) {
        setInfo(`Kapazität von „${result.groupName}“ ist ausgeschöpft – Anfrage an die Jugendleitung gesendet.`);
      }
      await Promise.all([load(), loadMoveRequests(), loadCapacityRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    }
  }

  async function handleReject(id: string) {
    setError(null);
    try {
      await api.post(`/api/move-requests/${id}/reject`, {});
      await loadMoveRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    }
  }

  async function handleCancelRequest(id: string) {
    setError(null);
    try {
      await api.del(`/api/move-requests/${id}`);
      await loadMoveRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    }
  }

  async function handleApproveCapacity(id: string) {
    setError(null);
    try {
      await api.post(`/api/capacity-requests/${id}/approve`, {});
      await Promise.all([load(), loadCapacityRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Freigeben");
    }
  }

  async function handleRejectCapacity(id: string) {
    setError(null);
    try {
      await api.post(`/api/capacity-requests/${id}/reject`, {});
      await loadCapacityRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ablehnen");
    }
  }

  async function handleCancelCapacityRequest(id: string) {
    setError(null);
    try {
      await api.del(`/api/capacity-requests/${id}`);
      await loadCapacityRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    }
  }

  async function handleAddToWaitlist(childId: string, groupId: string) {
    setError(null);
    setInfo(null);
    try {
      await api.post(`/api/groups/${groupId}/waitlist`, { childId });
      const groupName = groups.find((g) => g.id === groupId)?.name ?? "die Gruppe";
      setInfo(`Auf die Warteliste von „${groupName}“ gesetzt.`);
      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Eintragen in die Warteliste");
    } finally {
      setMoveSelection((prev) => ({ ...prev, [childId]: "" }));
    }
  }

  async function handleCancelWaitlistEntry(id: string) {
    setError(null);
    try {
      await api.del(`/api/waitlist/${id}`);
      await loadWaitlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurückziehen");
    }
  }

  function startEdit(child: Child) {
    setEditingId(child.id);
    setForm({
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: child.birthDate,
      groupId: child.groupId ?? "",
      notes: child.notes ?? "",
      emergencyContactName: child.emergencyContactName ?? "",
      emergencyContactPhone: child.emergencyContactPhone ?? "",
      healthNotes: child.healthNotes ?? "",
    });
    setOriginalFamilyId(child.familyId);
    setSiblingIds(
      child.familyId ? children.filter((c) => c.familyId === child.familyId && c.id !== child.id).map((c) => c.id) : []
    );
    setAddSiblingValue("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setOriginalFamilyId(null);
    setSiblingIds([]);
    setAddSiblingValue("");
  }

  // Geschwister direkt über die Kinder-Auswahl verknüpfen, statt vorher eine
  // "Familie" benennen zu müssen: die passende Familie wird automatisch
  // wiederverwendet (falls schon eine existiert) oder im Hintergrund neu
  // angelegt. `childId` ist die ID des gerade gespeicherten Kindes.
  async function syncSiblings(childId: string): Promise<void> {
    const prevSiblingIds = originalFamilyId
      ? children.filter((c) => c.familyId === originalFamilyId && c.id !== childId).map((c) => c.id)
      : [];

    if (siblingIds.length === 0) {
      // Keine Geschwister (mehr) ausgewählt: dieses Kind aus seiner Familie
      // lösen, falls es vorher in einer war.
      if (originalFamilyId) await api.put(`/api/children/${childId}/family`, { familyId: null });
      return;
    }

    // Vorhandene Familie eines ausgewählten Geschwisterkindes wiederverwenden
    // (bevorzugt die des Kindes selbst), sonst neu anlegen.
    let familyId =
      originalFamilyId ?? siblingIds.map((id) => children.find((c) => c.id === id)?.familyId).find((f) => f) ?? null;
    if (!familyId) {
      const family = await api.post<{ id: string }>("/api/families", {
        name: `Familie ${form.lastName || form.firstName}`.trim(),
        contactName: null,
        contactPhone: null,
        contactEmail: null,
      });
      familyId = family.id;
    }

    await api.put(`/api/children/${childId}/family`, { familyId });
    for (const siblingId of siblingIds) {
      const sibling = children.find((c) => c.id === siblingId);
      if (sibling?.familyId !== familyId) {
        await api.put(`/api/children/${siblingId}/family`, { familyId });
      }
    }
    // Geschwister, die aus der Auswahl entfernt wurden, aus der Familie lösen.
    for (const removedId of prevSiblingIds) {
      if (!siblingIds.includes(removedId)) {
        await api.put(`/api/children/${removedId}/family`, { familyId: null });
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    try {
      const result = await withCapacityConfirm((confirmOverCapacity) => {
        const payload = {
          firstName: form.firstName,
          lastName: form.lastName,
          birthDate: form.birthDate,
          groupId: form.groupId || null,
          notes: form.notes || null,
          emergencyContactName: form.emergencyContactName || null,
          emergencyContactPhone: form.emergencyContactPhone || null,
          healthNotes: form.healthNotes || null,
          confirmOverCapacity,
        };
        return editingId
          ? api.put<Child | PendingCapacityApproval>(`/api/children/${editingId}`, payload)
          : api.post<Child | PendingCapacityApproval>("/api/children", payload);
      });
      if (result === CAPACITY_CANCELLED) return;
      if (isPendingCapacityApproval(result)) {
        setInfo(`Kapazität von „${result.groupName}“ ist ausgeschöpft – Anfrage an die Jugendleitung gesendet.`);
        await loadCapacityRequests();
      } else {
        await syncSiblings(result.id);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Speichern");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Kind wirklich löschen? Zugehörige Anwesenheitseinträge werden ebenfalls gelöscht.")) return;
    try {
      await api.del(`/api/children/${id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    }
  }

  function groupName(id: string | null): string {
    return groups.find((g) => g.id === id)?.name ?? "–";
  }

  const filteredChildren = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return children;
    return children.filter((child) => {
      const haystack = `${child.firstName} ${child.lastName} ${groupName(child.groupId)}`.toLowerCase();
      return haystack.includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, groups, search]);

  // Kinder können nur in eigene (bearbeitbare) Gruppen einsortiert werden -
  // fremde, lediglich lesbare Vereinsgruppen fehlen bewusst in der Auswahl.
  const writableGroups = groups.filter((g) => g.canEdit);

  // Kinder nach Gruppe gebündelt statt einer flachen Liste mit Gruppen-Spalte
  // anzuzeigen - der Gruppenname steht dann nur einmal als Überschrift.
  const groupedFilteredChildren = useMemo(() => {
    const byGroup = new Map<string, Child[]>();
    const ungrouped: Child[] = [];
    for (const child of filteredChildren) {
      if (child.groupId) {
        const list = byGroup.get(child.groupId) ?? [];
        list.push(child);
        byGroup.set(child.groupId, list);
      } else {
        ungrouped.push(child);
      }
    }
    const sections: { group: Group | null; children: Child[] }[] = [];
    for (const g of groups) {
      const list = byGroup.get(g.id);
      if (list && list.length > 0) sections.push({ group: g, children: list });
    }
    if (ungrouped.length > 0) sections.push({ group: null, children: ungrouped });
    return sections;
  }, [filteredChildren, groups]);

  const upcomingByUrgency = useMemo(() => {
    const buckets: Record<SwitchUrgency, UpcomingSwitch[]> = {
      "next-month": [],
      "next-3-months": [],
      "this-year": [],
    };
    for (const child of children) {
      const currentGroup = groups.find((g) => g.id === child.groupId);
      if (!currentGroup) continue;
      const switchDate = nextGroupSwitchDate(child.birthDate, currentGroup.maxAge);
      const urgency = switchUrgency(switchDate);
      if (urgency) {
        buckets[urgency].push({ child, switchDate, targetGroup: nextGroup(currentGroup, groups) });
      }
    }
    for (const list of Object.values(buckets)) {
      list.sort((a, b) => a.switchDate.getTime() - b.switchDate.getTime());
    }
    return buckets;
  }, [children, groups]);

  const hasUpcomingSwitches = URGENCY_SECTIONS.some((s) => upcomingByUrgency[s.urgency].length > 0);

  // Kinder, deren Alter nicht (mehr) zur aktuellen Gruppe passt: entweder
  // bereits herausgewachsen (Wechsel überfällig) oder noch zu jung für die
  // Gruppe, in der sie aktuell eingetragen sind.
  const mismatched = useMemo(() => {
    const overdue: MismatchedChild[] = [];
    const tooYoung: MismatchedChild[] = [];
    for (const child of children) {
      const currentGroup = groups.find((g) => g.id === child.groupId);
      if (!currentGroup) continue;
      const age = calculateAgeYears(child.birthDate);
      if (age >= currentGroup.maxAge) {
        overdue.push({ child, currentGroup, targetGroup: groupForAge(age, groups) });
      } else if (age < currentGroup.minAge) {
        tooYoung.push({ child, currentGroup, targetGroup: groupForAge(age, groups) });
      }
    }
    const byName = (a: MismatchedChild, b: MismatchedChild) => a.child.lastName.localeCompare(b.child.lastName);
    overdue.sort(byName);
    tooYoung.sort(byName);
    return { overdue, tooYoung };
  }, [children, groups]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Kinder</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Name, Geburtsdatum und Gruppe. Alter und Gruppenwechsel werden automatisch berechnet.
        </p>
      </div>

      {(mismatched.overdue.length > 0 || mismatched.tooYoung.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {mismatched.overdue.length > 0 && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
              <h3 className="mb-2 text-sm font-semibold text-red-800 dark:text-red-300">
                Wechsel überfällig ({mismatched.overdue.length})
              </h3>
              <ul className="space-y-1 text-sm text-red-900 dark:text-red-200">
                {mismatched.overdue.map(({ child, currentGroup, targetGroup }) => (
                  <li key={child.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {child.firstName} {child.lastName} – noch in {currentGroup.name}
                      {targetGroup ? `, gehört eigentlich zu ${targetGroup.name}` : ""}
                    </span>
                    {child.canEdit && targetGroup && (
                      <button
                        onClick={() => handleMove(child.id, targetGroup.id)}
                        className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                      >
                        Jetzt verschieben
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mismatched.tooYoung.length > 0 && (
            <div className="rounded-lg border border-purple-300 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950/50">
              <h3 className="mb-2 text-sm font-semibold text-purple-800 dark:text-purple-300">
                Eigentlich noch zu jung für die Gruppe ({mismatched.tooYoung.length})
              </h3>
              <ul className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
                {mismatched.tooYoung.map(({ child, currentGroup, targetGroup }) => (
                  <li key={child.id}>
                    {child.firstName} {child.lastName} – in {currentGroup.name}
                    {targetGroup ? `, passt eher zu ${targetGroup.name}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {hasUpcomingSwitches && (
        <div className="grid gap-3 sm:grid-cols-3">
          {URGENCY_SECTIONS.map((section) => {
            const items = upcomingByUrgency[section.urgency];
            if (items.length === 0) return null;
            return (
              <div key={section.urgency} className={`rounded-lg border p-4 ${section.classes}`}>
                <h3 className="mb-2 text-sm font-semibold">
                  {section.title} ({items.length})
                </h3>
                <ul className="space-y-1 text-sm">
                  {items.map(({ child, switchDate, targetGroup }) => (
                    <li key={child.id}>
                      {child.firstName} {child.lastName}
                      {targetGroup ? ` → ${targetGroup.name}` : ""} ab {formatMonthYear(switchDate)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {(incomingRequests.length > 0 || outgoingRequests.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {incomingRequests.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                Wartet auf deine Freigabe ({incomingRequests.length})
              </h3>
              <ul className="space-y-2 text-sm text-amber-900 dark:text-amber-200">
                {incomingRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.childName}: {r.fromGroupName ?? "keine Gruppe"} → {r.toGroupName}
                      {r.requestedByName ? ` (angefragt von ${r.requestedByName})` : ""}
                    </span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => handleApprove(r.id)}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Freigeben
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Ablehnen
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outgoingRequests.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Eigene offene Anfragen ({outgoingRequests.length})
              </h3>
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {outgoingRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.childName}: {r.fromGroupName ?? "keine Gruppe"} → {r.toGroupName} · wartet auf Freigabe
                    </span>
                    <button
                      onClick={() => handleCancelRequest(r.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Zurückziehen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(incomingCapacityRequests.length > 0 || outgoingCapacityRequests.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {incomingCapacityRequests.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
              <h3 className="mb-2 text-sm font-semibold text-red-800 dark:text-red-300">
                Kapazitäts-Anfragen an dich als Jugendleitung ({incomingCapacityRequests.length})
              </h3>
              <ul className="space-y-2 text-sm text-red-900 dark:text-red-200">
                {incomingCapacityRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.childName} → {r.groupName} ({capacityActionLabel(r.action)})
                      {r.requestedByName ? ` · angefragt von ${r.requestedByName}` : ""}
                    </span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => handleApproveCapacity(r.id)}
                        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Freigeben
                      </button>
                      <button
                        onClick={() => handleRejectCapacity(r.id)}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Ablehnen
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {outgoingCapacityRequests.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Eigene Kapazitäts-Anfragen ({outgoingCapacityRequests.length})
              </h3>
              <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                {outgoingCapacityRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {r.childName} → {r.groupName} ({capacityActionLabel(r.action)}) · wartet auf Freigabe der
                      Jugendleitung
                    </span>
                    <button
                      onClick={() => handleCancelCapacityRequest(r.id)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Zurückziehen
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {myWaitlistEntries.length > 0 && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900 dark:bg-purple-950/40">
          <h3 className="mb-2 text-sm font-semibold text-purple-800 dark:text-purple-300">
            Meine Wartelisten-Einträge ({myWaitlistEntries.length})
          </h3>
          <ul className="space-y-2 text-sm text-purple-900 dark:text-purple-200">
            {myWaitlistEntries.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {w.childName} → {w.groupName} · Platz {w.position} auf der Warteliste
                </span>
                <button
                  onClick={() => handleCancelWaitlistEntry(w.id)}
                  className="rounded-md border border-purple-300 px-2 py-1 text-xs text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-900/50"
                >
                  Zurückziehen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[140px]">
          <FloatingInput
            label="Vorname"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
        </div>
        <div className="flex-1 min-w-[140px]">
          <FloatingInput
            label="Nachname"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
        </div>
        <div className="w-44">
          <FloatingInput
            label="Geburtsdatum"
            type="date"
            required
            value={form.birthDate}
            onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
          />
        </div>
        <div className="w-44">
          <FloatingSelect label="Gruppe" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
            <option value="">Keine Gruppe</option>
            {writableGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.minAge}–{g.maxAge} Jahre)
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="flex-1 min-w-[160px]">
          <FloatingInput
            label="Notiz (optional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div className="w-full border-t border-slate-100 pt-3 dark:border-slate-800" />
        <div className="flex-1 min-w-[160px]">
          <FloatingInput
            label="Notfallkontakt: Name (optional)"
            value={form.emergencyContactName}
            onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
          />
        </div>
        <div className="w-52">
          <FloatingInput
            label="Notfallkontakt: Telefon (optional)"
            type="tel"
            value={form.emergencyContactPhone}
            onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <FloatingInput
            label="Gesundheitshinweise, z.B. Allergien (optional)"
            value={form.healthNotes}
            onChange={(e) => setForm({ ...form, healthNotes: e.target.value })}
          />
        </div>
        <div className="w-full border-t border-slate-100 pt-3 dark:border-slate-800">
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Geschwister (optional) – gleiche oder andere Gruppe, auch bei anderen Übungsleiter*innen im Verein
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {siblingIds.map((id) => {
              const sibling = children.find((c) => c.id === id);
              if (!sibling) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                >
                  {sibling.firstName} {sibling.lastName}
                  <button
                    type="button"
                    onClick={() => setSiblingIds((prev) => prev.filter((x) => x !== id))}
                    aria-label={`${sibling.firstName} ${sibling.lastName} nicht mehr als Geschwister verknüpfen`}
                    className="text-emerald-500 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-100"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <select
              value={addSiblingValue}
              onChange={(e) => {
                const id = e.target.value;
                if (id) setSiblingIds((prev) => [...prev, id]);
                setAddSiblingValue("");
              }}
              className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">+ Geschwisterkind hinzufügen…</option>
              {children
                .filter((c) => c.id !== editingId && !siblingIds.includes(c.id))
                .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} ({groupName(c.groupId)})
                  </option>
                ))}
            </select>
          </div>
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
      {info && <p className="text-sm text-amber-700 dark:text-amber-400">{info}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-xs flex-1">
          <FloatingInput
            label="Suche nach Name oder Gruppe"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Namensliste für Gruppe(n):</span>
          {groups.map((g) => {
            const selected = printGroupIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  setPrintGroupIds((prev) => (selected ? prev.filter((id) => id !== g.id) : [...prev, g.id]))
                }
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  selected
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>
        {printGroupIds.length > 0 && (
          <>
            <a
              href={`/druck?mode=namen&groupIds=${printGroupIds.join(",")}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Namensliste drucken ({printGroupIds.length})
            </a>
            <a
              href={`/druck?mode=notfall&groupIds=${printGroupIds.join(",")}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Notfallliste drucken ({printGroupIds.length})
            </a>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : groupedFilteredChildren.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          {children.length === 0 ? "Noch keine Kinder angelegt." : "Keine Treffer für diese Suche."}
        </div>
      ) : (
        <div className="space-y-6">
          {groupedFilteredChildren.map(({ group: sectionGroup, children: sectionChildren }) => (
            <div key={sectionGroup?.id ?? "__none__"}>
              <h3 className="mb-2 text-base font-semibold text-slate-900 dark:text-slate-100">
                {sectionGroup ? sectionGroup.name : "Ohne Gruppe"}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="hidden px-4 py-2 font-medium sm:table-cell">Geburtsdatum</th>
                      <th className="px-4 py-2 font-medium">Alter</th>
                      <th className="px-4 py-2 font-medium">Zuletzt da</th>
                      <th className="px-4 py-2 font-medium">Wechsel zur nächsten Gruppe</th>
                      <th className="px-4 py-2 font-medium">Verschieben</th>
                      <th className="px-4 py-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionChildren.map((child) => {
                      const age = calculateAgeYears(child.birthDate);
                      const currentGroup = sectionGroup;
                      const matchingGroup = groupForAge(age, groups);
                      const mismatch = currentGroup ? age < currentGroup.minAge || age >= currentGroup.maxAge : false;

                      let switchLabel = "–";
                      if (currentGroup) {
                        const switchDate = nextGroupSwitchDate(child.birthDate, currentGroup.maxAge);
                        const target = nextGroup(currentGroup, groups);
                        switchLabel = target
                          ? `${target.name} ab ${formatMonthYear(switchDate)}`
                          : `ab ${formatMonthYear(switchDate)}`;
                      }

                      const moveTargets = groups.filter((g) => g.id !== child.groupId);
                      const hasOpenRequest = outgoingRequests.some((r) => r.childId === child.id);
                      const hasHealthInfo = Boolean(child.emergencyContactName || child.emergencyContactPhone || child.healthNotes);
                      const siblings = child.familyId
                        ? children.filter((c) => c.familyId === child.familyId && c.id !== child.id)
                        : [];

                      const attendance = attendanceSummary[child.id];
                      let attendanceLabel = "–";
                      let attendanceStale = false;
                      if (child.groupId && attendance) {
                        if (attendance.weeksSinceLastPresent === null) {
                          attendanceLabel = "nie";
                          attendanceStale = true;
                        } else if (attendance.weeksSinceLastPresent === 0) {
                          attendanceLabel = "diese Woche";
                        } else {
                          attendanceLabel = `vor ${attendance.weeksSinceLastPresent} Wo.`;
                          attendanceStale = attendance.weeksSinceLastPresent >= STALE_ATTENDANCE_WEEKS;
                        }
                      }

                      return (
                        <tr key={child.id} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                            {child.firstName} {child.lastName}
                            {hasHealthInfo && (
                              <span
                                className="ml-1.5 cursor-help"
                                title={[
                                  child.emergencyContactName ? `Notfallkontakt: ${child.emergencyContactName}` : null,
                                  child.emergencyContactPhone ? `Tel: ${child.emergencyContactPhone}` : null,
                                  child.healthNotes ? `Gesundheit: ${child.healthNotes}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              >
                                ⚕️
                              </span>
                            )}
                            {siblings.length > 0 && (
                              <span
                                className="ml-1.5 cursor-help"
                                title={`Geschwister: ${siblings.map((s) => `${s.firstName} ${s.lastName}`).join(", ")}`}
                              >
                                👨‍👩‍👧
                              </span>
                            )}
                            {mismatch && (
                              <span
                                className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                                title={matchingGroup ? `Alter passt eher zu ${matchingGroup.name}` : "Alter passt zu keiner bestehenden Gruppe mehr"}
                              >
                                Wechsel fällig
                              </span>
                            )}
                          </td>
                          <td className="hidden px-4 py-2 text-slate-600 dark:text-slate-300 sm:table-cell">{child.birthDate}</td>
                          <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{age} Jahre</td>
                          <td className="px-4 py-2">
                            {child.groupId ? (
                              <span
                                className={
                                  attendanceStale
                                    ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                                    : "text-slate-600 dark:text-slate-300"
                                }
                                title={attendanceStale ? "Möglicherweise abgemeldet, aber nicht ausgetragen" : undefined}
                              >
                                {attendanceLabel}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500">–</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{switchLabel}</td>
                          <td className="px-4 py-2">
                            {!child.canEdit ? (
                              <span className="text-xs text-slate-300 dark:text-slate-600">–</span>
                            ) : hasOpenRequest ? (
                              <span className="text-xs text-amber-600 dark:text-amber-400">wartet auf Freigabe</span>
                            ) : (
                              <select
                                value={moveSelection[child.id] ?? ""}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setMoveSelection((prev) => ({ ...prev, [child.id]: value }));
                                  if (value.startsWith(WAITLIST_PREFIX)) {
                                    handleAddToWaitlist(child.id, value.slice(WAITLIST_PREFIX.length));
                                  } else {
                                    handleMove(child.id, value);
                                  }
                                }}
                                className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              >
                                <option value="">Verschieben nach…</option>
                                {moveTargets.map((g) => {
                                  const fits = age >= g.minAge && age < g.maxAge;
                                  const full = g.maxChildren !== null && children.filter((c) => c.groupId === g.id).length >= g.maxChildren;
                                  if (full) {
                                    return (
                                      <option key={g.id} value={`${WAITLIST_PREFIX}${g.id}`}>
                                        {g.name} (voll – auf Warteliste)
                                      </option>
                                    );
                                  }
                                  return (
                                    <option key={g.id} value={g.id}>
                                      {g.name}
                                      {fits ? "" : " (benötigt Freigabe)"}
                                    </option>
                                  );
                                })}
                              </select>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {child.canEdit ? (
                              <>
                                <button onClick={() => startEdit(child)} className="mr-3 text-sm text-emerald-700 hover:underline dark:text-emerald-400">
                                  Bearbeiten
                                </button>
                                <button onClick={() => handleArchive(child.id)} className="mr-3 text-sm text-amber-700 hover:underline dark:text-amber-400">
                                  Austreten lassen
                                </button>
                                <button onClick={() => handleDelete(child.id)} className="text-sm text-red-600 hover:underline dark:text-red-400">
                                  Löschen
                                </button>
                              </>
                            ) : (
                              <span
                                className="text-sm text-slate-300 dark:text-slate-600"
                                title="Nur lesbar – Kind einer fremden Vereinsgruppe"
                              >
                                nur lesbar
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowArchived((prev) => !prev)}
          className="text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          {showArchived ? "Ausgetretene Kinder ausblenden" : `Ausgetretene Kinder anzeigen (${archivedChildren.length})`}
        </button>
        {showArchived && (
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[500px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Letzte Gruppe</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {archivedChildren.map((child) => (
                  <tr key={child.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                      {child.firstName} {child.lastName}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{groupName(child.groupId)}</td>
                    <td className="px-4 py-2 text-right">
                      {child.canEdit ? (
                        <>
                          <button
                            onClick={() => handleReactivate(child.id)}
                            className="mr-3 text-sm text-emerald-700 hover:underline dark:text-emerald-400"
                          >
                            Reaktivieren
                          </button>
                          <button onClick={() => handleDelete(child.id)} className="text-sm text-red-600 hover:underline dark:text-red-400">
                            Endgültig löschen
                          </button>
                        </>
                      ) : (
                        <span className="text-sm text-slate-300 dark:text-slate-600">nur lesbar</span>
                      )}
                    </td>
                  </tr>
                ))}
                {archivedChildren.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                      Keine ausgetretenen Kinder.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
