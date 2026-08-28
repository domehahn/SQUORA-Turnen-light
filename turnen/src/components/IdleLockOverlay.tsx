import { useAuth } from "../context/useAuth";
import { useIdleTimer } from "../context/IdleTimerContext";

// Client-seitiges Idle-Lock (externe Production-Readiness-Prüfung
// 2026-08-27, P0 "SESSION INACTIVITY MUSS WIRKLICH FUNKTIONIEREN",
// "CLIENT IDLE LOCK") - der Server bleibt die alleinige Security Authority
// (5-Minuten-Idle-Timeout in requireAuth, worker/src/index.ts, unbeeindruckt
// von Hintergrund-Polling, s. isIdleExempt()). dieses Overlay ist zusätzlich
// ein UX-/Privacy-Screen-Lock: wer den Browser offen und unbeaufsichtigt
// stehen lässt, soll nicht einfach weiter personenbezogene Daten (Namen,
// Notfallkontakte, ...) im UI sichtbar haben, selbst bevor der Server die
// Sitzung tatsächlich beendet.
export function IdleLockOverlay() {
  const { isAuthenticated } = useAuth();
  const { remainingSeconds, isWarning, isLocked } = useIdleTimer();

  if (!isAuthenticated) return null;

  if (isLocked) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 p-4">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-slate-700 bg-slate-800 p-6 text-center shadow-lg">
          <h2 className="text-lg font-semibold text-white">Sitzung gesperrt</h2>
          <p className="text-sm text-slate-300">Du warst länger inaktiv. Bitte melde dich erneut an.</p>
        </div>
      </div>
    );
  }

  if (isWarning) {
    return (
      <div
        role="alert"
        className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-md animate-pulse"
      >
        Sitzung endet wegen Inaktivität in {remainingSeconds} Sekunde{remainingSeconds === 1 ? "" : "n"}. Jede Interaktion setzt den Timer zurück.
      </div>
    );
  }

  return null;
}
