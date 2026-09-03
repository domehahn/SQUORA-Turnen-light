import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type {
  AttendanceStatsResponse,
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
import { capacityLevel } from "../../lib/capacity";
import { buildDropoutWhatsAppUrl } from "../../lib/whatsapp";

const DROPOUT_LOOKBACK_DAYS = 90;
const DROPOUT_MIN_RECORDED = 4;
const DROPOUT_MAX_QUOTE = 25;

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

interface MismatchEntry {
  child: Child;
  currentGroup: Group;
  targetGroup: Group | undefined;
}

function MismatchRow({
  mismatched,
  suffix,
}: {
  mismatched: { overdue: MismatchEntry[]; tooYoung: MismatchEntry[] };
  suffix: string;
}) {
  return (
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
          Wechsel überfällig{suffix} ({mismatched.overdue.length})
        </h3>
        {mismatched.overdue.length > 0 ? (
          <ul className="space-y-1 text-sm text-red-900 dark:text-red-200">
            {mismatched.overdue.map(({ child, currentGroup, targetGroup }) => (
              <li key={child.id}>
                {child.firstName} {child.lastName}
                {targetGroup ? ` – gehört eigentlich zu ${targetGroup.name}` : ""} · Gruppe: {currentGroup.name}
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
          Eigentlich noch zu jung für die Gruppe{suffix} ({mismatched.tooYoung.length})
        </h3>
        {mismatched.tooYoung.length > 0 ? (
          <ul className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
            {mismatched.tooYoung.map(({ child, currentGroup, targetGroup }) => (
              <li key={child.id}>
                {child.firstName} {child.lastName}
                {targetGroup ? ` – passt eher zu ${targetGroup.name}` : ""} · Gruppe: {currentGroup.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400 dark:text-slate-500">Aktuell kein Kind zu jung für seine Gruppe.</p>
        )}
      </Link>
    </div>
  );
}

function DropoutRiskSection({
  childrenList,
  groups,
  attendanceStats,
  suffix,
}: {
  childrenList: Child[];
  groups: Group[];
  attendanceStats: AttendanceStatsResponse | null;
  suffix: string;
}) {
  if (childrenList.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">
          ⚠️ Erhöhte Dropout-Wahrscheinlichkeit{suffix} ({childrenList.length})
        </h3>
      </div>
      <p className="mb-3 text-xs text-red-700 dark:text-red-300/90">
        Diese Kinder waren in den letzten {DROPOUT_LOOKBACK_DAYS} Tagen bei mindestens {DROPOUT_MIN_RECORDED} erfassten Einheiten zu höchstens {DROPOUT_MAX_QUOTE}% anwesend. Es empfiehlt sich, bei den Eltern nachzufragen, ob das Kind weiterhin am Training teilnimmt oder austreten möchte.
      </p>
      <ul className="space-y-2">
        {childrenList.map((child) => {
          const group = groups.find((g) => g.id === child.groupId);
          const stat = attendanceStats?.childrenStats[child.id];
          return (
            <li
              key={child.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/80 p-2.5 text-sm dark:bg-slate-900/60"
            >
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {child.firstName} {child.lastName}
                </span>
                {group && (
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                    · Gruppe: {group.name}
                  </span>
                )}
                {(child.emergencyContactName || child.emergencyContactPhone) && (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                    📞 Elternkontakt: {child.emergencyContactName ?? "Eltern"}
                    {child.emergencyContactPhone ? ` (${child.emergencyContactPhone})` : ""}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {child.emergencyContactPhone && (
                  <a
                    href={buildDropoutWhatsAppUrl({
                      phone: child.emergencyContactPhone,
                      childFirstName: child.firstName,
                      contactName: child.emergencyContactName,
                      quote: stat?.quote,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    📱 WhatsApp senden
                  </a>
                )}
                <div className="text-right">
                  <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/60 dark:text-red-300">
                    {stat?.quote !== null ? `${stat?.quote}% Quote` : "≤25%"}
                  </span>
                  {stat && (
                    <p className="mt-0.5 text-[0.65rem] text-slate-500 dark:text-slate-400">
                      {stat.presentCount} von {stat.totalRecorded} Einheiten
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const { userName, userEmail, clubName, clubRole, isAdmin } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const isJugendleiterOrAdmin = isJugendleiter || isAdmin;

  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStatsResponse | null>(null);
  const [dropoutAttendanceStats, setDropoutAttendanceStats] = useState<AttendanceStatsResponse | null>(null);
  const [openSubstitutes, setOpenSubstitutes] = useState<SubstituteRequest[]>([]);
  const [upcomingSubstitutes, setUpcomingSubstitutes] = useState<SubstituteRequest[]>([]);
  const [myOverrideRequests, setMyOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [incomingOverrideRequests, setIncomingOverrideRequests] = useState<SessionOverrideRequest[]>([]);
  const [incomingMoveRequests, setIncomingMoveRequests] = useState<MoveRequest[]>([]);
  const [incomingCapacityRequests, setIncomingCapacityRequests] = useState<CapacityRequest[]>([]);
  const [myMoveRequests, setMyMoveRequests] = useState<MoveRequest[]>([]);
  const [myCapacityRequests, setMyCapacityRequests] = useState<CapacityRequest[]>([]);
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
        attStats,
        dropoutStats,
        openSubs,
        upcomingSubs,
        myOverrides,
        incomingOverrides,
        incomingMoves,
        incomingCapacity,
        waitlist,
        incomingPlacements,
        incomingJoins,
        myMoves,
        myCapacity,
      ] = await Promise.all([
        safe(api.get<Group[]>("/api/groups"), []),
        safe(api.get<Child[]>("/api/children"), []),
        safe(api.get<AttendanceStatsResponse>("/api/attendance-stats"), null),
        safe(api.get<AttendanceStatsResponse>(`/api/attendance-stats?days=${DROPOUT_LOOKBACK_DAYS}`), null),
        safe(api.get<SubstituteRequest[]>("/api/substitute-requests/open"), []),
        safe(api.get<SubstituteRequest[]>("/api/substitute-requests/upcoming"), []),
        safe(api.get<SessionOverrideRequest[]>("/api/session-override-requests/mine"), []),
        safe(isJugendleiterOrAdmin ? api.get<SessionOverrideRequest[]>("/api/session-override-requests/incoming") : Promise.resolve([]), []),
        safe(api.get<MoveRequest[]>("/api/move-requests/incoming"), []),
        safe(api.get<CapacityRequest[]>("/api/capacity-requests/incoming"), []),
        safe(isJugendleiterOrAdmin ? api.get<ClubWaitlistEntry[]>("/api/club-waitlist") : Promise.resolve([]), []),
        safe(api.get<PlacementRequest[]>("/api/placement-requests/incoming"), []),
        safe(isJugendleiterOrAdmin ? api.get<ClubJoinRequest[]>("/api/club-join-requests/incoming") : Promise.resolve([]), []),
        safe(api.get<MoveRequest[]>("/api/move-requests/outgoing"), []),
        safe(api.get<CapacityRequest[]>("/api/capacity-requests/outgoing"), []),
      ]);
      setGroups(groupList);
      setChildren(childrenList);
      setAttendanceStats(attStats);
      setDropoutAttendanceStats(dropoutStats);
      setOpenSubstitutes(openSubs);
      setUpcomingSubstitutes(upcomingSubs);
      setMyOverrideRequests(myOverrides.filter((r) => r.status === "pending"));
      setIncomingOverrideRequests(incomingOverrides);
      setIncomingMoveRequests(incomingMoves);
      setIncomingCapacityRequests(incomingCapacity);
      setClubWaitlist(waitlist);
      setIncomingPlacementRequests(incomingPlacements);
      setIncomingJoinRequests(incomingJoins);
      setMyMoveRequests(myMoves.filter((r) => r.status === "pending"));
      setMyCapacityRequests(myCapacity.filter((r) => r.status === "pending"));
      setLoading(false);
    }
    load();
  }, [isJugendleiterOrAdmin]);

  // "Eigene Gruppen" meint hier wirklich eigene Gruppen (Besitz oder
  // Mit-Trainerschaft) - editableAsLeadership ausgeschlossen, sonst würde
  // die Jugendleitung hier fälschlich alle Vereinsgruppen als "eigene"
  // gezählt bekommen (canEdit ist für sie jetzt vereinsweit true).
  const ownGroups = groups.filter((g) => g.canEdit && !g.editableAsLeadership);
  const ownGroupIds = new Set(ownGroups.map((g) => g.id));
  const allActiveChildren = children.filter((c) => c.status === "active");
  const activeChildren = allActiveChildren.filter((c) => c.groupId && ownGroupIds.has(c.groupId));

  // Auswertung für eigene Gruppen: wirklich aktive vs. inaktive (<50% Quote) Kinder & Gesamtquote
  const ownStats = useMemo(() => {
    let reallyActiveCount = 0;
    let inactiveCount = 0;
    for (const child of activeChildren) {
      const stat = attendanceStats?.childrenStats[child.id];
      if (stat?.isInactive) {
        inactiveCount++;
      } else {
        reallyActiveCount++;
      }
    }
    let totalPresent = 0;
    let totalRecorded = 0;
    for (const group of ownGroups) {
      const gQuote = attendanceStats?.groupQuotes[group.id];
      if (gQuote) {
        totalPresent += gQuote.presentCount;
        totalRecorded += gQuote.totalRecorded;
      }
    }
    const overallQuote = totalRecorded > 0 ? Math.round((totalPresent / totalRecorded) * 100) : null;
    return {
      total: activeChildren.length,
      reallyActiveCount,
      inactiveCount,
      overallQuote,
    };
  }, [activeChildren, ownGroups, attendanceStats]);

  // Auswertung vereinsweit (für Jugendleitung & Admin): wirklich aktive vs. inaktive Kinder & Gesamtquote
  const clubStats = useMemo(() => {
    let reallyActiveCount = 0;
    let inactiveCount = 0;
    for (const child of allActiveChildren) {
      const stat = attendanceStats?.childrenStats[child.id];
      if (stat?.isInactive) {
        inactiveCount++;
      } else {
        reallyActiveCount++;
      }
    }
    const overallQuote = attendanceStats?.clubQuote?.quote ?? null;
    return {
      total: allActiveChildren.length,
      reallyActiveCount,
      inactiveCount,
      overallQuote,
    };
  }, [allActiveChildren, attendanceStats]);

  // Kinder, deren Alter nicht (mehr) zur aktuellen Gruppe passt - gleiche
  // Logik wie auf der Kinder-Seite, hier als kompakter Hinweis. Zwei
  // getrennte Auswertungen: eigene Gruppe(n) (für alle Rollen) und
  // vereinsweit alle Gruppen (nur Jugendleitung).
  function findMismatches(relevantChildren: Child[]) {
    const overdue: { child: Child; currentGroup: Group; targetGroup: Group | undefined }[] = [];
    const tooYoung: { child: Child; currentGroup: Group; targetGroup: Group | undefined }[] = [];
    for (const child of relevantChildren) {
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
  }
  const mismatchedOwn = useMemo(
    () => findMismatches(activeChildren),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeChildren, groups]
  );
  const mismatchedAll = useMemo(
    () => findMismatches(allActiveChildren),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allActiveChildren, groups]
  );

  // Kinder mit erhöhter Dropout-Wahrscheinlichkeit: rollierende 90 Tage,
  // mindestens vier erfasste Einheiten und höchstens 25 % Anwesenheit.
  const highDropoutRiskOwn = useMemo(() => {
    return activeChildren.filter((c) => {
      const stat = dropoutAttendanceStats?.childrenStats[c.id];
      return stat && stat.quote !== null && stat.quote <= DROPOUT_MAX_QUOTE && stat.totalRecorded >= DROPOUT_MIN_RECORDED;
    });
  }, [activeChildren, dropoutAttendanceStats]);

  const highDropoutRiskAll = useMemo(() => {
    return allActiveChildren.filter((c) => {
      const stat = dropoutAttendanceStats?.childrenStats[c.id];
      return stat && stat.quote !== null && stat.quote <= DROPOUT_MAX_QUOTE && stat.totalRecorded >= DROPOUT_MIN_RECORDED;
    });
  }, [allActiveChildren, dropoutAttendanceStats]);

  // Kapazitätswarnung: Gruppen, die voll oder überbelegt sind (gleiche
  // Schwellwerte wie auf der Gruppen-/Auslastungsseite) - Turnleiter*innen
  // sehen nur die eigene(n) Gruppe(n), Jugendleitung alle Vereinsgruppen.
  const capacityWarnings = useMemo(() => {
    const relevantGroups = isJugendleiterOrAdmin ? groups : ownGroups;
    return relevantGroups
      .map((group) => {
        const count = allActiveChildren.filter((c) => c.groupId === group.id).length;
        return { group, count, level: capacityLevel(count, group.maxChildren) };
      })
      .filter((g) => g.level === "warn" || g.level === "over")
      .sort((a, b) => (b.count / (b.group.maxChildren ?? 1)) - (a.count / (a.group.maxChildren ?? 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJugendleiterOrAdmin, groups, ownGroups, allActiveChildren]);

  const todos: TodoItem[] = [
    { label: "Verschiebe-Anfragen für deine Gruppen", count: incomingMoveRequests.length, to: "/gruppen", tone: "amber" as const },
    { label: "Kapazitäts-Anfragen für deine Gruppen", count: incomingCapacityRequests.length, to: "/gruppen", tone: "red" as const },
    { label: "Platzvorschläge für deine Gruppen", count: incomingPlacementRequests.length, to: "/warteliste", tone: "amber" as const },
    { label: "Eigene offene Anfragen für abweichende Termine", count: myOverrideRequests.length, to: "/anwesenheit", tone: "amber" as const },
    { label: "Eigene offene Kapazitäts-Anfragen", count: myCapacityRequests.length, to: "/kinder", tone: "amber" as const },
    ...(isJugendleiterOrAdmin
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Link
              to="/gruppen"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {isJugendleiterOrAdmin ? "Eigene Gruppen" : "Meine Gruppen"}
              </p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{ownGroups.length}</p>
            </Link>
            <Link
              to="/kinder"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Kinder (wirklich aktiv)</p>
              <div className="flex items-baseline gap-1.5">
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{ownStats.reallyActiveCount}</p>
                <span className="text-xs text-slate-400 dark:text-slate-500">/ {ownStats.total}</span>
              </div>
              <p className="mt-1 text-xs">
                {ownStats.inactiveCount > 0 ? (
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {ownStats.inactiveCount} inaktiv (&lt;50%)
                    {highDropoutRiskOwn.length > 0 && (
                      <span className="font-semibold text-red-600 dark:text-red-400 block sm:inline sm:ml-1">
                        · {highDropoutRiskOwn.length} Dropout-Risiko (≤25%)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">Alle aktiv (≥50%)</span>
                )}
              </p>
            </Link>
            <Link
              to="/anwesenheit"
              className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Anwesenheitsquote</p>
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {ownStats.overallQuote !== null ? `${ownStats.overallQuote}%` : "–"}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Eigene Gruppe(n)</p>
            </Link>
            <Link
              to="/vertretungen"
              className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-700"
            >
              <p className="hyphens-auto text-xs font-medium uppercase leading-relaxed tracking-wide text-slate-500 [overflow-wrap:anywhere] dark:text-slate-400">
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
              <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {upcomingSubstitutes.length}
                {upcomingSubstitutes.some((r) => r.status === "open") && (
                  <span className="ml-1.5 text-sm font-normal text-amber-600 dark:text-amber-400">
                    ({upcomingSubstitutes.filter((r) => r.status === "open").length} offen)
                  </span>
                )}
              </p>
            </Link>
          </div>

          {isJugendleiterOrAdmin && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {clubName ?? "Verein"} gesamt (alle Gruppen)
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Gruppen im Verein</p>
                  <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{groups.length}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Kinder (wirklich aktiv)</p>
                  <div className="flex items-baseline gap-1.5">
                    <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{clubStats.reallyActiveCount}</p>
                    <span className="text-xs text-slate-400 dark:text-slate-500">/ {clubStats.total}</span>
                  </div>
                  <p className="mt-1 text-xs">
                    {clubStats.inactiveCount > 0 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {clubStats.inactiveCount} inaktiv (&lt;50%)
                        {highDropoutRiskAll.length > 0 && (
                          <span className="font-semibold text-red-600 dark:text-red-400 block sm:inline sm:ml-1">
                            · {highDropoutRiskAll.length} Dropout-Risiko (≤25%)
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">Alle aktiv (≥50%)</span>
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Gesamtquote Verein</p>
                  <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                    {clubStats.overallQuote !== null ? `${clubStats.overallQuote}%` : "–"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Alle Gruppen im Verein</p>
                </div>
              </div>
            </div>
          )}

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

          {myMoveRequests.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                Eigene offene Verschiebe-Anfragen ({myMoveRequests.length})
              </h3>
              <ul className="space-y-1.5">
                {myMoveRequests.map((r) => {
                  const targetGroup = groups.find((g) => g.id === r.toGroupId);
                  return (
                    <li key={r.id}>
                      <Link
                        to="/kinder"
                        className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm text-amber-900 hover:bg-white/60 dark:text-amber-200 dark:hover:bg-slate-900/40"
                      >
                        <span>
                          {r.childName} → <span className="font-medium">{r.toGroupName}</span>
                        </span>
                        <span className="text-xs text-amber-700/80 dark:text-amber-300/70">
                          Turnleitung dort: {targetGroup?.ownerName ?? "unbekannt"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {capacityWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
              <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                Kapazitätswarnung ({capacityWarnings.length})
              </h3>
              <ul className="space-y-1.5">
                {capacityWarnings.map(({ group, count, level }) => (
                  <li key={group.id}>
                    <Link
                      to="/gruppen"
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-amber-900 hover:bg-white/60 dark:text-amber-200 dark:hover:bg-slate-900/40"
                    >
                      <span>{group.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          level === "over"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        }`}
                      >
                        {count} / {group.maxChildren}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DropoutRiskSection
            childrenList={highDropoutRiskOwn}
            groups={groups}
            attendanceStats={dropoutAttendanceStats}
            suffix={isJugendleiterOrAdmin ? " (eigene Gruppen)" : ""}
          />

          {isJugendleiterOrAdmin && (
            <DropoutRiskSection
              childrenList={highDropoutRiskAll}
              groups={groups}
              attendanceStats={dropoutAttendanceStats}
              suffix=" (alle Gruppen)"
            />
          )}

          <MismatchRow mismatched={mismatchedOwn} suffix={isJugendleiterOrAdmin ? " (eigene Gruppen)" : ""} />

          {isJugendleiterOrAdmin && <MismatchRow mismatched={mismatchedAll} suffix=" (alle Gruppen)" />}

          {upcomingSubstitutes.length > 0 && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-900 dark:bg-purple-950/40">
              <h3 className="mb-2 text-sm font-semibold text-purple-800 dark:text-purple-300">Nächste Vertretungen</h3>
              <ul className="space-y-1 text-sm text-purple-900 dark:text-purple-200">
                {upcomingSubstitutes.slice(0, 5).map((r) => (
                  <li key={r.id}>
                    {formatShortDate(r.sessionDate)} · {r.groupName} ·{" "}
                    {r.status === "open" ? (
                      <span className="font-medium text-amber-700 dark:text-amber-400">noch unbesetzt</span>
                    ) : (
                      <>
                        {r.claimedByName ?? "jemand"} vertritt {r.requestedByName ?? "jemanden"}
                      </>
                    )}
                  </li>
                ))}
              </ul>
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
