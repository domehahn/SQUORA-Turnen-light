import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { ChildOverviewRow } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { calculateAgeYears } from "../../lib/age";
import { FloatingInput } from "../../components/FloatingField";

type SortKey = "lastName" | "firstName" | "birthDate" | "age" | "groupName" | "status";
type SortDir = "asc" | "desc";

function formatBirthDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

function csvCell(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, lines: string[]) {
  const csv = "﻿" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const EMPTY_FILTERS = {
  firstName: "",
  lastName: "",
  group: "",
  contact: "",
  birthDate: "",
  ageMin: "",
  ageMax: "",
  status: "active" as "all" | "active" | "archived",
};

export default function ChildrenOverview() {
  const { clubRole, isKassenwart, isAdmin } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";
  const allowed = isJugendleiter || isKassenwart || isAdmin;

  const [rows, setRows] = useState<ChildOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("lastName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        setRows(await api.get<ChildOverviewRow[]>("/api/children/overview?includeArchived=true"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed]);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        age: calculateAgeYears(r.birthDate),
        contact: [r.emergencyContactName, r.emergencyContactPhone].filter(Boolean).join(" · "),
      })),
    [rows]
  );

  const filtered = useMemo(() => {
    const f = filters;
    const fn = f.firstName.trim().toLowerCase();
    const ln = f.lastName.trim().toLowerCase();
    const gr = f.group.trim().toLowerCase();
    const co = f.contact.trim().toLowerCase();
    const bd = f.birthDate.trim().toLowerCase();
    const aMin = f.ageMin === "" ? null : Number(f.ageMin);
    const aMax = f.ageMax === "" ? null : Number(f.ageMax);

    const list = enriched.filter((r) => {
      if (f.status !== "all" && r.status !== f.status) return false;
      if (fn && !r.firstName.toLowerCase().includes(fn)) return false;
      if (ln && !r.lastName.toLowerCase().includes(ln)) return false;
      if (gr && !(r.groupName ?? "ohne gruppe").toLowerCase().includes(gr)) return false;
      if (co && !r.contact.toLowerCase().includes(co)) return false;
      if (bd && !(formatBirthDate(r.birthDate).toLowerCase().includes(bd) || r.birthDate.includes(bd))) return false;
      if (aMin !== null && Number.isFinite(aMin) && r.age < aMin) return false;
      if (aMax !== null && Number.isFinite(aMax) && r.age > aMax) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "age":
          cmp = a.age - b.age;
          break;
        case "birthDate":
          cmp = a.birthDate.localeCompare(b.birthDate);
          break;
        case "groupName":
          cmp = (a.groupName ?? "").localeCompare(b.groupName ?? "", "de");
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "firstName":
          cmp = a.firstName.localeCompare(b.firstName, "de");
          break;
        default:
          cmp = a.lastName.localeCompare(b.lastName, "de");
      }
      if (cmp === 0) cmp = a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de");
      return cmp * dir;
    });
    return list;
  }, [enriched, filters, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  function exportCsv() {
    const header = ["Nachname", "Vorname", "Geburtsdatum", "Alter", "Gruppe", "Status", "Notfallkontakt"];
    const lines = [header.map(csvCell).join(";")];
    for (const r of filtered) {
      lines.push(
        [
          r.lastName,
          r.firstName,
          formatBirthDate(r.birthDate),
          String(r.age),
          r.groupName ?? "Ohne Gruppe",
          r.status === "archived" ? "ausgetreten" : "aktiv",
          r.contact,
        ]
          .map(csvCell)
          .join(";")
      );
    }
    downloadCsv(`kinderuebersicht_${new Date().toISOString().slice(0, 10)}.csv`, lines);
  }

  const filtersActive =
    filters.firstName ||
    filters.lastName ||
    filters.group ||
    filters.contact ||
    filters.birthDate ||
    filters.ageMin ||
    filters.ageMax ||
    filters.status !== "active";

  if (!allowed) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Diese Übersicht ist der Jugendleitung, der Kassenwart:in und dem Plattform-Admin vorbehalten.
      </div>
    );
  }

  const th =
    "px-3 py-2 font-medium text-left cursor-pointer select-none hover:text-slate-900 dark:hover:text-slate-100";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Kinder – Gesamtübersicht</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Kinder des Vereins in einer filterbaren Tabelle. Rein lesend – Änderungen laufen über die Seite „Kinder“.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-40">
          <FloatingInput
            label="Vorname"
            value={filters.firstName}
            onChange={(e) => setFilters({ ...filters, firstName: e.target.value })}
          />
        </div>
        <div className="w-40">
          <FloatingInput
            label="Nachname"
            value={filters.lastName}
            onChange={(e) => setFilters({ ...filters, lastName: e.target.value })}
          />
        </div>
        <div className="w-40">
          <FloatingInput
            label="Gruppe"
            value={filters.group}
            onChange={(e) => setFilters({ ...filters, group: e.target.value })}
          />
        </div>
        <div className="w-40">
          <FloatingInput
            label="Geburtsdatum"
            value={filters.birthDate}
            onChange={(e) => setFilters({ ...filters, birthDate: e.target.value })}
            placeholder="z.B. 2019 oder 15.03."
          />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Alter ab"
            type="number"
            inputMode="numeric"
            value={filters.ageMin}
            onChange={(e) => setFilters({ ...filters, ageMin: e.target.value })}
          />
        </div>
        <div className="w-24">
          <FloatingInput
            label="Alter bis"
            type="number"
            inputMode="numeric"
            value={filters.ageMax}
            onChange={(e) => setFilters({ ...filters, ageMax: e.target.value })}
          />
        </div>
        <div className="w-48">
          <FloatingInput
            label="Notfallkontakt"
            value={filters.contact}
            onChange={(e) => setFilters({ ...filters, contact: e.target.value })}
          />
        </div>
        <label className="flex flex-col text-xs font-medium text-slate-500 dark:text-slate-400">
          Status
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as typeof filters.status })}
            className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="active">nur aktive</option>
            <option value="archived">nur ausgetretene</option>
            <option value="all">alle</option>
          </select>
        </label>
        {filtersActive && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Filter zurücksetzen
          </button>
        )}
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Als CSV ({filtered.length})
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Enthält personenbezogene Daten (Geburtsdaten, Notfallkontakte) – Downloads bitte sicher verwahren und
        datenschutzgerecht löschen.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className={th} onClick={() => toggleSort("lastName")}>
                  Nachname{sortIndicator("lastName")}
                </th>
                <th className={th} onClick={() => toggleSort("firstName")}>
                  Vorname{sortIndicator("firstName")}
                </th>
                <th className={th} onClick={() => toggleSort("birthDate")}>
                  Geburtsdatum{sortIndicator("birthDate")}
                </th>
                <th className={th} onClick={() => toggleSort("age")}>
                  Alter{sortIndicator("age")}
                </th>
                <th className={th} onClick={() => toggleSort("groupName")}>
                  Gruppe{sortIndicator("groupName")}
                </th>
                <th className={th} onClick={() => toggleSort("status")}>
                  Status{sortIndicator("status")}
                </th>
                <th className="px-3 py-2 font-medium">Notfallkontakt</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 dark:text-slate-300">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400 dark:text-slate-500">
                    {rows.length === 0 ? "Noch keine Kinder angelegt." : "Keine Treffer für diese Filter."}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{r.lastName}</td>
                    <td className="px-3 py-2 text-slate-800 dark:text-slate-100">{r.firstName}</td>
                    <td className="px-3 py-2 tabular-nums">{formatBirthDate(r.birthDate)}</td>
                    <td className="px-3 py-2 tabular-nums">{r.age}</td>
                    <td className="px-3 py-2">{r.groupName ?? <span className="text-slate-400">Ohne Gruppe</span>}</td>
                    <td className="px-3 py-2">
                      {r.status === "archived" ? (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          ausgetreten
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          aktiv
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                      {r.contact || <span className="text-slate-400">–</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
