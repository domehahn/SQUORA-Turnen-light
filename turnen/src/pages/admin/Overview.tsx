import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { AttendanceEntry, Child, Group } from "../../lib/types";
import { FloatingSelect } from "../../components/FloatingField";
import { formatShortDate, trainingDatesInMonth } from "../../lib/schedule";
import { holidayFor } from "../../lib/holidays";

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type CellState = "present" | "absent" | "none-past" | "none-future";

export default function Overview() {
  const now = new Date();
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [groupId, setGroupId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [attendance, setAttendance] = useState<Record<string, AttendanceEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      try {
        const [groupList, childrenList] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
        ]);
        setGroups(groupList);
        setChildren(childrenList);
        if (groupList.length > 0) setGroupId(groupList[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    loadBase();
  }, []);

  const trainingDates = useMemo(() => trainingDatesInMonth(year, month), [year, month]);

  useEffect(() => {
    async function loadAttendance() {
      if (!groupId || trainingDates.length === 0) {
        setAttendance({});
        return;
      }
      setError(null);
      try {
        const from = trainingDates[0];
        const to = trainingDates[trainingDates.length - 1];
        const data = await api.get<Record<string, AttendanceEntry[]>>(
          `/api/attendance-range/${groupId}?from=${from}&to=${to}`
        );
        setAttendance(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden der Anwesenheit");
      }
    }
    loadAttendance();
  }, [groupId, trainingDates]);

  const groupChildren = useMemo(
    () =>
      children
        .filter((c) => c.groupId === groupId)
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
    [children, groupId]
  );

  function cellState(dateIso: string, childId: string): CellState {
    const entries = attendance[dateIso];
    const entry = entries?.find((e) => e.childId === childId);
    if (entry) return entry.present ? "present" : "absent";
    return dateIso <= todayIso ? "none-past" : "none-future";
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  const dateStats = trainingDates.map((d) => {
    const entries = attendance[d] ?? [];
    const present = entries.filter((e) => e.present).length;
    return { date: d, present, total: groupChildren.length };
  });

  function childStats(childId: string) {
    let present = 0;
    let recorded = 0;
    for (const d of trainingDates) {
      const entries = attendance[d];
      const entry = entries?.find((e) => e.childId === childId);
      if (entry) {
        recorded += 1;
        if (entry.present) present += 1;
      }
    }
    return { present, recorded };
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Anwesenheitsübersicht</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Training jeden Donnerstag, außer in den rheinland-pfälzischen Schulferien.
        </p>
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Vorheriger Monat"
            className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ‹
          </button>
          <div className="min-w-[140px] text-center text-sm font-medium text-slate-800 dark:text-slate-100">
            {MONTH_NAMES[month - 1]} {year}
          </div>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Nächster Monat"
            className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            ›
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">✓</span>
            anwesend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">✕</span>
            abwesend
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">–</span>
            nicht erfasst
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : trainingDates.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          In {MONTH_NAMES[month - 1]} {year} finden aufgrund der Schulferien keine Trainingstermine statt.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="sticky left-0 z-10 bg-slate-100 px-4 py-2 text-left font-medium dark:bg-slate-800">Name</th>
                {trainingDates.map((d) => {
                  const holiday = holidayFor(d);
                  const isToday = d === todayIso;
                  return (
                    <th
                      key={d}
                      title={holiday?.label}
                      className={`min-w-[64px] px-2 py-2 text-center font-medium ${
                        isToday ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : ""
                      }`}
                    >
                      {formatShortDate(d)}
                    </th>
                  );
                })}
                <th className="px-4 py-2 text-center font-medium">Quote</th>
              </tr>
            </thead>
            <tbody>
              {groupChildren.map((child) => {
                const stats = childStats(child.id);
                const quote = stats.recorded > 0 ? Math.round((stats.present / stats.recorded) * 100) : null;
                return (
                  <tr key={child.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800 dark:bg-slate-900 dark:text-slate-100">
                      {child.firstName} {child.lastName}
                    </td>
                    {trainingDates.map((d) => {
                      const state = cellState(d, child.id);
                      return (
                        <td key={d} className="px-2 py-2 text-center">
                          <AttendanceMark state={state} />
                        </td>
                      );
                    })}
                    <td className="px-4 py-2 text-center text-slate-600 dark:text-slate-300">
                      {quote === null ? "–" : `${quote}%`}
                    </td>
                  </tr>
                );
              })}
              {groupChildren.length === 0 && (
                <tr>
                  <td colSpan={trainingDates.length + 2} className="px-4 py-6 text-center text-slate-400 dark:text-slate-500">
                    Keine Kinder in dieser Gruppe.
                  </td>
                </tr>
              )}
            </tbody>
            {groupChildren.length > 0 && (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                  <td className="sticky left-0 z-10 bg-slate-50 px-4 py-2 font-medium dark:bg-slate-800/60">Anwesend</td>
                  {dateStats.map(({ date, present, total }) => (
                    <td key={date} className="px-2 py-2 text-center">
                      {present}/{total}
                    </td>
                  ))}
                  <td className="px-4 py-2"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function AttendanceMark({ state }: { state: CellState }) {
  if (state === "present") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
        ✓
      </span>
    );
  }
  if (state === "absent") {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
        ✕
      </span>
    );
  }
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 dark:text-slate-500 ${
        state === "none-future" ? "opacity-40" : "bg-slate-100 dark:bg-slate-800"
      }`}
    >
      –
    </span>
  );
}
