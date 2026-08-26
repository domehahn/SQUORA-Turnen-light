import type { Child, Group, MemberEvent } from "./types";

export interface QuarterPoint {
  year: number;
  quarter: number;
  label: string;
  startIso: string; // "YYYY-MM-DD HH:MM:SS", Anfang des Quartals
  endIso: string; // "YYYY-MM-DD HH:MM:SS", Ende des Quartals
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Letzter Tag eines Quartals, als Datetime-String im selben Format wie
// created_at/archived_at (SQLite datetime('now')), damit einfache
// String-Vergleiche funktionieren.
export function quarterEndIso(year: number, quarter: number): string {
  const lastMonth = quarter * 3;
  const lastDay = new Date(year, lastMonth, 0).getDate();
  return `${year}-${pad(lastMonth)}-${pad(lastDay)} 23:59:59`;
}

export function quarterStartIso(year: number, quarter: number): string {
  const firstMonth = (quarter - 1) * 3 + 1;
  return `${year}-${pad(firstMonth)}-01 00:00:00`;
}

export function shiftQuarter(year: number, quarter: number, delta: number): { year: number; quarter: number } {
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
export function buildQuarterRange(fromYear: number, fromQuarter: number, toYear: number, toQuarter: number): QuarterPoint[] {
  const points: QuarterPoint[] = [];
  let year = fromYear;
  let quarter = fromQuarter;
  let guard = 0;
  while ((year < toYear || (year === toYear && quarter <= toQuarter)) && guard < 400) {
    points.push({
      year,
      quarter,
      label: `Q${quarter} ${year}`,
      startIso: quarterStartIso(year, quarter),
      endIso: quarterEndIso(year, quarter),
    });
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

export interface BestandRow extends QuarterPoint {
  perGroup: Record<string, number>;
  total: number;
}

// Nutzt die aktuelle Gruppenzuordnung, nicht die historische - ein Kind, das
// die Gruppe gewechselt hat, taucht rückwirkend überall in seiner heutigen
// Gruppe auf. Für einen groben Mitgliederzahl-Trend über Zeit reicht das.
export function computeBestandRows(quarters: QuarterPoint[], children: Child[], visibleGroups: Group[]): BestandRow[] {
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
}

export interface EventRow extends QuarterPoint {
  created: number;
  moved: number;
  left: number;
}

// Zu-/Abgänge je Quartal: basiert auf audit_log-Ereignissen (child.created/
// child.moved/move_request.approved/child.archived), nach Gruppen-
// Sichtbarkeit gefiltert wie der Bestand. Ereignisse aus der Zeit vor
// Einführung dieser Protokollierung fehlen entsprechend - der Bestand bleibt
// davon unberührt, da er direkt auf den Kind-Datensätzen beruht.
export function computeEventRows(quarters: QuarterPoint[], events: MemberEvent[], visibleGroups: Group[]): EventRow[] {
  const visibleGroupIds = new Set(visibleGroups.map((g) => g.id));
  const visibleEvents = events.filter((e) => e.groupId && visibleGroupIds.has(e.groupId));
  return quarters.map((q) => {
    const inRange = visibleEvents.filter((e) => e.createdAt >= q.startIso && e.createdAt <= q.endIso);
    return {
      ...q,
      created: inRange.filter((e) => e.kind === "created").length,
      moved: inRange.filter((e) => e.kind === "moved").length,
      left: inRange.filter((e) => e.kind === "left").length,
    };
  });
}
