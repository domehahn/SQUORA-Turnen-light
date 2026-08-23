import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { Child, Group } from "../lib/types";
import { nextTrainingDates, formatShortDate } from "../lib/schedule";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

type Mode = "anwesenheit" | "namen";

function formatBirthDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export default function AttendancePrint() {
  const { groupId } = useParams<{ groupId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "namen" ? "namen" : "anwesenheit";
  const [group, setGroup] = useState<Group | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [groups, childrenList] = await Promise.all([
          api.get<Group[]>("/api/groups"),
          api.get<Child[]>("/api/children"),
        ]);
        setGroup(groups.find((g) => g.id === groupId) ?? null);
        setChildren(childrenList.filter((c) => c.groupId === groupId).sort((a, b) => a.lastName.localeCompare(b.lastName)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [groupId]);

  if (loading) return <p className="p-6 text-sm text-slate-500">Lädt…</p>;
  if (error) return <p className="p-6 text-sm text-red-600">Fehler: {error}</p>;
  if (!group) return <p className="p-6 text-sm text-slate-500">Gruppe nicht gefunden.</p>;

  const dates = group.weekday !== null ? nextTrainingDates(group.weekday, 4) : [];

  return (
    <div className="mx-auto max-w-3xl p-6 text-slate-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex gap-1 rounded-md border border-slate-300 p-0.5">
          <button
            onClick={() => setSearchParams({ mode: "anwesenheit" })}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              mode === "anwesenheit" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Anwesenheitsliste
          </button>
          <button
            onClick={() => setSearchParams({ mode: "namen" })}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              mode === "namen" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Namensliste
          </button>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Drucken
        </button>
      </div>

      <h1 className="text-xl font-semibold">{group.name}</h1>
      <p className="mb-4 text-sm text-slate-600">
        {group.minAge}–{group.maxAge} Jahre
        {group.weekday !== null && ` · ${WEEKDAY_NAMES[group.weekday]}`}
        {group.startTime && group.endTime && ` ${group.startTime}–${group.endTime}`}
        {group.location && ` · ${group.location}`}
      </p>

      {mode === "anwesenheit" ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-400 px-2 py-1 text-left">Name</th>
              {dates.length > 0
                ? dates.map((d) => (
                    <th key={d} className="border border-slate-400 px-2 py-1">
                      {formatShortDate(d)}
                    </th>
                  ))
                : [1, 2, 3, 4].map((n) => (
                    <th key={n} className="border border-slate-400 px-2 py-1">
                      Termin {n}
                    </th>
                  ))}
            </tr>
          </thead>
          <tbody>
            {children.map((child) => (
              <tr key={child.id}>
                <td className="border border-slate-400 px-2 py-1.5">
                  {child.firstName} {child.lastName}
                </td>
                {[0, 1, 2, 3].map((i) => (
                  <td key={i} className="border border-slate-400 px-2 py-1.5" style={{ width: "3.5rem" }} />
                ))}
              </tr>
            ))}
            {children.length === 0 && (
              <tr>
                <td colSpan={5} className="border border-slate-400 px-2 py-4 text-center text-slate-500">
                  Keine Kinder in dieser Gruppe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-slate-400 px-2 py-1 text-left">Nachname</th>
              <th className="border border-slate-400 px-2 py-1 text-left">Vorname</th>
              <th className="border border-slate-400 px-2 py-1 text-left">Geburtsdatum</th>
            </tr>
          </thead>
          <tbody>
            {children.map((child) => (
              <tr key={child.id}>
                <td className="border border-slate-400 px-2 py-1.5">{child.lastName}</td>
                <td className="border border-slate-400 px-2 py-1.5">{child.firstName}</td>
                <td className="border border-slate-400 px-2 py-1.5">{formatBirthDate(child.birthDate)}</td>
              </tr>
            ))}
            {children.length === 0 && (
              <tr>
                <td colSpan={3} className="border border-slate-400 px-2 py-4 text-center text-slate-500">
                  Keine Kinder in dieser Gruppe.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
