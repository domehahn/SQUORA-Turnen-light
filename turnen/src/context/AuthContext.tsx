import { useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeJwt } from "jose";
import { api, clearToken, getToken, setToken } from "../lib/api";
import { AuthContext, type AuthState } from "./auth-context";
import type { ClubRole } from "../lib/types";

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
}

const EMPTY_STATE: AuthState = {
  isAuthenticated: false,
  userId: null,
  userEmail: null,
  userName: null,
  clubId: null,
  clubName: null,
  clubRole: null,
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
        prev.isAuthenticated ? { ...prev, clubId: me.clubId, clubName: me.clubName, clubRole: me.clubRole } : prev
      );
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
          const res = await api.post<{ token: string }>("/api/login", { email, password });
          setToken(res.token);
          setState(readState(res.token));
          return {};
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Anmeldung fehlgeschlagen" };
        }
      },
      signOut() {
        clearToken();
        setState(readState(null));
      },
      refreshClub: loadClub,
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
