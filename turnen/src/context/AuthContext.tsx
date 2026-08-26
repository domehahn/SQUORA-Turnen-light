import { useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeJwt } from "jose";
import { api, clearToken, getToken, setToken } from "../lib/api";
import { AuthContext, type AuthState } from "./auth-context";
import type { ClubRole } from "../lib/types";
import { loadCustomHolidays } from "../lib/holidays";

interface TokenPayload {
  sub: string;
  email: string;
  name: string | null;
  exp?: number;
}

interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole;
  isAdmin: boolean;
}

const EMPTY_STATE: AuthState = {
  isAuthenticated: false,
  userId: null,
  userEmail: null,
  userName: null,
  clubId: null,
  clubName: null,
  clubRole: null,
  isAdmin: false,
};

function readState(token: string | null): AuthState {
  if (!token) return EMPTY_STATE;
  try {
    const payload = decodeJwt(token) as TokenPayload;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return EMPTY_STATE;
    return {
      isAuthenticated: true,
      userId: payload.sub,
      userEmail: payload.email,
      userName: payload.name,
      clubId: null,
      clubName: null,
      clubRole: null,
      isAdmin: false,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => readState(getToken()));

  async function loadClub() {
    if (!getToken()) return;
    try {
      const me = await api.get<MeResponse>("/api/me");
      setState((prev) =>
        prev.isAuthenticated
          ? { ...prev, clubId: me.clubId, clubName: me.clubName, clubRole: me.clubRole, isAdmin: me.isAdmin }
          : prev
      );
      await loadCustomHolidays();
    } catch {
      // Netzwerk-/Auth-Fehler beim Nachladen ignorieren wir hier bewusst -
      // die Kernanmeldung basiert allein auf dem JWT im Local Storage.
    }
  }

  useEffect(() => {
    function onStorage() {
      setState(readState(getToken()));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (state.isAuthenticated) loadClub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isAuthenticated, state.userId]);

  const value = useMemo(
    () => ({
      ...state,
      async signIn(email: string, password: string) {
        try {
          const res = await api.post<{ token?: string; mfaRequired?: boolean; mfaToken?: string }>("/api/login", {
            email,
            password,
          });
          if (res.mfaRequired && res.mfaToken) return { mfaToken: res.mfaToken };
          if (!res.token) return { error: "Anmeldung fehlgeschlagen" };
          setToken(res.token);
          setState(readState(res.token));
          return {};
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Anmeldung fehlgeschlagen" };
        }
      },
      async verifyMfa(mfaToken: string, code: string) {
        try {
          const res = await api.post<{ token: string }>("/api/login/mfa", { mfaToken, code });
          setToken(res.token);
          setState(readState(res.token));
          return {};
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Code ungültig" };
        }
      },
      signOut() {
        clearToken();
        // Aufräumen eines evtl. noch vorhandenen alten "api-cache" (vor der
        // Entfernung des Workbox-runtimeCaching für /api/* konnten dort bis
        // zu 24h personenbezogene Daten liegen, s. vite.config.ts).
        if (typeof caches !== "undefined") {
          caches.delete("api-cache").catch(() => {});
        }
        setState(readState(null));
      },
      refreshClub: loadClub,
      applyProfileToken(token: string) {
        setToken(token);
        setState(readState(token));
      },
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
