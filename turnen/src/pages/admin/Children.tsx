import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Child, Group, MoveChildResponse, MoveRequest } from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import {
  calculateAgeYears,
  formatMonthYear,
  groupForAge,
  nextGroup,
  nextGroupSwitchDate,
  switchUrgency,
  type SwitchUrgency,
} from "../../lib/age";

const emptyForm = { firstName: "", lastName: "", birthDate: "", groupId: "", notes: "" };

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
  const [children, setChildren] = useState<Child[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [moveSelection, setMoveSelection] = useState<Record<string, string>>({});
  const [incomingRequests, setIncomingRequests] = useState<MoveRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<MoveRequest[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [childrenList, groupList] = await Promise.all([
        api.get<Child[]>("/api/children"),
        api.get<Group[]>("/api/groups"),
      ]);
      setChildren(childrenList);
      setGroups(groupList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
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

  useEffect(() => {
    load();
    loadMoveRequests();
  }, []);

  async function handleMove(childId: string, toGroupId: string) {
    if (!toGroupId) return;
    setError(null);
    setInfo(null);
    try {
      const res = await api.post<MoveChildResponse>(`/api/children/${childId}/move`, { toGroupId });
      if (res.status === "pending") {
        const targetName = groups.find((g) => g.id === toGroupId)?.name ?? "die Zielgruppe";
        setInfo(`Kind erfüllt die Altersvoraussetzung nicht – Anfrage an den Turnleiter von „${targetName}“ gesendet.`);
      }
      await Promise.all([load(), loadMoveRequests()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Verschieben");
    } finally {
      setMoveSelection((prev) => ({ ...prev, [childId]: "" }));
    }
  }

  async function handleApprove(id: string) {
    setError(null);
    try {
      await api.post(`/api/move-requests/${id}/approve`, {});
      await Promise.all([load(), loadMoveRequests()]);
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

  function startEdit(child: Child) {
    setEditingId(child.id);
    setForm({
      firstName: child.firstName,
      lastName: child.lastName,
      birthDate: child.birthDate,
      groupId: child.groupId ?? "",
      notes: child.notes ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        birthDate: form.birthDate,
        groupId: form.groupId || null,
        notes: form.notes || null,
      };
      if (editingId) await api.put(`/api/children/${editingId}`, payload);
      else await api.post("/api/children", payload);
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

  // Kinder können nur in eigene (bearbeitbare) Gruppen einsortiert werden -
  // fremde, lediglich lesbare Vereinsgruppen fehlen bewusst in der Auswahl.
  const writableGroups = groups.filter((g) => g.canEdit);

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
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Geburtsdatum</th>
                <th className="px-4 py-2 font-medium">Alter</th>
                <th className="px-4 py-2 font-medium">Gruppe</th>
                <th className="px-4 py-2 font-medium">Wechsel zur nächsten Gruppe</th>
                <th className="px-4 py-2 font-medium">Verschieben</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => {
                const age = calculateAgeYears(child.birthDate);
                const currentGroup = groups.find((g) => g.id === child.groupId);
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

                return (
                  <tr key={child.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                      {child.firstName} {child.lastName}
                    </td>
                    <td className="hidden px-4 py-2 text-slate-600 dark:text-slate-300 sm:table-cell">{child.birthDate}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{age} Jahre</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      {groupName(child.groupId)}
                      {mismatch && (
                        <span
                          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                          title={matchingGroup ? `Alter passt eher zu ${matchingGroup.name}` : "Alter passt zu keiner bestehenden Gruppe mehr"}
                        >
                          Wechsel fällig
                        </span>
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
                            const groupId = e.target.value;
                            setMoveSelection((prev) => ({ ...prev, [child.id]: groupId }));
                            handleMove(child.id, groupId);
                          }}
                          className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <option value="">Verschieben nach…</option>
                          {moveTargets.map((g) => {
                            const fits = age >= g.minAge && age < g.maxAge;
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
              {children.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Noch keine Kinder angelegt.
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
