import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./useAuth";
import { api, IS_NATIVE } from "../lib/api";

const LOCK_AFTER_MS = 5 * 60 * 1000; // 5:00 (300s)
const WARNING_AFTER_MS = 4 * 60 * 1000; // 4:00 (240s)
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;
const SERVER_PING_THROTTLE_MS = 45 * 1000;

interface IdleTimerContextValue {
  remainingSeconds: number;
  formattedTime: string;
  isWarning: boolean;
  isLocked: boolean;
  resetTimer: () => void;
}

const IdleTimerContext = createContext<IdleTimerContextValue | null>(null);

export function IdleTimerProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, signOut } = useAuth();
  const [remainingSeconds, setRemainingSeconds] = useState(300);
  const [locked, setLocked] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lastServerPingRef = useRef(0);

  useEffect(() => {
    // Native App: kein client-seitiger 5-Minuten-Idle-Lock. Die App-Sitzung hat
    // serverseitig einen 30-Tage-Idle-Timeout (Bearer-Token im Secure-Storage),
    // ein Auto-Logout beim Weglegen des Handys wäre feindselige UX.
    if (!isAuthenticated || IS_NATIVE) return;

    function resetActivity() {
      const now = Date.now();
      lastActivityRef.current = now;
      setRemainingSeconds(300);

      if (now - lastServerPingRef.current >= SERVER_PING_THROTTLE_MS) {
        lastServerPingRef.current = now;
        api.post("/api/session/activity", {}).catch(() => {});
      }
    }

    function onActivity() {
      resetActivity();
    }

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity, { passive: true });
    }

    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const remaining = Math.max(0, Math.ceil((LOCK_AFTER_MS - idleMs) / 1000));
      setRemainingSeconds(remaining);

      if (idleMs >= LOCK_AFTER_MS) {
        setLocked(true);
      }
    }, 1000);

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity);
      }
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (locked) {
      signOut();
    }
  }, [locked, signOut]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  const isWarning = remainingSeconds <= (LOCK_AFTER_MS - WARNING_AFTER_MS) / 1000 && remainingSeconds > 0;

  const value: IdleTimerContextValue = {
    remainingSeconds,
    formattedTime,
    isWarning,
    isLocked: locked,
    resetTimer() {
      lastActivityRef.current = Date.now();
      setRemainingSeconds(300);
    },
  };

  return <IdleTimerContext.Provider value={value}>{children}</IdleTimerContext.Provider>;
}

export function useIdleTimer() {
  const ctx = useContext(IdleTimerContext);
  if (!ctx) {
    return {
      remainingSeconds: 300,
      formattedTime: "5:00",
      isWarning: false,
      isLocked: false,
      resetTimer: () => {},
    };
  }
  return ctx;
}
