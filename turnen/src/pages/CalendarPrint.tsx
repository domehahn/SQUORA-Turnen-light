import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Group } from "../lib/types";
import SquoraBrand from "../components/SquoraBrand";
import { groupColorClassesLight } from "../lib/groupColors";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Montag ... Sonntag
const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// Eigenständige Druckansicht des Trainingskalenders im selben Kartenstil wie
// die reguläre Kalender-Seite (Wochentags-Spalten, farbige Gruppen-Karten) -
// nur eigenständig statt innerhalb von AppLayout (Sidebar/Header) und immer
// hell, unabhängig vom Darkmode der App (siehe AttendancePrint.tsx für
// dieselbe Begründung).
export default function CalendarPrint() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Group[]>("/api/groups")
      .then(setGroups)
      .catch((err) => setError(err instanceof Error ? err.message : "Fehler beim Laden"))
      .finally(() => setLoading(false));
  }, []);

  const byWeekday: Record<number, Group[]> = {};
  for (const day of WEEKDAYS) byWeekday[day] = [];
  for (const g of groups) {
    if (g.weekday === null) continue;
    byWeekday[g.weekday]?.push(g);
  }
  for (const list of Object.values(byWeekday)) {
    list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }

  if (loading) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="min-h-screen bg-white p-6 text-sm text-red-600">Fehler: {error}</p>;

  return (
    <div
      className="min-h-screen bg-white p-6 text-slate-900"
      style={{ colorScheme: "light", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="mx-auto max-w-5xl">
        <SquoraBrand className="mb-4" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Trainingskalender</h1>
            <p className="text-sm text-slate-600">Alle Trainingszeiten der Woche.</p>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 print:hidden"
          >
            Drucken
          </button>
        </div>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
          {WEEKDAYS.map((day, i) => (
            <div key={day} className="rounded-lg border border-slate-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-700">{WEEKDAY_NAMES[i]}</h3>
              <div className="space-y-2">
                {byWeekday[day].map((g) => (
                  <div key={g.id} className={`overflow-hidden rounded-md border px-2 py-1.5 text-xs ${groupColorClassesLight(g.color, g.id)}`}>
                    <p className="break-words font-medium">{g.name}</p>
                    {g.startTime && g.endTime && (
                      <p>
                        {g.startTime}–{g.endTime}
                      </p>
                    )}
                    {g.location && <p className="break-words opacity-80">{g.location}</p>}
                    {g.ownerName && <p className="break-words font-medium opacity-90">👤 {g.ownerName}</p>}
                  </div>
                ))}
                {byWeekday[day].length === 0 && <p className="text-xs text-slate-400">–</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
