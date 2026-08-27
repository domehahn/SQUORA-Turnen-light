import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/useAuth";
import { api } from "../lib/api";

// Client-seitiges Idle-Lock (externe Production-Readiness-Prüfung
// 2026-08-27, P0 "SESSION INACTIVITY MUSS WIRKLICH FUNKTIONIEREN",
// "CLIENT IDLE LOCK") - der Server bleibt die alleinige Security Authority
// (5-Minuten-Idle-Timeout in requireAuth, worker/src/index.ts, unbeeindruckt
// von Hintergrund-Polling, s. isIdleExempt()). Dieses Overlay ist zusätzlich
// ein UX-/Privacy-Screen-Lock: wer den Browser offen und unbeaufsichtigt
// stehen lässt, soll nicht einfach weiter personenbezogene Daten (Namen,
// Notfallkontakte, ...) im UI sichtbar haben, selbst bevor der Server die
// Sitzung tatsächlich beendet.
//
// "Echte" Aktivität zählt nur über direkte Nutzerinteraktion - bewusst
// NICHT über Timer, Polling, Fetch-Antworten, React-Rendering oder reine
// Visibility-Events (Tab in den Hintergrund/Vordergrund holen ist keine
// Interaktion mit der App selbst).
//
// Server-/Client-Idle-Synchronisierung (zweiter Härtungsdurchgang
// 2026-08-27): echte Aktivität aktualisierte bisher NUR den lokalen Timer
// hier - der Server erfuhr davon nichts, solange keine ohnehin fällige
// API-Anfrage lief. Wer minutenlang ein Formular ausfüllte, ohne
// zwischenzeitlich zu speichern, wurde vom Client weiter als aktiv
// angezeigt, während die Sitzung serverseitig bereits als inaktiv galt -
// das nächste "Speichern" scheiterte dann mit 401, obwohl die Person die
// ganze Zeit über tatsächlich aktiv war. Echte Aktivität pingt jetzt
// zusätzlich (gedrosselt) POST /api/session/activity an, damit
// last_activity_at auf dem Server mitgeht.
const WARNING_AFTER_MS = 4 * 60 * 1000; // 4:00
const LOCK_AFTER_MS = 5 * 60 * 1000; // 5:00
const CHECK_INTERVAL_MS = 1000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;
// Client-Drosselung für den Server-Ping - bewusst innerhalb des in der
// Anfrage vorgegebenen 30-60s-Korridors, unabhängig vom serverseitigen
// ACTIVITY_UPDATE_THROTTLE_SECONDS (30s) gewählt: beide Seiten dürfen sich
// nicht blind aufeinander verlassen, aber auch nicht gegenseitig unnötig
// Anfragen/Schreiblast erzeugen.
const SERVER_PING_THROTTLE_MS = 45 * 1000;

export function IdleLockOverlay() {
  const { isAuthenticated, signOut } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lastServerPingRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) return;

    function onActivity() {
      const now = Date.now();
      lastActivityRef.current = now;
      setShowWarning(false);

      // Server nur nach echter Interaktion und nur gedrosselt informieren -
      // niemals aus einem Timer/Intervall heraus, niemals bei reinem
      // Hintergrund-Traffic.
      if (now - lastServerPingRef.current >= SERVER_PING_THROTTLE_MS) {
        lastServerPingRef.current = now;
        api.post("/api/session/activity", {}).catch(() => {
          // Best effort - ein einzelner fehlgeschlagener Ping darf die
          // UI nicht stören; der serverseitige Idle-Timeout bleibt so
          // oder so authoritativ und greift notfalls einfach früher.
        });
      }
    }
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= LOCK_AFTER_MS) {
        setLocked(true);
        setShowWarning(false);
      } else if (idleMs >= WARNING_AFTER_MS) {
        setShowWarning(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!locked) return;
    // UI sofort sperren: sensible Dialoge/Formulare schließen, Logout
    // anstoßen (widerruft die Sitzung serverseitig - "alle Geräte
    // abmelden"-Route wird hier absichtlich NICHT verwendet, ein normaler
    // Logout genügt und widerruft nur diese eine Sitzung).
    signOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (!isAuthenticated) return null;

  if (locked) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/95 p-4">
        <div className="w-full max-w-sm space-y-2 rounded-lg border border-slate-700 bg-slate-800 p-6 text-center shadow-lg">
          <h2 className="text-lg font-semibold text-white">Sitzung gesperrt</h2>
          <p className="text-sm text-slate-300">Du warst länger inaktiv. Bitte melde dich erneut an.</p>
        </div>
      </div>
    );
  }

  if (showWarning) {
    return (
      <div
        role="alert"
        className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-md"
      >
        Sitzung endet wegen Inaktivität in 60 Sekunden.
      </div>
    );
  }

  return null;
}
