import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Child, Group } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { calculateAgeYears, nextGroupSwitchDate, switchUrgency } from "../../lib/age";

type CapacityLevel = "unset" | "ok" | "warn" | "over";

const CAPACITY_BADGE_CLASSES: Record<CapacityLevel, string> = {
  unset: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  over: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
};

function capacityLevel(count: number, max: number | null): CapacityLevel {
  if (max === null || max === 0) return "unset";
  const ratio = count / max;
  if (ratio <= 1) return "ok";
  if (ratio <= 1.15) return "warn";
  return "over";
}

interface GroupStats {
  group: Group;
  children: Child[];
  count: number;
  avgAge: number | null;
  tooYoung: number;
  tooOld: number;
  upcomingSwitches: number;
}

export default function Utilization() {
  const { clubId, clubName } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [g, c] = await Promise.all([api.get<Group[]>("/api/groups"), api.get<Child[]>("/api/children")]);
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

  // Nur Gruppen, die tatsächlich dem eigenen Verein zugeordnet sind - eigene
  // vereinslose Gruppen und rein fremde Gruppen außerhalb des Vereins gehören
  // nicht zu "allen Gruppen eines Vereins".
  const clubGroups = useMemo(() => groups.filter((g) => g.clubId !== null && g.clubId === clubId), [groups, clubId]);

  const stats = useMemo<GroupStats[]>(() => {
    return clubGroups
      .map((group) => {
        const groupChildren = children.filter((c) => c.groupId === group.id);
        const ages = groupChildren.map((c) => calculateAgeYears(c.birthDate));
        const avgAge = ages.length > 0 ? ages.reduce((sum, a) => sum + a, 0) / ages.length : null;
        let tooYoung = 0;
        let tooOld = 0;
        let upcomingSwitches = 0;
        groupChildren.forEach((child, i) => {
          const age = ages[i];
          if (age < group.minAge) tooYoung += 1;
          else if (age >= group.maxAge) tooOld += 1;
          const switchDate = nextGroupSwitchDate(child.birthDate, group.maxAge);
          if (switchUrgency(switchDate) !== null) upcomingSwitches += 1;
        });
        return { group, children: groupChildren, count: groupChildren.length, avgAge, tooYoung, tooOld, upcomingSwitches };
      })
      .sort((a, b) => a.group.sortOrder - b.group.sortOrder || a.group.minAge - b.group.minAge);
  }, [clubGroups, children]);

  const totals = useMemo(() => {
    const totalChildren = stats.reduce((sum, s) => sum + s.count, 0);
    const groupsWithCapacity = stats.filter((s) => s.group.maxChildren !== null);
    const totalCapacity = groupsWithCapacity.reduce((sum, s) => sum + (s.group.maxChildren ?? 0), 0);
    const totalMismatched = stats.reduce((sum, s) => sum + s.tooYoung + s.tooOld, 0);
    const totalUpcoming = stats.reduce((sum, s) => sum + s.upcomingSwitches, 0);
    return { totalChildren, totalCapacity, totalMismatched, totalUpcoming, hasCapacityInfo: groupsWithCapacity.length > 0 };
  }, [stats]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Auslastung</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Gruppen von {clubName ?? "deinem Verein"} auf einen Blick: Auslastung, Durchschnittsalter und
          anstehende bzw. überfällige Wechsel.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : !clubId ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Du bist aktuell keinem Verein zugeordnet. Tritt auf der Seite „Verein" einem Verein bei oder lege einen an,
          um hier die Auslastung all seiner Gruppen zu sehen.
        </p>
      ) : stats.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {clubName} hat noch keine zugeordneten Gruppen. Auf der Seite „Gruppen" können Gruppen angelegt oder
          bestehende Alt-Gruppen dem Verein zugeordnet werden.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Gruppen</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{stats.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Kinder</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {totals.totalChildren}
                {totals.hasCapacityInfo && (
                  <span className="ml-1 text-sm font-normal text-slate-400 dark:text-slate-500">/ {totals.totalCapacity}</span>
                )}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Nicht altersgerecht</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{totals.totalMismatched}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Anstehende Wechsel</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{totals.totalUpcoming}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2 font-medium">Gruppe</th>
                  <th className="px-4 py-2 font-medium">Altersspanne</th>
                  <th className="px-4 py-2 font-medium">Auslastung</th>
                  <th className="px-4 py-2 font-medium">Ø Alter</th>
                  <th className="px-4 py-2 font-medium">Nicht altersgerecht</th>
                  <th className="px-4 py-2 font-medium">Anstehende Wechsel</th>
                  <th className="px-4 py-2 font-medium">Turnleiter</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(({ group, count, avgAge, tooYoung, tooOld, upcomingSwitches }) => {
                  const level = capacityLevel(count, group.maxChildren);
                  const label = group.maxChildren != null ? `${count} / ${group.maxChildren}` : `${count}`;
                  const mismatchTotal = tooYoung + tooOld;
                  return (
                    <tr key={group.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{group.name}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {group.minAge}–{group.maxAge} Jahre
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CAPACITY_BADGE_CLASSES[level]}`}>
                          {label}
                          {group.maxChildren != null && group.maxChildren > 0
                            ? ` (${Math.round((count / group.maxChildren) * 100)}%)`
                            : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {avgAge !== null ? `${avgAge.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Jahre` : "–"}
                      </td>
                      <td className="px-4 py-2">
                        {mismatchTotal > 0 ? (
                          <span
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                            title={`${tooOld} zu alt, ${tooYoung} zu jung`}
                          >
                            {mismatchTotal} ({tooOld} zu alt, {tooYoung} zu jung)
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400 dark:text-slate-500">–</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                        {upcomingSwitches > 0 ? upcomingSwitches : "–"}
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{group.ownerName ?? "–"}</td>
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
