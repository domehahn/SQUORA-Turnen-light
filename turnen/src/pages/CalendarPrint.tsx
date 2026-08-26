import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Group } from "../lib/types";
import SquoraBrand from "../components/SquoraBrand";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Montag ... Sonntag
const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// SQUORA-Formularstil (siehe tournament-manager/AufstellungsbogenPdfService):
// helle blaue Tabellenköpfe statt schlichtem Grau/Schwarz.
const thClass = "border border-slate-300 bg-blue-100 px-2 py-1.5 text-left font-semibold text-blue-900";
const tdClass = "border border-slate-300 px-2 py-1.5";

// Eigenständige Druckansicht des Trainingskalenders, analog zu
// AttendancePrint/HoursReport: immer hell/schwarz auf weiß, unabhängig vom
// Darkmode der App, da die reguläre Kalender-Seite innerhalb von AppLayout
// (Sidebar, Header) nicht sinnvoll direkt druckbar ist.
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

  const byWeekday = WEEKDAYS.map((day, i) => ({
    day,
    label: WEEKDAY_NAMES[i],
    groups: groups
      .filter((g) => g.weekday === day)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")),
  })).filter((d) => d.groups.length > 0);

  if (loading) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="min-h-screen bg-white p-6 text-sm text-red-600">Fehler: {error}</p>;

  return (
    <div
      className="min-h-screen bg-white p-6 text-slate-900"
      style={{ colorScheme: "light", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="mx-auto max-w-3xl">
        <SquoraBrand className="mb-4" />
        <div className="mb-4 flex items-center justify-between print:hidden">
          <div>
            <h1 className="text-xl font-semibold">Trainingskalender</h1>
            <p className="text-sm text-slate-600">Alle Trainingszeiten der Woche.</p>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Drucken
          </button>
        </div>
        <h1 className="mb-4 hidden text-xl font-semibold print:block">Trainingskalender</h1>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={thClass}>Wochentag</th>
              <th className={thClass}>Gruppe</th>
              <th className={thClass}>Altersspanne</th>
              <th className={thClass}>Uhrzeit</th>
              <th className={thClass}>Ort/Halle</th>
              <th className={thClass}>Turntrainer*in</th>
            </tr>
          </thead>
          <tbody>
            {byWeekday.map((d) =>
              d.groups.map((g, i) => (
                <tr key={g.id}>
                  {i === 0 && (
                    <td className={`${tdClass} font-medium`} rowSpan={d.groups.length}>
                      {d.label}
                    </td>
                  )}
                  <td className={`${tdClass} font-medium`}>{g.name}</td>
                  <td className={tdClass}>
                    {g.minAge}–{g.maxAge} Jahre
                  </td>
                  <td className={tdClass}>{g.startTime && g.endTime ? `${g.startTime}–${g.endTime}` : "–"}</td>
                  <td className={tdClass}>{g.location ?? "–"}</td>
                  <td className={tdClass}>{g.ownerName ?? "–"}</td>
                </tr>
              ))
            )}
            {byWeekday.length === 0 && (
              <tr>
                <td colSpan={6} className={`${tdClass} py-4 text-center text-slate-500`}>
                  Keine Gruppen mit hinterlegtem Trainingstag.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
