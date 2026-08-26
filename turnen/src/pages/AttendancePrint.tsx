import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { AttendanceEntry, Child, Group } from "../lib/types";
import { trainingDatesInRange, formatShortDate } from "../lib/schedule";
import SquoraBrand from "../components/SquoraBrand";
import { FloatingInput } from "../components/FloatingField";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

// SQUORA-Formularstil (siehe tournament-manager/AufstellungsbogenPdfService):
// helle blaue Tabellenköpfe statt schlichtem Grau/Schwarz.
const thClass = "border border-slate-300 bg-blue-100 px-2 py-1.5 font-semibold text-blue-900";
const tdClass = "border border-slate-300 px-2 py-1.5";

type Mode = "anwesenheit" | "namen" | "notfall";

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

function sortByName(a: Child, b: Child): number {
  return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
}

export default function AttendancePrint() {
  const { groupId: pathGroupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const modeParam = searchParams.get("mode");
  const mode: Mode = modeParam === "namen" ? "namen" : modeParam === "notfall" ? "notfall" : "anwesenheit";
  // Für die Namensliste können mehrere Gruppen gleichzeitig gewählt werden
  // (siehe Badge-Auswahl auf der Kinder-Seite); die Anwesenheitsliste bleibt
  // an einen einzelnen Trainingstermin gebunden und nutzt nur die erste
  // Gruppe. `groupIds` in der Query-String hat Vorrang vor dem Pfad-Parameter.
  const groupIdsParam = searchParams.get("groupIds");
  const groupIds = groupIdsParam ? groupIdsParam.split(",").filter(Boolean) : pathGroupId ? [pathGroupId] : [];
  const primaryGroupId = groupIds[0];

  const [allGroups, setAllGroups] = useState<Group[]>([]);
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
        const [groupList, childrenList] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
        ]);
        setAllGroups(groupList);
        setChildren(childrenList);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Bereits erfasste Anwesenheit für den gewählten Zeitraum laden, damit die
  // Druckliste vergangene Termine nicht leer, sondern mit dem tatsächlichen
  // Stand zeigt. Nur für eigene Gruppen abrufbar - bei fremden Gruppen
  // (403) bleiben die Spalten dann leer zum Ausfüllen von Hand.
  useEffect(() => {
    if (mode !== "anwesenheit" || !primaryGroupId || !from || !to) return;
    api
      .get<Record<string, AttendanceEntry[]>>(`/api/attendance-range/${primaryGroupId}?from=${from}&to=${to}`)
      .then(setAttendance)
      .catch(() => setAttendance({}));
  }, [mode, primaryGroupId, from, to]);

  function setMode(next: Mode) {
    const params = new URLSearchParams(searchParams);
    params.set("mode", next);
    setSearchParams(params);
  }

  function childrenOf(g: Group): Child[] {
    return children.filter((c) => c.groupId === g.id).sort(sortByName);
  }

  if (loading) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="min-h-screen bg-white p-6 text-sm text-red-600">Fehler: {error}</p>;
  if (groupIds.length === 0) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Keine Gruppe ausgewählt.</p>;

  const selectedGroups = groupIds
    .map((id) => allGroups.find((g) => g.id === id))
    .filter((g): g is Group => Boolean(g));
  if (selectedGroups.length === 0) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Gruppe(n) nicht gefunden.</p>;

  const group = selectedGroups[0];
  const groupChildren = childrenOf(group);
  const dates = mode === "anwesenheit" && group.weekday !== null ? trainingDatesInRange(group.weekday, from, to) : [];

  // Quote pro Kind: wie oft zu-/abgesagt von den tatsächlich im Zeitraum
  // erfassten Terminen (leere, noch nicht erfasste Zellen zählen nicht mit).
  const childQuotes = groupChildren.map((child) => {
    let present = 0;
    let recorded = 0;
    for (const d of dates) {
      const entry = attendance[d]?.find((e) => e.childId === child.id);
      if (entry) {
        recorded += 1;
        if (entry.present) present += 1;
      }
    }
    return { child, present, recorded, quote: recorded > 0 ? Math.round((present / recorded) * 100) : null };
  });

  // Anwesend-Zeile pro Termin (wie in der Übersicht) - wie viele der Kinder
  // waren an diesem Tag da, sowie die Quote bezogen auf die tatsächlich
  // erfassten Kinder (nicht gegen alle - unerfasste zählen nicht als Absage).
  const dateStats = dates.map((d) => {
    const entries = groupChildren.map((child) => attendance[d]?.find((e) => e.childId === child.id)).filter(Boolean);
    const present = entries.filter((e) => e?.present).length;
    const recorded = entries.length;
    return { date: d, present, total: groupChildren.length, recorded, quote: recorded > 0 ? Math.round((present / recorded) * 100) : null };
  });
  const totalPresent = dateStats.reduce((sum, s) => sum + s.present, 0);
  const totalRecorded = dateStats.reduce((sum, s) => sum + s.recorded, 0);
  const overallQuote = totalRecorded > 0 ? Math.round((totalPresent / totalRecorded) * 100) : null;

  return (
    // Druckansichten sind bewusst immer hell/schwarz auf weiß, unabhängig
    // vom Darkmode der App - sonst ist der Text weder am Bildschirm noch
    // beim Drucken lesbar (siehe src/index.css für den globalen Print-Fix).
    <div
      className="min-h-screen bg-white p-6 text-slate-900"
      style={{ colorScheme: "light", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="mx-auto max-w-3xl">
        <SquoraBrand className="mb-4" />
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
              <button
                onClick={() => setMode("notfall")}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  mode === "notfall" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Notfallliste
              </button>
            </div>
            {mode === "anwesenheit" && (
              <>
                <div className="w-36">
                  <FloatingInput label="Von" type="date" forceLight value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="w-36">
                  <FloatingInput label="Bis" type="date" forceLight value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
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

        {mode === "anwesenheit" ? (
          <>
            <h1 className="text-xl font-semibold">{group.name}</h1>
            <p className="mb-1 text-sm text-slate-600">Turntrainer*in: {group.ownerName ?? "–"}</p>
            <p className="mb-4 text-sm text-slate-600">
              {group.minAge}–{group.maxAge} Jahre
              {group.weekday !== null && ` · ${WEEKDAY_NAMES[group.weekday]}`}
              {group.startTime && group.endTime && ` ${group.startTime}–${group.endTime}`}
              {group.location && ` · ${group.location}`}
              {` · ${formatDate(from)} – ${formatDate(to)}`}
            </p>
            <p className="mb-4 text-sm font-medium text-slate-800">Kinder gesamt: {groupChildren.length}</p>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={`${thClass} text-left`}>Name</th>
                    {dates.length > 0
                      ? dates.map((d) => (
                          <th key={d} className={thClass}>
                            {formatShortDate(d)}
                          </th>
                        ))
                      : (
                          <th className={thClass}>
                            {group.weekday === null
                              ? "Kein Trainingstag für diese Gruppe hinterlegt"
                              : "Keine Trainingstermine in diesem Zeitraum"}
                          </th>
                        )}
                  </tr>
                </thead>
                <tbody>
                  {groupChildren.map((child) => (
                    <tr key={child.id}>
                      <td className={tdClass}>
                        {child.firstName} {child.lastName}
                      </td>
                      {(dates.length > 0 ? dates : [""]).map((d, i) => {
                        const entry = attendance[d]?.find((e) => e.childId === child.id);
                        return (
                          <td key={d || i} className={`${tdClass} text-center`} style={{ width: "3.5rem" }}>
                            {entry ? (entry.present ? "✓" : "✕") : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {groupChildren.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(dates.length, 1) + 1} className={`${tdClass} py-4 text-center text-slate-500`}>
                        Keine Kinder in dieser Gruppe.
                      </td>
                    </tr>
                  )}
                </tbody>
                {groupChildren.length > 0 && dates.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold">
                      <td className={tdClass}>Anwesend</td>
                      {dateStats.map(({ date, present, total }) => (
                        <td key={date} className={`${tdClass} text-center`}>
                          {present}/{total}
                        </td>
                      ))}
                    </tr>
                    <tr className="font-semibold">
                      <td className={tdClass}>Quote</td>
                      {dateStats.map(({ date, quote }) => (
                        <td key={date} className={`${tdClass} text-center`}>
                          {quote === null ? "–" : `${quote}%`}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>

              {groupChildren.length > 0 && (
                <table className="mt-6 w-full max-w-md border-collapse text-sm">
                  <caption className="mb-1 text-left text-sm font-semibold text-slate-800">
                    Zusage-Quote im Zeitraum
                  </caption>
                  <thead>
                    <tr>
                      <th className={`${thClass} text-left`}>Name</th>
                      <th className={thClass}>Zusagen</th>
                      <th className={thClass}>Quote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {childQuotes.map(({ child, present, recorded, quote }) => (
                      <tr key={child.id}>
                        <td className={tdClass}>
                          {child.firstName} {child.lastName}
                        </td>
                        <td className={`${tdClass} text-center`}>
                          {recorded > 0 ? `${present} von ${recorded}` : "–"}
                        </td>
                        <td className={`${tdClass} text-center`}>{quote === null ? "–" : `${quote}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {groupChildren.length > 0 && dates.length > 0 && (
                <p className="mt-2 max-w-md border-t border-slate-300 pt-2 text-sm font-medium text-slate-800">
                  Gesamtquote im Zeitraum: {overallQuote === null ? "–" : `${overallQuote}%`}
                </p>
              )}
            </div>
          </>
        ) : mode === "namen" ? (
          <div className="space-y-8">
            {selectedGroups.map((g, i) => {
              const list = childrenOf(g);
              return (
                <div key={g.id} className={i > 0 ? "break-before-page" : ""}>
                  <h1 className="text-xl font-semibold">{g.name}</h1>
                  <p className="mb-1 text-sm text-slate-600">Turntrainer*in: {g.ownerName ?? "–"}</p>
                  <p className="mb-2 text-sm text-slate-600">
                    {g.minAge}–{g.maxAge} Jahre
                    {g.weekday !== null && ` · ${WEEKDAY_NAMES[g.weekday]}`}
                    {g.startTime && g.endTime && ` ${g.startTime}–${g.endTime}`}
                    {g.location && ` · ${g.location}`}
                  </p>
                  <p className="mb-4 text-sm font-medium text-slate-800">Kinder gesamt: {list.length}</p>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className={`${thClass} text-left`}>Nachname</th>
                        <th className={`${thClass} text-left`}>Vorname</th>
                        <th className={`${thClass} text-left`}>Geburtsdatum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((child) => (
                        <tr key={child.id}>
                          <td className={tdClass}>{child.lastName}</td>
                          <td className={tdClass}>{child.firstName}</td>
                          <td className={tdClass}>{formatDate(child.birthDate)}</td>
                        </tr>
                      ))}
                      {list.length === 0 && (
                        <tr>
                          <td colSpan={3} className={`${tdClass} py-4 text-center text-slate-500`}>
                            Keine Kinder in dieser Gruppe.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-8">
            {selectedGroups.map((g, i) => {
              const list = childrenOf(g);
              return (
                <div key={g.id} className={i > 0 ? "break-before-page" : ""}>
                  <h1 className="text-xl font-semibold">{g.name}</h1>
                  <p className="mb-1 text-sm text-slate-600">Turntrainer*in: {g.ownerName ?? "–"}</p>
                  <p className="mb-2 text-sm text-slate-600">
                    {g.minAge}–{g.maxAge} Jahre
                    {g.weekday !== null && ` · ${WEEKDAY_NAMES[g.weekday]}`}
                    {g.startTime && g.endTime && ` ${g.startTime}–${g.endTime}`}
                    {g.location && ` · ${g.location}`}
                  </p>
                  <p className="mb-4 text-sm font-medium text-slate-800">Kinder gesamt: {list.length}</p>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className={`${thClass} text-left`}>Name</th>
                        <th className={`${thClass} text-left`}>Notfallkontakt</th>
                        <th className={`${thClass} text-left`}>Telefon</th>
                        <th className={`${thClass} text-left`}>Gesundheitshinweise</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((child) => (
                        <tr key={child.id}>
                          <td className={tdClass}>
                            {child.firstName} {child.lastName}
                          </td>
                          <td className={tdClass}>{child.emergencyContactName || "–"}</td>
                          <td className={tdClass}>{child.emergencyContactPhone || "–"}</td>
                          <td className={tdClass}>{child.healthNotes || "–"}</td>
                        </tr>
                      ))}
                      {list.length === 0 && (
                        <tr>
                          <td colSpan={4} className={`${tdClass} py-4 text-center text-slate-500`}>
                            Keine Kinder in dieser Gruppe.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
