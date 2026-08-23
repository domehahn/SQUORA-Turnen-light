import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { AttendanceEntry, Child, Group } from "../lib/types";
import { trainingDatesInRange, formatShortDate } from "../lib/schedule";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

type Mode = "anwesenheit" | "namen";

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

// Bewusst NICHT toISOString() (rechnet nach UTC um), sondern lokale
// Datumsanteile direkt formatieren - siehe auch src/lib/schedule.ts.
function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toIso(first), to: toIso(last) };
}

export default function AttendancePrint() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "namen" ? "namen" : "anwesenheit";
  const [group, setGroup] = useState<Group | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(searchParams.get("from") ?? defaultRange.from);
  const [to, setTo] = useState(searchParams.get("to") ?? defaultRange.to);
  const [attendance, setAttendance] = useState<Record<string, AttendanceEntry[]>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [groups, childrenList] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
        ]);
        setGroup(groups.find((g) => g.id === groupId) ?? null);
        setChildren(childrenList.filter((c) => c.groupId === groupId).sort((a, b) => a.lastName.localeCompare(b.lastName)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [groupId]);

  // Bereits erfasste Anwesenheit für den gewählten Zeitraum laden, damit die
  // Druckliste vergangene Termine nicht leer, sondern mit dem tatsächlichen
  // Stand zeigt. Nur für eigene Gruppen abrufbar - bei fremden Gruppen
  // (403) bleiben die Spalten dann leer zum Ausfüllen von Hand.
  useEffect(() => {
    if (mode !== "anwesenheit" || !groupId || !from || !to) return;
    api
      .get<Record<string, AttendanceEntry[]>>(`/api/attendance-range/${groupId}?from=${from}&to=${to}`)
      .then(setAttendance)
      .catch(() => setAttendance({}));
  }, [mode, groupId, from, to]);

  function setMode(next: Mode) {
    const params = new URLSearchParams(searchParams);
    params.set("mode", next);
    setSearchParams(params);
  }

  if (loading) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="min-h-screen bg-white p-6 text-sm text-red-600">Fehler: {error}</p>;
  if (!group) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Gruppe nicht gefunden.</p>;

  const dates = mode === "anwesenheit" && group.weekday !== null ? trainingDatesInRange(group.weekday, from, to) : [];

  // Zusagen/Absagen zählen nur die tatsächlich im gewählten Zeitraum
  // erfassten Einträge (nicht die leeren, noch auszufüllenden Zellen).
  let presentCount = 0;
  let absentCount = 0;
  if (mode === "anwesenheit") {
    for (const d of dates) {
      for (const entry of attendance[d] ?? []) {
        if (entry.present) presentCount += 1;
        else absentCount += 1;
      }
    }
  }

  return (
    // Druckansichten sind bewusst immer hell/schwarz auf weiß, unabhängig
    // vom Darkmode der App - sonst ist der Text weder am Bildschirm noch
    // beim Drucken lesbar (siehe src/index.css für den globalen Print-Fix).
    <div className="min-h-screen bg-white p-6 text-slate-900" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-1 rounded-md border border-slate-300 p-0.5">
              <button
                onClick={() => setMode("anwesenheit")}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  mode === "anwesenheit" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Anwesenheitsliste
              </button>
              <button
                onClick={() => setMode("namen")}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  mode === "namen" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Namensliste
              </button>
            </div>
            {mode === "anwesenheit" && (
              <>
                <label className="text-sm text-slate-600">
                  Von
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="ml-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  />
                </label>
                <label className="text-sm text-slate-600">
                  Bis
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="ml-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
                  />
                </label>
              </>
            )}
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Drucken
          </button>
        </div>

        <h1 className="text-xl font-semibold">{group.name}</h1>
        <p className="mb-4 text-sm text-slate-600">
          {group.minAge}–{group.maxAge} Jahre
          {group.weekday !== null && ` · ${WEEKDAY_NAMES[group.weekday]}`}
          {group.startTime && group.endTime && ` ${group.startTime}–${group.endTime}`}
          {group.location && ` · ${group.location}`}
          {mode === "anwesenheit" && ` · ${formatDate(from)} – ${formatDate(to)}`}
        </p>
        <p className="mb-4 text-sm font-medium text-slate-800">
          Kinder gesamt: {children.length}
          {mode === "anwesenheit" && (
            <>
              {" "}
              · Zusagen: {presentCount} · Absagen: {absentCount}
            </>
          )}
        </p>

        {mode === "anwesenheit" ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-400 px-2 py-1 text-left">Name</th>
                  {dates.length > 0
                    ? dates.map((d) => (
                        <th key={d} className="border border-slate-400 px-2 py-1">
                          {formatShortDate(d)}
                        </th>
                      ))
                    : (
                        <th className="border border-slate-400 px-2 py-1 text-slate-500">
                          {group.weekday === null
                            ? "Kein Trainingstag für diese Gruppe hinterlegt"
                            : "Keine Trainingstermine in diesem Zeitraum"}
                        </th>
                      )}
                </tr>
              </thead>
              <tbody>
                {children.map((child) => (
                  <tr key={child.id}>
                    <td className="border border-slate-400 px-2 py-1.5">
                      {child.firstName} {child.lastName}
                    </td>
                    {(dates.length > 0 ? dates : [""]).map((d, i) => {
                      const entry = attendance[d]?.find((e) => e.childId === child.id);
                      return (
                        <td
                          key={d || i}
                          className="border border-slate-400 px-2 py-1.5 text-center"
                          style={{ width: "3.5rem" }}
                        >
                          {entry ? (entry.present ? "✓" : "✕") : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {children.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(dates.length, 1) + 1} className="border border-slate-400 px-2 py-4 text-center text-slate-500">
                      Keine Kinder in dieser Gruppe.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-400 px-2 py-1 text-left">Nachname</th>
                <th className="border border-slate-400 px-2 py-1 text-left">Vorname</th>
                <th className="border border-slate-400 px-2 py-1 text-left">Geburtsdatum</th>
              </tr>
            </thead>
            <tbody>
              {children.map((child) => (
                <tr key={child.id}>
                  <td className="border border-slate-400 px-2 py-1.5">{child.lastName}</td>
                  <td className="border border-slate-400 px-2 py-1.5">{child.firstName}</td>
                  <td className="border border-slate-400 px-2 py-1.5">{formatDate(child.birthDate)}</td>
                </tr>
              ))}
              {children.length === 0 && (
                <tr>
                  <td colSpan={3} className="border border-slate-400 px-2 py-4 text-center text-slate-500">
                    Keine Kinder in dieser Gruppe.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
