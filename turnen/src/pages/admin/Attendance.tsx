import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { AttendanceEntry, Child, Group } from "../../lib/types";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";

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
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(today());
  const [present, setPresent] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      try {
        const [groupList, childrenList] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
        ]);
        // Anwesenheit lässt sich nur für eigene Gruppen erfassen - fremde,
        // nur lesbare Vereinsgruppen tauchen hier bewusst nicht auf.
        const writableGroups = groupList.filter((g) => g.canEdit);
        setGroups(writableGroups);
        setChildren(childrenList);
        if (writableGroups.length > 0) setGroupId(writableGroups[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    loadBase();
  }, []);

  useEffect(() => {
    async function loadAttendance() {
      if (!groupId || !date) return;
      setError(null);
      setSavedMessage(null);
      try {
        const entries = await api.get<AttendanceEntry[]>(`/api/attendance/${groupId}/${date}`);
        const map: Record<string, boolean> = {};
        for (const entry of entries) map[entry.childId] = entry.present;
        setPresent(map);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden der Anwesenheit");
      }
    }
    loadAttendance();
  }, [groupId, date]);

  const groupChildren = children.filter((c) => c.groupId === groupId);

  function toggle(childId: string) {
    setPresent((prev) => ({ ...prev, [childId]: !prev[childId] }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const entries: AttendanceEntry[] = groupChildren.map((c) => ({
        childId: c.id,
        present: present[c.id] ?? false,
      }));
      await api.put(`/api/attendance/${groupId}/${date}`, { entries });
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
        <div className="ml-auto text-sm text-slate-500 dark:text-slate-400">
          {presentCount} von {groupChildren.length} anwesend
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {savedMessage && <p className="text-sm text-emerald-700 dark:text-emerald-400">{savedMessage}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
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
        disabled={saving || groupChildren.length === 0}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
      >
        {saving ? "Speichert…" : "Anwesenheit speichern"}
      </button>
    </div>
  );
}
