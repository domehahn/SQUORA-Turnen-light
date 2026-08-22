import { useEffect, useMemo, useState, type ReactNode } from "react";
import { decodeJwt } from "jose";
import { api, clearToken, getToken, setToken } from "../lib/api";
import { AuthContext, type AuthState } from "./auth-context";

interface TokenPayload {
  sub: string;
  email: string;
  name: string | null;
  exp?: number;
}

function readState(token: string | null): AuthState {
  const empty: AuthState = { isAuthenticated: false, userEmail: null, userName: null };
  if (!token) return empty;
  try {
    const payload = decodeJwt(token) as TokenPayload;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return empty;
    return { isAuthenticated: true, userEmail: payload.email, userName: payload.name };
  } catch {
    return empty;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => readState(getToken()));

  useEffect(() => {
    function onStorage() {
      setState(readState(getToken()));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
