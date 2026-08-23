import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Group } from "../../lib/types";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Montag ... Sonntag
const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// Feste, aber unterscheidbare Farbpalette pro Gruppe (Hash auf die ID) -
// konsistent über Reloads hinweg, ohne Konfiguration.
const COLOR_CLASSES = [
  "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-800",
  "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-800",
  "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-800",
  "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800",
  "bg-pink-100 text-pink-800 border-pink-300 dark:bg-pink-900/40 dark:text-pink-200 dark:border-pink-800",
  "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/40 dark:text-teal-200 dark:border-teal-800",
  "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-800",
];

function colorFor(groupId: string): string {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) hash = (hash * 31 + groupId.charCodeAt(i)) % COLOR_CLASSES.length;
  return COLOR_CLASSES[hash];
}

export default function Calendar() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        setGroups(await api.get<Group[]>("/api/groups"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const byWeekday = useMemo(() => {
    const map: Record<number, Group[]> = {};
    for (const day of WEEKDAYS) map[day] = [];
    for (const g of groups) {
      if (g.weekday === null) continue;
      map[g.weekday]?.push(g);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    }
    return map;
  }, [groups]);

  const unscheduled = groups.filter((g) => g.weekday === null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Trainingskalender</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Trainingszeiten der Woche auf einen Blick – nach Wochentag sortiert.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAYS.map((day, i) => (
              <div key={day} className="min-w-[9rem] rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{WEEKDAY_NAMES[i]}</h3>
                <div className="space-y-2">
                  {byWeekday[day].map((g) => (
                    <div key={g.id} className={`rounded-md border px-2 py-1.5 text-xs ${colorFor(g.id)}`}>
                      <p className="font-medium">{g.name}</p>
                      {g.startTime && g.endTime && (
                        <p>
                          {g.startTime}–{g.endTime}
                        </p>
                      )}
                      {g.location && <p className="opacity-80">{g.location}</p>}
                    </div>
                  ))}
                  {byWeekday[day].length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">–</p>}
                </div>
              </div>
            ))}
          </div>

          {unscheduled.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Ohne hinterlegten Trainingstag ({unscheduled.length})
              </h3>
              <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {unscheduled.map((g) => (
                  <li key={g.id}>{g.name}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
