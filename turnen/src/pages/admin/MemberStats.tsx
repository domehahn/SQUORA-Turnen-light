import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { Child, Group, MemberEvent } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingSelect } from "../../components/FloatingField";
import { appPath } from "../../lib/paths";
import { buildQuarterRange, computeBestandRows, computeEventRows, shiftQuarter } from "../../lib/memberStats";

const QUARTER_COUNT = 12; // Default-Zeitraum: letzte 3 Jahre
const YEAR_RANGE_BACK = 8; // wie weit "Von Jahr" in die Vergangenheit reicht

function csvCell(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function MemberStats() {
  const { clubId, clubName, clubRole } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const [groups, setGroups] = useState<Group[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [events, setEvents] = useState<MemberEvent[]>([]);
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

  // Wie bei der Auslastung: Turnleiter*innen sehen nur die eigene(n)
  // Gruppe(n), die Jugendleitung alle Gruppen des Vereins. canEdit deckt
  // (anders als der reine ownerId-Vergleich vorher) auch Mit-Trainer*innen
  // ab, die eine Gruppe nicht selbst besitzen, aber mitleiten - sonst
  // blieb die Statistik für sie komplett leer.
  const visibleGroups = useMemo(
    () =>
      groups
        .filter((g) => g.clubId !== null && g.clubId === clubId && g.canEdit)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.minAge - b.minAge),
    [groups, clubId]
  );

  const quarters = useMemo(
    () => buildQuarterRange(fromYear, fromQuarter, toYear, toQuarter),
    [fromYear, fromQuarter, toYear, toQuarter]
  );

  const rows = useMemo(() => computeBestandRows(quarters, children, visibleGroups), [quarters, children, visibleGroups]);
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  const eventRows = useMemo(() => computeEventRows(quarters, events, visibleGroups), [quarters, events, visibleGroups]);
  const hasAnyEvents = eventRows.some((r) => r.created > 0 || r.moved > 0 || r.left > 0);

  function handleExportCsv() {
    const header = ["Quartal", ...visibleGroups.map((g) => g.name), "Gesamt", "Neu", "Wechsel", "Ausgetreten"];
    const lines = [header.map(csvCell).join(";")];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const ev = eventRows[i];
      const cells = [
        r.label,
        ...visibleGroups.map((g) => String(r.perGroup[g.id] ?? 0)),
        String(r.total),
        String(ev.created),
        String(ev.moved),
        String(ev.left),
      ];
      lines.push(cells.map(csvCell).join(";"));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mitgliederstatistik_q${fromQuarter}-${fromYear}_bis_q${toQuarter}-${toYear}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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
        <a
          href={appPath(`/druck/mitgliederstatistik?fromYear=${fromYear}&fromQuarter=${fromQuarter}&toYear=${toYear}&toQuarter=${toQuarter}`)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Drucken
        </a>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={rows.length === 0}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          CSV herunterladen
        </button>
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

          <div>
            <h3 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Zu- und Abgänge je Quartal</h3>
            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Neuanmeldungen, interne Gruppenwechsel und Austritte, basierend auf dem Verlauf. Ereignisse von vor
              Einführung dieser Auswertung fehlen hier entsprechend – der Bestand oben ist davon nicht betroffen.
            </p>
            {!hasAnyEvents ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500">
                Noch keine protokollierten Zu-/Abgänge im gewählten Zeitraum.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <tr>
                      <th className="px-4 py-2 font-medium">Quartal</th>
                      <th className="px-4 py-2 text-center font-medium">Neu</th>
                      <th className="px-4 py-2 text-center font-medium">Wechsel</th>
                      <th className="px-4 py-2 text-center font-medium">Ausgetreten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventRows.map((r) => (
                      <tr key={r.label} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{r.label}</td>
                        <td className="px-4 py-2 text-center text-emerald-700 dark:text-emerald-400">
                          {r.created > 0 ? `+${r.created}` : "–"}
                        </td>
                        <td className="px-4 py-2 text-center text-slate-600 dark:text-slate-300">{r.moved || "–"}</td>
                        <td className="px-4 py-2 text-center text-red-600 dark:text-red-400">
                          {r.left > 0 ? `−${r.left}` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
