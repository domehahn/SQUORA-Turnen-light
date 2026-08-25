import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Child, Group } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingSelect } from "../../components/FloatingField";

const QUARTER_COUNT = 12; // Default-Zeitraum: letzte 3 Jahre
const YEAR_RANGE_BACK = 8; // wie weit "Von Jahr" in die Vergangenheit reicht

interface QuarterPoint {
  year: number;
  quarter: number;
  label: string;
  endIso: string; // "YYYY-MM-DD HH:MM:SS", Ende des Quartals
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Letzter Tag eines Quartals, als Datetime-String im selben Format wie
// created_at/archived_at (SQLite datetime('now')), damit einfache
// String-Vergleiche funktionieren.
function quarterEndIso(year: number, quarter: number): string {
  const lastMonth = quarter * 3;
  const lastDay = new Date(year, lastMonth, 0).getDate();
  return `${year}-${pad(lastMonth)}-${pad(lastDay)} 23:59:59`;
}

function shiftQuarter(year: number, quarter: number, delta: number): { year: number; quarter: number } {
  let q = quarter + delta;
  let y = year;
  while (q < 1) {
    q += 4;
    y -= 1;
  }
  while (q > 4) {
    q -= 4;
    y += 1;
  }
  return { year: y, quarter: q };
}

// Aufsteigende Liste aller Quartale zwischen (from) und (bis) inklusive. Ist
// "von" nach "bis", kommt eine leere Liste zurück statt einer Endlosschleife.
function buildQuarterRange(fromYear: number, fromQuarter: number, toYear: number, toQuarter: number): QuarterPoint[] {
  const points: QuarterPoint[] = [];
  let year = fromYear;
  let quarter = fromQuarter;
  let guard = 0;
  while ((year < toYear || (year === toYear && quarter <= toQuarter)) && guard < 400) {
    points.push({ year, quarter, label: `Q${quarter} ${year}`, endIso: quarterEndIso(year, quarter) });
    quarter += 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
    guard += 1;
  }
  return points;
}

// War das Kind an diesem Zeitpunkt (Quartalsende) aktives Mitglied? Beruht
// auf created_at/archived_at - ein Kind, das mehrfach aus- und wieder
// eingetreten ist, zeigt nur das letzte Intervall (Reaktivieren setzt
// archived_at zurück auf NULL), das reicht für einen groben Trend.
function wasActiveAt(child: Child, endIso: string): boolean {
  if (child.createdAt > endIso) return false;
  if (child.archivedAt && child.archivedAt <= endIso) return false;
  return true;
}

export default function MemberStats() {
  const { userId, clubId, clubName, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const defaultFrom = shiftQuarter(currentYear, currentQuarter, -(QUARTER_COUNT - 1));
  const [fromYear, setFromYear] = useState(defaultFrom.year);
  const [fromQuarter, setFromQuarter] = useState(defaultFrom.quarter);
  const [toYear, setToYear] = useState(currentYear);
  const [toQuarter, setToQuarter] = useState(currentQuarter);
  const yearOptions = useMemo(
    () => Array.from({ length: YEAR_RANGE_BACK + 2 }, (_, i) => currentYear - YEAR_RANGE_BACK + i),
    [currentYear]
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [g, c] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children?includeArchived=true"),
        ]);
        setGroups(g);
        setChildren(c);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Wie bei der Auslastung: Turnleiter*innen sehen nur die eigene(n)
  // Gruppe(n), die Jugendleitung alle Gruppen des Vereins.
  const visibleGroups = useMemo(
    () =>
      groups
        .filter((g) => g.clubId !== null && g.clubId === clubId && (isJugendleiter || g.ownerId === userId))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.minAge - b.minAge),
    [groups, clubId, isJugendleiter, userId]
  );

  const quarters = useMemo(
    () => buildQuarterRange(fromYear, fromQuarter, toYear, toQuarter),
    [fromYear, fromQuarter, toYear, toQuarter]
  );

  // Nutzt die aktuelle Gruppenzuordnung, nicht die historische - ein Kind,
  // das die Gruppe gewechselt hat, taucht rückwirkend überall in seiner
  // heutigen Gruppe auf. Für einen groben Mitgliederzahl-Trend über Zeit
  // reicht das; für exakte historische Gruppenzugehörigkeit müsste man
  // Gruppenwechsel separat protokollieren.
  const rows = useMemo(() => {
    const visibleGroupIds = new Set(visibleGroups.map((g) => g.id));
    return quarters.map((q) => {
      const perGroup: Record<string, number> = {};
      let total = 0;
      for (const g of visibleGroups) perGroup[g.id] = 0;
      for (const child of children) {
        if (!wasActiveAt(child, q.endIso)) continue;
        if (!child.groupId || !visibleGroupIds.has(child.groupId)) continue;
        perGroup[child.groupId] = (perGroup[child.groupId] ?? 0) + 1;
        total += 1;
      }
      return { ...q, perGroup, total };
    });
  }, [quarters, children, visibleGroups]);

  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Mitgliederstatistik</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {isJugendleiter
            ? `Entwicklung der Mitgliederzahl von ${clubName ?? "deinem Verein"} je Quartal, aufgeschlüsselt nach Gruppe.`
            : "Entwicklung der Mitgliederzahl deiner eigenen Gruppe(n) je Quartal."}{" "}
          Basiert auf der aktuellen Gruppenzuordnung sowie An-/Abmeldedatum – frühere Gruppenwechsel werden nicht
          rückwirkend abgebildet.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-28">
          <FloatingSelect label="Von Jahr" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-24">
          <FloatingSelect label="Quartal" value={fromQuarter} onChange={(e) => setFromQuarter(Number(e.target.value))}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <span className="pb-2 text-sm text-slate-400 dark:text-slate-500">bis</span>
        <div className="w-28">
          <FloatingSelect label="Bis Jahr" value={toYear} onChange={(e) => setToYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-24">
          <FloatingSelect label="Quartal" value={toQuarter} onChange={(e) => setToQuarter(Number(e.target.value))}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </FloatingSelect>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {quarters.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
„Von“ liegt nach „Bis“ – bitte einen gültigen Zeitraum wählen.
        </div>
      ) : loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : visibleGroups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
          {isJugendleiter ? `${clubName} hat noch keine zugeordneten Gruppen.` : "Du leitest aktuell keine dem Verein zugeordnete Gruppe."}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2 font-medium">Quartal</th>
                  {visibleGroups.map((g) => (
                    <th key={g.id} className="px-4 py-2 text-center font-medium">
                      {g.name}
                    </th>
                  ))}
                  <th className="px-4 py-2 text-center font-medium">Gesamt</th>
                  <th className="px-4 py-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const prevTotal = i > 0 ? rows[i - 1].total : null;
                  const delta = prevTotal !== null ? r.total - prevTotal : null;
                  return (
                    <tr key={r.label} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{r.label}</td>
                      {visibleGroups.map((g) => (
                        <td key={g.id} className="px-4 py-2 text-center text-slate-600 dark:text-slate-300">
                          {r.perGroup[g.id] ?? 0}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-center font-semibold text-slate-800 dark:text-slate-100">
                        {r.total}
                        {delta !== null && delta !== 0 && (
                          <span className={`ml-1 text-xs font-normal ${delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                            ({delta > 0 ? "+" : ""}
                            {delta})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="h-3 w-full max-w-[160px] rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-3 rounded-full bg-emerald-500 dark:bg-emerald-500"
                            style={{ width: `${Math.max(4, Math.round((r.total / maxTotal) * 100))}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
