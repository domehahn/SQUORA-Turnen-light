import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import type { Child, Group } from "../../lib/types";
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
  const [editingId, setEditingId] = useState<string | null>(null);

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

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Kinder</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Name, Geburtsdatum und Gruppe. Alter und Gruppenwechsel werden automatisch berechnet.
        </p>
      </div>

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
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
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
