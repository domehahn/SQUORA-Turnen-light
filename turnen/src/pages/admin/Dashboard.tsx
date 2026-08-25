import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type {
  CapacityRequest,
  Child,
  ClubJoinRequest,
  ClubWaitlistEntry,
  Group,
  MoveRequest,
  PlacementRequest,
  SessionOverrideRequest,
  SubstituteRequest,
} from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { calculateAgeYears, groupForAge } from "../../lib/age";

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

interface TodoItem {
  label: string;
  count: number;
  to: string;
  tone: "amber" | "red";
}

export default function Dashboard() {
  const { userId, userName, userEmail, clubName, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";

  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [openSubstitutes, setOpenSubstitutes] = useState<SubstituteRequest[]>([]);
  const [upcomingSubstitutes, setUpcomingSubstitutes] = useState<SubstituteRequest[]>([]);
  const [myOverrideRequests, setMyOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [incomingOverrideRequests, setIncomingOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [incomingMoveRequests, setIncomingMoveRequests] = useState<MoveRequest[]>([]);
  const [incomingCapacityRequests, setIncomingCapacityRequests] = useState<CapacityRequest[]>([]);
  const [clubWaitlist, setClubWaitlist] = useState<ClubWaitlistEntry[]>([]);
  const [incomingPlacementRequests, setIncomingPlacementRequests] = useState<PlacementRequest[]>([]);
  const [incomingJoinRequests, setIncomingJoinRequests] = useState<ClubJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const safe = async <T,>(promise: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await promise;
        } catch {
          return fallback;
        }
      };
      const [
        groupList,
        childrenList,
        openSubs,
        upcomingSubs,
        myOverrides,
        incomingOverrides,
        incomingMoves,
        incomingCapacity,
        waitlist,
        incomingPlacements,
        incomingJoins,
      ] = await Promise.all([
        safe(api.get<Group[]>("/api/groups"), []),
        safe(api.get<Child[]>("/api/children"), []),
        safe(api.get<SubstituteRequest[]>("/api/substitute-requests/open"), []),
        safe(api.get<SubstituteRequest[]>("/api/substitute-requests/upcoming"), []),
        safe(api.get<SessionOverrideRequest[]>("/api/session-override-requests/mine"), []),
        safe(isJugendleiter ? api.get<SessionOverrideRequest[]>("/api/session-override-requests/incoming") : Promise.resolve([]), []),
        safe(api.get<MoveRequest[]>("/api/move-requests/incoming"), []),
        safe(api.get<CapacityRequest[]>("/api/capacity-requests/incoming"), []),
        safe(isJugendleiter ? api.get<ClubWaitlistEntry[]>("/api/club-waitlist") : Promise.resolve([]), []),
        safe(api.get<PlacementRequest[]>("/api/placement-requests/incoming"), []),
        safe(isJugendleiter ? api.get<ClubJoinRequest[]>("/api/club-join-requests/incoming") : Promise.resolve([]), []),
      ]);
      setGroups(groupList);
      setChildren(childrenList);
      setOpenSubstitutes(openSubs);
      setUpcomingSubstitutes(upcomingSubs);
      setMyOverrideRequests(myOverrides.filter((r) => r.status === "pending"));
      setIncomingOverrideRequests(incomingOverrides);
      setIncomingMoveRequests(incomingMoves);
      setIncomingCapacityRequests(incomingCapacity);
      setClubWaitlist(waitlist);
      setIncomingPlacementRequests(incomingPlacements);
      setIncomingJoinRequests(incomingJoins);
      setLoading(false);
    }
    load();
  }, [isJugendleiter]);

  // "Eigene Gruppen" meint hier wirklich eigene Gruppen (Besitz oder
  // Mit-Trainerschaft) - editableAsLeadership ausgeschlossen, sonst würde
  // die Jugendleitung hier fälschlich alle Vereinsgruppen als "eigene"
  // gezählt bekommen (canEdit ist für sie jetzt vereinsweit true).
  const ownGroups = groups.filter((g) => g.canEdit && !g.editableAsLeadership);
  const ownGroupIds = new Set(ownGroups.map((g) => g.id));
  const allActiveChildren = children.filter((c) => c.status === "active");
  // Kinder (aktiv): Jugendleitung sieht die vereinsweite Gesamtzahl (nicht
  // konsolidiert nach eigenen Gruppen), Turnleiter*innen nur die eigene(n).
  const activeChildren = isJugendleiter
    ? allActiveChildren
    : allActiveChildren.filter((c) => c.groupId && ownGroupIds.has(c.groupId));

  // Jugendleitung: Kennzahlen je Gruppe des Vereins, statt nur konsolidiert -
  // damit man sieht, WELCHE Gruppe z.B. viele offene Vertretungsanfragen hat,
  // nicht nur die vereinsweite Summe.
  const groupBreakdown = useMemo(() => {
    if (!isJugendleiter) return [];
    return [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.minAge - b.minAge)
      .map((g) => ({
        group: g,
        activeChildren: activeChildren.filter((c) => c.groupId === g.id).length,
        openSubstitutes: openSubstitutes.filter((r) => r.groupId === g.id).length,
        upcomingSubstitutes: upcomingSubstitutes.filter((r) => r.groupId === g.id).length,
      }));
  }, [isJugendleiter, groups, activeChildren, openSubstitutes, upcomingSubstitutes]);

  // Kinder, deren Alter nicht (mehr) zur aktuellen Gruppe passt - gleiche
  // Logik wie auf der Kinder-Seite, hier als kompakter Hinweis.
  const mismatched = useMemo(() => {
    const overdue: { child: Child; currentGroup: Group; targetGroup: Group | undefined }[] = [];
    const tooYoung: { child: Child; currentGroup: Group; targetGroup: Group | undefined }[] = [];
    for (const child of activeChildren) {
      const currentGroup = groups.find((g) => g.id === child.groupId);
      if (!currentGroup) continue;
      const age = calculateAgeYears(child.birthDate);
      if (age >= currentGroup.maxAge) overdue.push({ child, currentGroup, targetGroup: groupForAge(age, groups) });
      else if (age < currentGroup.minAge) tooYoung.push({ child, currentGroup, targetGroup: groupForAge(age, groups) });
    }
    const byName = (a: { child: Child }, b: { child: Child }) => a.child.lastName.localeCompare(b.child.lastName);
    overdue.sort(byName);
    tooYoung.sort(byName);
    return { overdue, tooYoung };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChildren, groups]);

  const todos: TodoItem[] = [
    { label: "Verschiebe-Anfragen für deine Gruppen", count: incomingMoveRequests.length, to: "/gruppen", tone: "amber" as const },
    { label: "Kapazitäts-Anfragen für deine Gruppen", count: incomingCapacityRequests.length, to: "/gruppen", tone: "red" as const },
    { label: "Platzvorschläge für deine Gruppen", count: incomingPlacementRequests.length, to: "/warteliste", tone: "amber" as const },
    { label: "Eigene offene Anfragen für abweichende Termine", count: myOverrideRequests.length, to: "/anwesenheit", tone: "amber" as const },
    ...(isJugendleiter
      ? [
          { label: "Anfragen für abweichende Termine", count: incomingOverrideRequests.length, to: "/anwesenheit", tone: "amber" as const },
          { label: "Kinder auf der Warteliste", count: clubWaitlist.length, to: "/warteliste", tone: "amber" as const },
          { label: "Offene Vereinsbeitrittsanfragen", count: incomingJoinRequests.length, to: "/verein", tone: "amber" as const },
        ]
      : []),
  ].filter((t) => t.count > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          Willkommen{userName ? `, ${userName}` : userEmail ? `, ${userEmail}` : ""}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {clubName ? `Überblick für ${clubName}.` : "Überblick über deine Gruppen und offenen Anfragen."}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Link
              to="/gruppen"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {isJugendleiter ? "Eigene Gruppen" : "Meine Gruppen"}
              </p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{ownGroups.length}</p>
            </Link>
            <Link
              to="/kinder"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Kinder (aktiv)</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{activeChildren.length}</p>
            </Link>
            <Link
              to="/vertretungen"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Offene Vertretungsanfragen
              </p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{openSubstitutes.length}</p>
            </Link>
            <Link
              to="/kalender"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Anstehende Vertretungen
              </p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{upcomingSubstitutes.length}</p>
            </Link>
          </div>

          {todos.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">Wartet auf dich</h3>
              <ul className="space-y-1.5">
                {todos.map((todo) => (
                  <li key={todo.label}>
                    <Link
                      to={todo.to}
                      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/60 dark:hover:bg-slate-900/40 ${
                        todo.tone === "red" ? "text-red-800 dark:text-red-300" : "text-amber-900 dark:text-amber-200"
                      }`}
                    >
                      <span>{todo.label}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          todo.tone === "red"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        }`}
                      >
                        {todo.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/kinder"
              className={`rounded-lg border p-4 ${
                mismatched.overdue.length > 0
                  ? "border-red-300 bg-red-50 hover:border-red-400 dark:border-red-800 dark:bg-red-950/50 dark:hover:border-red-700"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              }`}
            >
              <h3
                className={`mb-2 text-sm font-semibold ${
                  mismatched.overdue.length > 0 ? "text-red-800 dark:text-red-300" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                Wechsel überfällig ({mismatched.overdue.length})
              </h3>
              {mismatched.overdue.length > 0 ? (
                <ul className="space-y-1 text-sm text-red-900 dark:text-red-200">
                  {mismatched.overdue.map(({ child, currentGroup, targetGroup }) => (
                    <li key={child.id}>
                      {child.firstName} {child.lastName} – noch in {currentGroup.name}
                      {targetGroup ? `, gehört eigentlich zu ${targetGroup.name}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500">Aktuell kein überfälliger Wechsel.</p>
              )}
            </Link>
            <Link
              to="/kinder"
              className={`rounded-lg border p-4 ${
                mismatched.tooYoung.length > 0
                  ? "border-purple-300 bg-purple-50 hover:border-purple-400 dark:border-purple-800 dark:bg-purple-950/50 dark:hover:border-purple-700"
                  : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              }`}
            >
              <h3
                className={`mb-2 text-sm font-semibold ${
                  mismatched.tooYoung.length > 0 ? "text-purple-800 dark:text-purple-300" : "text-slate-500 dark:text-slate-400"
                }`}
              >
                Eigentlich noch zu jung für die Gruppe ({mismatched.tooYoung.length})
              </h3>
              {mismatched.tooYoung.length > 0 ? (
                <ul className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
                  {mismatched.tooYoung.map(({ child, currentGroup, targetGroup }) => (
                    <li key={child.id}>
                      {child.firstName} {child.lastName} – in {currentGroup.name}
                      {targetGroup ? `, passt eher zu ${targetGroup.name}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500">Aktuell kein Kind zu jung für seine Gruppe.</p>
              )}
            </Link>
          </div>

          {upcomingSubstitutes.length > 0 && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900 dark:bg-purple-950/40">
              <h3 className="mb-2 text-sm font-semibold text-purple-800 dark:text-purple-300">Nächste Vertretungen</h3>
              <ul className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
                {upcomingSubstitutes.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    {formatShortDate(r.sessionDate)} · {r.groupName} · {r.claimedByName ?? "jemand"} vertritt{" "}
                    {r.requestedByName ?? "jemanden"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isJugendleiter && groupBreakdown.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <h3 className="px-4 pt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">
                Gruppen im Verein im Detail
              </h3>
              <p className="px-4 pb-2 text-xs text-slate-500 dark:text-slate-400">
                Kennzahlen je Gruppe, nicht konsolidiert – auch fremde Gruppen deines Vereins.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 dark:text-slate-400">
                    <tr className="border-t border-slate-200 dark:border-slate-800">
                      <th className="px-4 py-2 text-left font-medium">Gruppe</th>
                      <th className="px-4 py-2 text-right font-medium">Kinder (aktiv)</th>
                      <th className="px-4 py-2 text-right font-medium">Offene Vertretungsanfragen</th>
                      <th className="px-4 py-2 text-right font-medium">Anstehende Vertretungen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupBreakdown.map(({ group, activeChildren: count, openSubstitutes: openCount, upcomingSubstitutes: upcomingCount }) => (
                      <tr key={group.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                          {group.name}
                          {group.ownerId === userId ? "" : <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">(fremd)</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{count}</td>
                        <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{openCount}</td>
                        <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">{upcomingCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {todos.length === 0 && upcomingSubstitutes.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
              Keine offenen Anfragen und keine anstehenden Vertretungen.
            </div>
          )}
        </>
      )}
    </div>
  );
}
