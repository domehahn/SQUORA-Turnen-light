import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { HoursReport } from "../lib/types";

const LOCAL_STORAGE_KEYS = {
  licenseNumber: "turnen_nachweis_lizenznr",
  validUntil: "turnen_nachweis_gueltigbis",
  sport: "turnen_nachweis_sportart",
};

function currentQuarter(): { year: number; quarter: number } {
  const now = new Date();
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
}

export default function HoursReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = currentQuarter();
  const [year, setYear] = useState(Number(searchParams.get("year")) || defaults.year);
  const [quarter, setQuarter] = useState(Number(searchParams.get("quarter")) || defaults.quarter);
  const [report, setReport] = useState<HoursReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [licenseNumber, setLicenseNumber] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.licenseNumber) ?? "");
  const [validUntil, setValidUntil] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.validUntil) ?? "");
  const [sport, setSport] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.sport) ?? "Kinderturnen");

  useEffect(() => {
    setSearchParams({ year: String(year), quarter: String(quarter) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, quarter]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.licenseNumber, licenseNumber);
  }, [licenseNumber]);
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.validUntil, validUntil);
  }, [validUntil]);
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.sport, sport);
  }, [sport]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        setReport(await api.get<HoursReport>(`/api/hours-report?year=${year}&quarter=${quarter}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Fehler beim Laden");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [year, quarter]);

  const totalHours = report ? Math.round(report.months.reduce((sum, m) => sum + m.totalHours, 0) * 100) / 100 : 0;
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" }).format(today);

  return (
    // Immer hell/schwarz-auf-weiß, unabhängig vom Darkmode - siehe
    // src/pages/AttendancePrint.tsx für dieselbe Begründung.
    <div className="min-h-screen bg-white p-6 text-slate-900" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              Jahr
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="ml-2 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-sm text-slate-600">
              Quartal
              <select
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
                className="ml-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              >
                <option value={1}>1. Quartal</option>
                <option value={2}>2. Quartal</option>
                <option value={3}>3. Quartal</option>
                <option value={4}>4. Quartal</option>
              </select>
            </label>
            <label className="text-sm text-slate-600">
              Sportart
              <input
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="ml-2 w-40 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-sm text-slate-600">
              Lizenz-Nr.
              <input
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="ml-2 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
            <label className="text-sm text-slate-600">
              Gültig bis
              <input
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="ml-2 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
          </div>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Drucken
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600 print:hidden">Fehler: {error}</p>}
        {loading || !report ? (
          <p className="text-sm text-slate-500 print:hidden">Lädt…</p>
        ) : (
          <>
            {/* --- Zahlungsnachweis des Vereins --- */}
            <h1 className="mb-3 text-lg font-bold">Zahlungsnachweis des Vereins</h1>
            <div className="mb-4 grid grid-cols-[10rem_1fr] gap-y-1 text-sm">
              <span className="text-slate-500">Vereinsnummer:</span>
              <span className="border-b border-slate-400">{report.clubNumber ?? ""}</span>
              <span className="text-slate-500">Verein:</span>
              <span className="border-b border-slate-400">{report.clubName ?? ""}</span>
              <span className="text-slate-500">Name, Vorname:</span>
              <span className="border-b border-slate-400">{report.userName ?? ""}</span>
              <span className="text-slate-500">Lizenz-Nr.:</span>
              <span className="border-b border-slate-400">{licenseNumber}</span>
              <span className="text-slate-500">Gültig bis:</span>
              <span className="border-b border-slate-400">{validUntil}</span>
            </div>

            <p className="mb-2 text-sm">
              Im {quarter}. Quartal {year} wurden folgende Zahlungen (Brutto) geleistet:
            </p>
            <table className="mb-4 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-slate-400 px-2 py-1 text-left">Für Monat</th>
                  <th className="border border-slate-400 px-2 py-1">Zahl der Stunden</th>
                  <th className="border border-slate-400 px-2 py-1">Euro pro Stunde</th>
                  <th className="border border-slate-400 px-2 py-1">Zusammen in Euro</th>
                  <th className="border border-slate-400 px-2 py-1">Pauschalbetrag in Euro</th>
                  <th className="border border-slate-400 px-2 py-1">Davon Fahrt-/Nebenkosten in Euro</th>
                </tr>
              </thead>
              <tbody>
                {report.months.map((m) => (
                  <tr key={m.month}>
                    <td className="border border-slate-400 px-2 py-1">{m.monthName} {year}</td>
                    <td className="border border-slate-400 px-2 py-1 text-center">{m.totalHours || ""}</td>
                    <td className="border border-slate-400 px-2 py-1 text-center text-xs text-slate-400">Füllt der Verein aus</td>
                    <td className="border border-slate-400 px-2 py-1"></td>
                    <td className="border border-slate-400 px-2 py-1 text-center text-xs text-slate-400">Füllt der Verein aus</td>
                    <td className="border border-slate-400 px-2 py-1"></td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="border border-slate-400 px-2 py-1">Summe</td>
                  <td className="border border-slate-400 px-2 py-1 text-center">{totalHours}</td>
                  <td className="border border-slate-400 px-2 py-1"></td>
                  <td className="border border-slate-400 px-2 py-1"></td>
                  <td className="border border-slate-400 px-2 py-1"></td>
                  <td className="border border-slate-400 px-2 py-1"></td>
                </tr>
              </tbody>
            </table>

            <p className="mb-6 text-sm">Es wird bestätigt, dass die oben aufgeführten Beträge gezahlt und verbucht wurden.</p>
            <div className="mb-8 grid grid-cols-3 gap-6 text-sm">
              <div>
                <p className="border-b border-slate-400 pb-8">, {todayLabel}</p>
                <p className="text-xs text-slate-500">Ort / Datum</p>
              </div>
              <div>
                <p className="border-b border-slate-400 pb-8"></p>
                <p className="text-xs text-slate-500">Unterschrift 1. Vorsitzender</p>
              </div>
              <div>
                <p className="border-b border-slate-400 pb-8"></p>
                <p className="text-xs text-slate-500">Unterschrift Schatzmeister</p>
              </div>
            </div>

            {/* --- Stundennachweis des Übungsleiters --- */}
            <h1 className="mb-3 text-lg font-bold break-before-page">Stundennachweis des Übungsleiters</h1>
            <p className="mb-3 text-sm">Für diese Sportart wurden Übungsstunden erteilt: {sport}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {report.months.map((m) => (
                <div key={m.month}>
                  <h3 className="mb-1 text-sm font-semibold uppercase">Monat {m.monthName}</h3>
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="border border-slate-400 px-1 py-1">Dat.</th>
                        <th className="border border-slate-400 px-1 py-1">Uhrzeit von-bis</th>
                        <th className="border border-slate-400 px-1 py-1">Zahl d. Std.</th>
                        <th className="border border-slate-400 px-1 py-1">Einsatzort</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.sessions.map((s) => (
                        <tr key={s.date}>
                          <td className="border border-slate-400 px-1 py-1 text-center">{s.day}</td>
                          <td className="border border-slate-400 px-1 py-1 text-center">
                            {s.startTime && s.endTime ? `${s.startTime}-${s.endTime}` : ""}
                          </td>
                          <td className="border border-slate-400 px-1 py-1 text-center">{s.hours ?? ""}</td>
                          <td className="border border-slate-400 px-1 py-1">{s.location}</td>
                        </tr>
                      ))}
                      {/* Leerzeilen zum handschriftlichen Nachtragen */}
                      {Array.from({ length: Math.max(0, 6 - m.sessions.length) }).map((_, i) => (
                        <tr key={`empty-${i}`}>
                          <td className="border border-slate-400 px-1 py-2"></td>
                          <td className="border border-slate-400 px-1 py-2"></td>
                          <td className="border border-slate-400 px-1 py-2"></td>
                          <td className="border border-slate-400 px-1 py-2"></td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="border border-slate-400 px-1 py-1"></td>
                        <td className="border border-slate-400 px-1 py-1"></td>
                        <td className="border border-slate-400 px-1 py-1 text-center">{m.totalHours || ""}</td>
                        <td className="border border-slate-400 px-1 py-1"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>

            <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
              <p>
                Die aufgeführten Stunden habe ich selbst
                <br />
                geleistet und die oben eingetragenen Beträge erhalten.
              </p>
              <div className="text-right">
                <p className="mb-1 italic">{report.userName}</p>
                <p className="border-t border-slate-400 pt-1 text-xs text-slate-500">Unterschrift Übungsleiter</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
