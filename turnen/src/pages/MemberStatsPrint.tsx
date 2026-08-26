import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Child, Group, MemberEvent } from "../lib/types";
import { useAuth } from "../context/useAuth";
import SquoraBrand from "../components/SquoraBrand";
import { buildQuarterRange, computeBestandRows, computeEventRows, shiftQuarter } from "../lib/memberStats";

const QUARTER_COUNT = 12;

// SQUORA-Formularstil (siehe tournament-manager/AufstellungsbogenPdfService):
// helle blaue Tabellenköpfe statt schlichtem Grau/Schwarz.
const thClass = "border border-slate-300 bg-blue-100 px-2 py-1.5 text-left font-semibold text-blue-900";
const thClassCenter = "border border-slate-300 bg-blue-100 px-2 py-1.5 text-center font-semibold text-blue-900";
const tdClass = "border border-slate-300 px-2 py-1.5";
const tdClassCenter = "border border-slate-300 px-2 py-1.5 text-center";

// Eigenständige Druckansicht der Mitgliederstatistik (Bestand je Quartal +
// Zu-/Abgänge), analog zu AttendancePrint/CalendarPrint: immer hell,
// unabhängig vom Darkmode, außerhalb von AppLayout.
export default function MemberStatsPrint() {
  const { clubId, clubName, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [searchParams] = useSearchParams();
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const defaultFrom = shiftQuarter(currentYear, currentQuarter, -(QUARTER_COUNT - 1));
  const fromYear = Number(searchParams.get("fromYear")) || defaultFrom.year;
  const fromQuarter = Number(searchParams.get("fromQuarter")) || defaultFrom.quarter;
  const toYear = Number(searchParams.get("toYear")) || currentYear;
  const toQuarter = Number(searchParams.get("toQuarter")) || currentQuarter;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [g, c, e] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children?includeArchived=true"),
          api.get<MemberEvent[]>("/api/member-events").catch(() => []),
        ]);
        setGroups(g);
        setChildren(c);
        setEvents(e);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <p className="min-h-screen bg-white p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="min-h-screen bg-white p-6 text-sm text-red-600">Fehler: {error}</p>;

  const visibleGroups = groups
    .filter((g) => g.clubId !== null && g.clubId === clubId && g.canEdit)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.minAge - b.minAge);
  const quarters = buildQuarterRange(fromYear, fromQuarter, toYear, toQuarter);
  const rows = computeBestandRows(quarters, children, visibleGroups);
  const eventRows = computeEventRows(quarters, events, visibleGroups);

  return (
    <div
      className="min-h-screen bg-white p-6 text-slate-900"
      style={{ colorScheme: "light", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="mx-auto max-w-4xl">
        <SquoraBrand className="mb-4" />
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Mitgliederstatistik</h1>
            <p className="text-sm text-slate-600">
              {isJugendleiter ? clubName ?? "Verein" : "Eigene Gruppe(n)"} · Q{fromQuarter} {fromYear} – Q{toQuarter}{" "}
              {toYear}
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 print:hidden"
          >
            Drucken
          </button>
        </div>

        {visibleGroups.length === 0 || quarters.length === 0 ? (
          <p className="text-sm text-slate-500">Keine Daten für den gewählten Zeitraum.</p>
        ) : (
          <>
            <h2 className="mb-2 text-base font-semibold">Bestand je Quartal</h2>
            <table className="mb-6 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thClass}>Quartal</th>
                  {visibleGroups.map((g) => (
                    <th key={g.id} className={thClassCenter}>
                      {g.name}
                    </th>
                  ))}
                  <th className={thClassCenter}>Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td className={`${tdClass} font-medium`}>{r.label}</td>
                    {visibleGroups.map((g) => (
                      <td key={g.id} className={tdClassCenter}>
                        {r.perGroup[g.id] ?? 0}
                      </td>
                    ))}
                    <td className={`${tdClassCenter} font-semibold`}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2 className="mb-2 text-base font-semibold">Zu- und Abgänge je Quartal</h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thClass}>Quartal</th>
                  <th className={thClassCenter}>Neu</th>
                  <th className={thClassCenter}>Wechsel</th>
                  <th className={thClassCenter}>Ausgetreten</th>
                </tr>
              </thead>
              <tbody>
                {eventRows.map((r) => (
                  <tr key={r.label}>
                    <td className={`${tdClass} font-medium`}>{r.label}</td>
                    <td className={tdClassCenter}>{r.created > 0 ? `+${r.created}` : "–"}</td>
                    <td className={tdClassCenter}>{r.moved || "–"}</td>
                    <td className={tdClassCenter}>{r.left > 0 ? `−${r.left}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">
              Zu-/Abgänge basieren auf dem Verlauf; Ereignisse von vor Einführung dieser Auswertung fehlen
              entsprechend.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
