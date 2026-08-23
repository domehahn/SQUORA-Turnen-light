import { useEffect, useState, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { HoursReport, HoursSummary } from "../lib/types";

const LOCAL_STORAGE_KEYS = {
  licenseNumber: "turnen_nachweis_lizenznr",
  validUntil: "turnen_nachweis_gueltigbis",
  sport: "turnen_nachweis_sportart",
};

function currentQuarter(): { year: number; quarter: number } {
  const now = new Date();
  return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 };
}

// Immer hell gestylte Eingabefelder, unabhängig vom App-Darkmode - die
// FloatingField-Komponenten haben dark:-Varianten, die hier nicht greifen
// dürfen (siehe Begründung für erzwungenes Hell-Theme weiter unten).
function LightField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function LightInput({ label, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <LightField label={label}>
      <input {...props} className={`${fieldClass} ${className ?? ""}`} />
    </LightField>
  );
}

function LightSelect({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <LightField label={label}>
      <select {...props} className={`${fieldClass} ${className ?? ""}`}>
        {children}
      </select>
    </LightField>
  );
}

export default function HoursReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaults = currentQuarter();
  const [year, setYear] = useState(Number(searchParams.get("year")) || defaults.year);
  const [quarter, setQuarter] = useState(Number(searchParams.get("quarter")) || defaults.quarter);
  const [report, setReport] = useState<HoursReport | null>(null);
  const [summary, setSummary] = useState<HoursSummary | null>(null);
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

  useEffect(() => {
    api
      .get<HoursSummary>("/api/hours-summary")
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  const totalHours = report ? Math.round(report.months.reduce((sum, m) => sum + m.totalHours, 0) * 100) / 100 : 0;
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" }).format(today);

  return (
    // Immer hell/schwarz-auf-weiß, unabhängig vom Darkmode - siehe
    // src/pages/AttendancePrint.tsx für dieselbe Begründung.
    <div className="min-h-screen bg-white p-6 text-slate-900" style={{ colorScheme: "light" }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 print:hidden">
          <h1 className="mb-0.5 text-lg font-semibold text-slate-900">Stundennachweis</h1>
          <p className="mb-4 text-sm text-slate-500">
            Amtliches Formular für den Zuschussnachweis - Daten werden automatisch aus der Anwesenheitserfassung
            übernommen.
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <LightInput label="Jahr" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" />
                <LightSelect label="Quartal" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} className="w-32">
                  <option value={1}>1. Quartal</option>
                  <option value={2}>2. Quartal</option>
                  <option value={3}>3. Quartal</option>
                  <option value={4}>4. Quartal</option>
                </LightSelect>
              </div>
              <button
                onClick={() => window.print()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Drucken
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-3">
              <LightInput label="Sportart" value={sport} onChange={(e) => setSport(e.target.value)} />
              <LightInput label="Lizenz-Nr." value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              <LightInput label="Gültig bis" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} placeholder="TT.MM.JJJJ" />
            </div>
          </div>
        </div>

        {summary && summary.sessionCount > 0 && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 print:hidden">
            <h2 className="mb-2 text-sm font-semibold text-blue-900">Gesamtübersicht - alle Zeit</h2>
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-blue-900">
              <span>
                <span className="text-lg font-bold">{summary.totalHours}</span> Std. insgesamt
              </span>
              <span>
                <span className="font-semibold">{summary.ownHours}</span> Std. eigene Gruppen
              </span>
              <span>
                <span className="font-semibold">{summary.substituteHours}</span> Std. als Vertretung
              </span>
              <span className="text-blue-700">{summary.sessionCount} Einsätze insgesamt</span>
            </div>
            {summary.byYear.length > 1 && (
              <div className="mt-3 overflow-x-auto">
                <table className="text-xs text-blue-900">
                  <thead>
                    <tr className="text-left text-blue-600">
                      <th className="pr-4 py-1">Jahr</th>
                      <th className="pr-4 py-1">Eigene Std.</th>
                      <th className="pr-4 py-1">Vertretung Std.</th>
                      <th className="pr-4 py-1">Summe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byYear.map((y) => (
                      <tr key={y.year} className="border-t border-blue-100">
                        <td className="pr-4 py-1 font-medium">{y.year}</td>
                        <td className="pr-4 py-1">{y.ownHours}</td>
                        <td className="pr-4 py-1">{y.substituteHours}</td>
                        <td className="pr-4 py-1 font-medium">{y.totalHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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
