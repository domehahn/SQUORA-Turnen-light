import { useIdleTimer } from "../context/IdleTimerContext";

export function SessionTimerBadge() {
  const { formattedTime, isWarning } = useIdleTimer();

  return (
    <div
      title={`Sitzungs-Countdown: ${formattedTime} Min. verbleibend (Wird bei jeder Interaktion zurückgesetzt)`}
      aria-label={`Verbleibende Sitzungszeit: ${formattedTime} Minuten`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-mono font-medium transition-colors ${
        isWarning
          ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse"
          : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
      }`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 opacity-70">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .2.08.39.22.53l3 3a.75.75 0 0 0 1.06-1.06l-2.78-2.78V5Z"
          clipRule="evenodd"
        />
      </svg>
      <span>{formattedTime}</span>
    </div>
  );
}
