import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiPath, apiPutBinary } from "../lib/api";
import type { HoursReport, HoursReportSubmission, HoursSummary } from "../lib/types";
import SquoraBrand from "../components/SquoraBrand";
import { FloatingInput, FloatingSelect } from "../components/FloatingField";
import { SignaturePad, type SignaturePadHandle } from "../components/SignaturePad";
import { buildHoursReportPdf } from "../lib/hoursReportPdf";

function formatEuroCents(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function periodLabel(quarter: number, year: number): string {
  return quarter === 0 ? `Jahr ${year}` : `${quarter}. Quartal ${year}`;
}

function apiSubmissionPdfHref(id: string): string {
  return apiPath(`/api/hours-report/submissions/${id}/pdf`);
}

// SQUORA-Formularstil (siehe tournament-manager/AufstellungsbogenPdfService):
// helle blaue Tabellenköpfe statt schlichtem Grau/Schwarz.
const thClass = "border border-slate-400 bg-blue-100 px-2 py-1 font-semibold text-blue-900";
const thClassSm = "border border-slate-400 bg-blue-100 px-1 py-1 font-semibold text-blue-900";

const LOCAL_STORAGE_KEYS = {
  licenseNumber: "turnen_nachweis_lizenznr",
  validUntil: "turnen_nachweis_gueltigbis",
  sport: "turnen_nachweis_sportart",
  ort: "turnen_nachweis_ort",
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
  const [summary, setSummary] = useState<HoursSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Jede:r kann eigene Stunden einreichen - auch Springer:innen (für
  // übernommene Vertretungen) und Kassenwart:innen, sofern sie zugleich eine
  // Gruppe leiten. Der Server ordnet die Stunden ohnehin per led_by zu.
  const canSubmit = true;
  const [mySubmissions, setMySubmissions] = useState<HoursReportSubmission[]>([]);
  const signatureRef = useRef<SignaturePadHandle>(null);
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const submission = useMemo(
    () => mySubmissions.find((s) => s.year === year && s.quarter === quarter) ?? null,
    [mySubmissions, year, quarter]
  );
  const locked = submission?.status === "settled";

  const [licenseNumber, setLicenseNumber] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.licenseNumber) ?? "");
  const [validUntil, setValidUntil] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.validUntil) ?? "");
  const [sport, setSport] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.sport) ?? "Kinderturnen");
  const [ort, setOrt] = useState(() => localStorage.getItem(LOCAL_STORAGE_KEYS.ort) ?? "Büchenbeuren");

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
    localStorage.setItem(LOCAL_STORAGE_KEYS.ort, ort);
  }, [ort]);

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

  async function loadMySubmissions() {
    try {
      setMySubmissions(await api.get<HoursReportSubmission[]>("/api/hours-report/submissions/mine"));
    } catch {
      setMySubmissions([]);
    }
  }
  useEffect(() => {
    if (canSubmit) loadMySubmissions();
  }, [canSubmit]);

  async function handleSubmit() {
    if (!report) return;
    const signatureDataUrl = signatureRef.current?.getDataUrl() ?? null;
    if (!signatureDataUrl) {
      setSubmitMsg(null);
      setError("Bitte zuerst unterschreiben.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSubmitMsg(null);
    try {
      const blob = buildHoursReportPdf(
        report,
        { sport, licenseNumber, validUntil, ort, dateLabel: todayLabel },
        signatureDataUrl
      );
      await apiPutBinary(
        `/api/hours-report/submissions?year=${year}&quarter=${quarter}`,
        blob,
        "application/pdf"
      );
      signatureRef.current?.clear();
      setSubmitMsg(submission ? "Nachweis erneut eingereicht." : "Nachweis eingereicht.");
      await loadMySubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Einreichen fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  const totalHours = report ? Math.round(report.months.reduce((sum, m) => sum + m.totalHours, 0) * 100) / 100 : 0;
  const today = new Date();
  const todayLabel = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" }).format(today);

  return (
    // Immer hell/schwarz-auf-weiß, unabhängig vom Darkmode - siehe
    // src/pages/AttendancePrint.tsx für dieselbe Begründung.
    <div
      className="min-h-screen bg-white p-4 text-slate-900 sm:p-6"
      style={{ colorScheme: "light", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
    >
      <div className="mx-auto max-w-5xl">
        <SquoraBrand className="mb-4" />
        <div className="mb-4 print:hidden">
          <h1 className="mb-0.5 text-lg font-semibold text-slate-900">Stundennachweis</h1>
          <p className="mb-4 text-sm text-slate-500">
            Amtliches Formular für den Zuschussnachweis - Daten werden automatisch aus der Anwesenheitserfassung
            übernommen.
          </p>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-28">
                  <FloatingInput
                    label="Jahr"
                    type="number"
                    forceLight
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  />
                </div>
                <div className="w-40">
                  <FloatingSelect label="Zeitraum" forceLight value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                    <option value={0}>Ganzes Jahr</option>
                    <option value={1}>1. Quartal</option>
                    <option value={2}>2. Quartal</option>
                    <option value={3}>3. Quartal</option>
                    <option value={4}>4. Quartal</option>
                  </FloatingSelect>
                </div>
              </div>
              <button
                onClick={() => window.print()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Drucken
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4">
              <FloatingInput label="Sportart" forceLight value={sport} onChange={(e) => setSport(e.target.value)} />
              <FloatingInput label="Lizenz-Nr." forceLight value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              <FloatingInput
                label="Gültig bis"
                forceLight
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                placeholder="TT.MM.JJJJ"
              />
              <FloatingInput label="Ort" forceLight value={ort} onChange={(e) => setOrt(e.target.value)} />
            </div>
          </div>
        </div>

        {canSubmit && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 print:hidden">
            <h2 className="mb-1 text-sm font-semibold text-slate-900">Einreichen für {periodLabel(quarter, year)}</h2>
            {submission && (
              <p className="mb-2 text-xs text-slate-500">
                {submission.status === "settled" ? (
                  <>
                    Abgerechnet am {new Date(submission.settledAt!).toLocaleDateString("de-DE")}
                    {submission.settledByName ? ` von ${submission.settledByName}` : ""}
                    {submission.settledAmountCents != null ? ` · Betrag ${formatEuroCents(submission.settledAmountCents)}` : ""}
                    {submission.settledRateCents != null ? ` · ${formatEuroCents(submission.settledRateCents)}/Std.` : ""}
                    {submission.settledNote ? ` · ${submission.settledNote}` : ""}. Der Nachweis ist gesperrt.
                  </>
                ) : (
                  <>
                    Eingereicht am {new Date(submission.updatedAt).toLocaleString("de-DE")} ({submission.totalHours} Std.).
                    Bis zur Abrechnung durch die Kassenwart:in kannst du ihn erneut einreichen.
                  </>
                )}
              </p>
            )}

            {locked ? (
              <p className="text-sm text-slate-600">
                Dieser Stundennachweis wurde abgerechnet und kann nicht mehr geändert werden.{" "}
                <a
                  className="text-blue-700 underline"
                  href={apiSubmissionPdfHref(submission!.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Eingereichtes PDF ansehen
                </a>
              </p>
            ) : (
              <div className="flex flex-wrap items-start gap-4">
                <SignaturePad ref={signatureRef} onChange={setSignatureEmpty} />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || signatureEmpty || !report}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? "Wird eingereicht…" : submission ? "Erneut einreichen" : "Unterschreiben & einreichen"}
                  </button>
                  {submission && (
                    <a
                      className="text-xs text-blue-700 underline"
                      href={apiSubmissionPdfHref(submission.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Zuletzt eingereichtes PDF ansehen
                    </a>
                  )}
                  {submitMsg && <span className="text-xs font-medium text-emerald-700">{submitMsg}</span>}
                </div>
              </div>
            )}
          </div>
        )}

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
              {quarter === 0 ? `Im Jahr ${year}` : `Im ${quarter}. Quartal ${year}`} wurden folgende Zahlungen (Brutto)
              geleistet:
            </p>
            <table className="mb-4 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={`${thClass} text-left`}>Für Monat</th>
                  <th className={thClass}>Zahl der Stunden</th>
                  <th className={thClass}>Euro pro Stunde</th>
                  <th className={thClass}>Zusammen in Euro</th>
                  <th className={thClass}>Pauschalbetrag in Euro</th>
                  <th className={thClass}>Davon Fahrt-/Nebenkosten in Euro</th>
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
              {[
                { value: `${ort}, ${todayLabel}`, label: "Ort / Datum" },
                { value: "", label: "Unterschrift 1. Vorsitzender" },
                { value: "", label: "Unterschrift Schatzmeister" },
              ].map((field) => (
                <div key={field.label} className="flex flex-col">
                  {/* Feste Höhe für den handschriftlichen Bereich, damit die
                      Unterschriftslinie in allen drei Spalten auf gleicher
                      Höhe sitzt (die Datums-Spalte hat vorgedruckten Text). */}
                  <span className="flex h-10 items-end">{field.value}</span>
                  <span className="border-t border-slate-400 pt-1 text-xs text-slate-500">{field.label}</span>
                </div>
              ))}
            </div>

            {/* --- Stundennachweis des Übungsleiters --- */}
            <h1 className="mb-3 text-lg font-bold break-before-page">Stundennachweis des Übungsleiters</h1>
            <p className="mb-3 text-sm">Für diese Sportart wurden Übungsstunden erteilt: {sport}</p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 print:grid-cols-3">
              {report.months.map((m) => (
                <div key={m.month}>
                  <h3 className="mb-1 text-sm font-semibold uppercase">Monat {m.monthName}</h3>
                  <table className="w-full table-fixed border-collapse text-xs">
                    <colgroup>
                      <col className="w-[15%]" />
                      <col className="w-[30%]" />
                      <col className="w-[15%]" />
                      <col className="w-[40%]" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={thClassSm}>Dat.</th>
                        <th className={thClassSm}>Uhrzeit von-bis</th>
                        <th className={thClassSm}>Zahl d. Std.</th>
                        <th className={thClassSm}>Einsatzort</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.sessions.map((s) => (
                        <tr key={s.date}>
                          <td className="border border-slate-400 px-1 py-1 text-center font-medium">{s.day}</td>
                          <td className="border border-slate-400 px-1 py-1 text-center">
                            {s.startTime && s.endTime ? `${s.startTime}-${s.endTime}` : ""}
                          </td>
                          <td className="border border-slate-400 px-1 py-1 text-center">{s.hours ?? ""}</td>
                          <td className="border border-slate-400 px-1 py-1 break-words">{s.location}</td>
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
