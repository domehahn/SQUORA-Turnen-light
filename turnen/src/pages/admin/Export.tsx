import { useState } from "react";
import { apiPath, getToken } from "../../lib/api";
import { useAuth } from "../../context/useAuth";
import { FloatingInput, FloatingSelect } from "../../components/FloatingField";
import { appPath } from "../../lib/paths";

function firstOfMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// quarter = 0 steht für "Ganzes Jahr". Liefert Von/Bis als "YYYY-MM-DD" für
// die Schnellauswahl unten - Von/Bis bleiben trotzdem frei nachbearbeitbar.
function quarterBounds(year: number, quarter: number): { from: string; to: string } {
  if (quarter === 0) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = quarter * 3;
  const lastDay = new Date(year, endMonth, 0).getDate();
  return {
    from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    to: `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export default function Export() {
  const { clubRole, clubName } = useAuth();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [scope, setScope] = useState<"own" | "club">("own");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - 8 + i);
  const [quickYear, setQuickYear] = useState(currentYear);
  const [quickQuarter, setQuickQuarter] = useState(0); // 0 = Ganzes Jahr

  function applyQuarter(year: number, quarter: number) {
    const bounds = quarterBounds(year, quarter);
    setFrom(bounds.from);
    setTo(bounds.to);
  }

  async function handleExport() {
    setError(null);
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch(apiPath(`/api/export/hours?from=${from}&to=${to}&scope=${scope}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data as { error?: string } | null)?.error ?? `Fehler ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stunden_${from}_bis_${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Export");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Stunden-Export</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          CSV-Export der geleisteten Turnstunden im gewählten Zeitraum – Basis für Übungsleiterpauschale und
          Zuschussnachweise.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="w-28">
          <FloatingSelect
            label="Jahr"
            value={quickYear}
            onChange={(e) => {
              const year = Number(e.target.value);
              setQuickYear(year);
              applyQuarter(year, quickQuarter);
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <div className="w-40">
          <FloatingSelect
            label="Quartal"
            value={quickQuarter}
            onChange={(e) => {
              const quarter = Number(e.target.value);
              setQuickQuarter(quarter);
              applyQuarter(quickYear, quarter);
            }}
          >
            <option value={0}>Ganzes Jahr</option>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </FloatingSelect>
        </div>
        <span className="pb-2 text-xs text-slate-400 dark:text-slate-500">füllt Von/Bis aus, beide bleiben frei anpassbar</span>
        <div className="w-full" />
        <div className="w-44">
          <FloatingInput label="Von" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-44">
          <FloatingInput label="Bis" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {clubRole === "jugendleiter" && (
          <div className="w-56">
            <FloatingSelect label="Umfang" value={scope} onChange={(e) => setScope(e.target.value as "own" | "club")}>
              <option value="own">Nur meine Gruppen</option>
              <option value="club">Alle Gruppen von {clubName}</option>
            </FloatingSelect>
          </div>
        )}
        <button
          onClick={handleExport}
          disabled={busy || !from || !to}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {busy ? "Exportiert…" : "CSV herunterladen"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Enthält je erfasster Turnstunde: Datum, Wochentag, Gruppe, Uhrzeit, Dauer, wer geleitet hat und wie viele
        Kinder anwesend waren. Trainingszeiten und Übungsleiter*in werden auf der Seite „Gruppen" bzw. „Anwesenheit"
        hinterlegt.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Amtlicher Stundennachweis</h3>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Vorausgefüllte Vorlage im Format des Landessportbund-Formulars, für ein Quartal, zum Ausdrucken und
          Unterschreiben.
        </p>
        <a
          href={appPath("/nachweis")}
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Stundennachweis öffnen
        </a>
      </div>
    </div>
  );
}
