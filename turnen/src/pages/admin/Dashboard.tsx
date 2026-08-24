import { useEffect, useState } from "react";
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
  const { userName, userEmail, clubName, clubRole } = useAuth();
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

  const ownGroups = groups.filter((g) => g.canEdit);
  const activeChildren = children.filter((c) => c.status === "active");

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

          {todos.length === 0 && upcomingSubstitutes.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
              Aktuell nichts, was auf dich wartet.
            </div>
          )}
        </>
      )}
    </div>
  );
}
