import { useEffect, useMemo, useState } from "react";
import { api, apiPath, ApiError } from "../../lib/api";
import type { HoursReportSubmission } from "../../lib/types";
import { useAuth } from "../../context/useAuth";
import { FloatingInput } from "../../components/FloatingField";

function formatEuroCents(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function periodLabel(s: Pick<HoursReportSubmission, "quarter" | "year">): string {
  return s.quarter === 0 ? `Jahr ${s.year}` : `Q${s.quarter} ${s.year}`;
}

export default function HoursSubmissionsPage() {
  const { clubRole, isKassenwart, userId } = useAuth();
  const isJugendleiter = clubRole === "jugendleiter";

  const [rows, setRows] = useState<HoursReportSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [settleFor, setSettleFor] = useState<HoursReportSubmission | null>(null);
  const [amountEuro, setAmountEuro] = useState("");
  const [rateEuro, setRateEuro] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.get<HoursReportSubmission[]>("/api/hours-report/submissions"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const openSettleCount = useMemo(() => rows.filter((r) => r.status === "submitted").length, [rows]);

  function beginSettle(row: HoursReportSubmission) {
    setSettleFor(row);
    setAmountEuro(
      row.totalHours && rateEuro ? String((row.totalHours * Number(rateEuro.replace(",", "."))).toFixed(2)) : ""
    );
    setNote("");
  }

  async function confirmSettle() {
    if (!settleFor) return;
    setBusyId(settleFor.id);
    setError(null);
    try {
      await api.post(`/api/hours-report/submissions/${settleFor.id}/settle`, {
        amountEuro: amountEuro || null,
        rateEuro: rateEuro || null,
        note: note || null,
      });
      setSettleFor(null);
      setAmountEuro("");
      setRateEuro("");
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Abrechnen fehlgeschlagen");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Eingereichte Stundennachweise</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        {isKassenwart
          ? "Alle eingereichten Nachweise des Vereins – ansehen und abrechnen."
          : "Alle eingereichten Nachweise des Vereins – nur lesend. Deine eigenen bearbeitest du über die Nachweis-Seite."}
        {openSettleCount > 0 && ` · ${openSettleCount} offen`}
      </p>

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Lädt…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Noch keine Stundennachweise eingereicht.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Zeitraum</th>
                <th className="px-3 py-2 text-right">Std.</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Eingereicht</th>
                <th className="px-3 py-2">Abrechnung</th>
                <th className="px-3 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.id} className="text-slate-700 dark:text-slate-300">
                  <td className="px-3 py-2">{r.userName ?? r.userEmail}</td>
                  <td className="px-3 py-2">{periodLabel(r)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.totalHours}</td>
                  <td className="px-3 py-2">
                    {r.status === "settled" ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                        abgerechnet
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                        eingereicht
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {new Date(r.updatedAt).toLocaleDateString("de-DE")}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {r.status === "settled"
                      ? `${formatEuroCents(r.settledAmountCents)}${
                          r.settledRateCents != null ? ` (${formatEuroCents(r.settledRateCents)}/h)` : ""
                        }${r.settledNote ? ` · ${r.settledNote}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-3">
                      <a
                        className="text-xs text-blue-700 underline dark:text-blue-400"
                        href={apiPath(`/api/hours-report/submissions/${r.id}/pdf`)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PDF
                      </a>
                      {isJugendleiter && r.userId === userId && (
                        <a
                          className="text-xs text-blue-700 underline dark:text-blue-400"
                          href={apiPath(`/nachweis?year=${r.year}&quarter=${r.quarter}`)}
                        >
                          Bearbeiten
                        </a>
                      )}
                      {isKassenwart && r.status === "submitted" && (
                        <button
                          onClick={() => beginSettle(r)}
                          disabled={busyId === r.id}
                          className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-400"
                        >
                          Abrechnen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {settleFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSettleFor(null)}>
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">
              Abrechnen: {settleFor.userName ?? settleFor.userEmail}
            </h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              {periodLabel(settleFor)} · {settleFor.totalHours} Std.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FloatingInput
                label="Stundensatz (€)"
                inputMode="decimal"
                value={rateEuro}
                onChange={(e) => {
                  setRateEuro(e.target.value);
                  const rate = Number(e.target.value.replace(",", "."));
                  if (Number.isFinite(rate) && rate > 0) setAmountEuro((settleFor.totalHours * rate).toFixed(2));
                }}
              />
              <FloatingInput
                label="Betrag (€)"
                inputMode="decimal"
                value={amountEuro}
                onChange={(e) => setAmountEuro(e.target.value)}
              />
            </div>
            <div className="mt-3">
              <FloatingInput
                label="Notiz / Verwendungszweck"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="z.B. überwiesen am …, Buchungsnr."
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSettleFor(null)}
                className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmSettle}
                disabled={busyId === settleFor.id}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Als abgerechnet markieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
