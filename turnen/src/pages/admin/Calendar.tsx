import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Group, SubstituteRequest } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { groupColorClasses } from "../../lib/groupColors";

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Montag ... Sonntag
const WEEKDAY_NAMES = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export default function Calendar() {
  const { userId } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [upcomingSubstitutes, setUpcomingSubstitutes] = useState<SubstituteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        setGroups(await api.get<Group[]>("/api/groups"));
        try {
          setUpcomingSubstitutes(await api.get<SubstituteRequest[]>("/api/substitute-requests/upcoming"));
        } catch {
          // Zusatzinfo - Ladefehler soll den Wochenplan nicht blockieren.
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const byWeekday = useMemo(() => {
    const map: Record<number, Group[]> = {};
    for (const day of WEEKDAYS) map[day] = [];
    for (const g of groups) {
      if (g.weekday === null) continue;
      map[g.weekday]?.push(g);
    }
    for (const list of Object.values(map)) {
      list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    }
    return map;
  }, [groups]);

  const unscheduled = groups.filter((g) => g.weekday === null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Trainingskalender</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Trainingszeiten der Woche auf einen Blick – nach Wochentag sortiert. Jede Gruppe hat eine eigene,
          gleichbleibende Farbe zur besseren Unterscheidbarkeit (keine Wertung); die eigene Gruppe ist zusätzlich
          umrandet.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <>
          {/* Spalten mit auto-fit/minmax statt breakpoint-abhängigem
              grid-cols-N oder fester Spaltenzahl mit Scroll: die Seitenleiste
              im Layout ändert, wie viel Platz tatsächlich zur Verfügung
              steht, unabhängig von der Viewport-Breite - auto-fit füllt die
              verfügbare Breite immer vollständig (Spalten strecken sich
              gleichmäßig) und bricht erst bei zu wenig Platz um, statt
              seitlich abzuschneiden. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9rem,1fr))]">
            {WEEKDAYS.map((day, i) => (
              <div key={day} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{WEEKDAY_NAMES[i]}</h3>
                <div className="space-y-2">
                  {byWeekday[day].map((g) => (
                    <div
                      key={g.id}
                      className={`overflow-hidden rounded-md border px-2 py-1.5 text-xs ${groupColorClasses(g.color, g.id)} ${
                        g.ownerId === userId ? "outline outline-2 outline-offset-1 outline-current" : ""
                      }`}
                    >
                      <p className="break-words font-medium">{g.name}</p>
                      {g.ownerId === userId && <p className="text-[0.65rem] font-normal opacity-70">meine Gruppe</p>}
                      {g.startTime && g.endTime && (
                        <p>
                          {g.startTime}–{g.endTime}
                        </p>
                      )}
                      {g.location && <p className="break-words opacity-80">{g.location}</p>}
                    </div>
                  ))}
                  {byWeekday[day].length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">–</p>}
                </div>
              </div>
            ))}
          </div>

          {unscheduled.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Ohne hinterlegten Trainingstag ({unscheduled.length})
              </h3>
              <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {unscheduled.map((g) => (
                  <li key={g.id}>{g.name}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              Anstehende Vertretungen
            </h3>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Bereits übernommene Vertretungstermine im Verein – wer springt wann für wen ein.
            </p>
            {upcomingSubstitutes.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">Aktuell keine anstehenden Vertretungen.</p>
            ) : (
              <ul className="space-y-2">
                {upcomingSubstitutes.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm dark:border-purple-900 dark:bg-purple-950/40"
                  >
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
                      {formatShortDate(r.sessionDate)}
                    </span>
                    <span className="text-purple-900 dark:text-purple-200">
                      {r.groupName} · {r.claimedByName ?? "jemand"} vertritt {r.requestedByName ?? "jemanden"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
