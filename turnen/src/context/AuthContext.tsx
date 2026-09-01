import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { AuthContext, type AuthState } from "./auth-context";
import type { ClubRole } from "../lib/types";
import { loadCustomHolidays } from "../lib/holidays";

interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole;
  isSpringer: boolean;
  isKassenwart: boolean;
  isAdmin: boolean;
  mfaSetupRequired: boolean;
  passwordChangeRequired: boolean;
}

// Session-Management-Härtung (externe Production-Readiness-Prüfung
// 2026-08-27): die Sitzung lebt jetzt in einem HttpOnly-Cookie, das JS
// nicht lesen kann - der Auth-Status lässt sich also nicht mehr synchron
// aus einem gespeicherten JWT dekodieren, sondern nur noch per
// GET /api/me herausfinden. `authChecked` markiert, ob diese erste Prüfung
// beim Laden der App schon durchgelaufen ist - RequireAuth/Login warten
// darauf, statt vorschnell auf /login umzuleiten oder das Formular kurz
// aufblitzen zu lassen.
const EMPTY_STATE: AuthState = {
  isAuthenticated: false,
  authChecked: false,
  userId: null,
  userEmail: null,
  userName: null,
  clubId: null,
  clubName: null,
  clubRole: null,
  isSpringer: false,
  isKassenwart: false,
  isAdmin: false,
  mfaSetupRequired: false,
  passwordChangeRequired: false,
};

function stateFromMe(me: MeResponse): AuthState {
  return {
    isAuthenticated: true,
    authChecked: true,
    userId: me.id,
    userEmail: me.email,
    userName: me.name,
    clubId: me.clubId,
    clubName: me.clubName,
    clubRole: me.clubRole,
    isSpringer: me.isSpringer,
    isKassenwart: me.isKassenwart,
    isAdmin: me.isAdmin,
    mfaSetupRequired: me.mfaSetupRequired,
    passwordChangeRequired: me.passwordChangeRequired,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(EMPTY_STATE);

  // Lädt den vollständigen Profil-/Vereinsstatus neu (Name, E-Mail, Verein,
  // Rolle, MFA-Status) - beim App-Start für die erste Auth-Prüfung, danach
  // wiederverwendbar nach Profiländerungen (kein Token-Umtausch mehr nötig,
  // s. PUT /api/me).
  async function refresh() {
    try {
      const me = await api.get<MeResponse>("/api/me");
      setState(stateFromMe(me));
      await loadCustomHolidays();
    } catch {
      setState({ ...EMPTY_STATE, authChecked: true });
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      async signIn(email: string, password: string) {
        try {
          const res = await api.post<{ mfaRequired?: boolean; mfaToken?: string }>("/api/login", { email, password });
          if (res.mfaRequired && res.mfaToken) return { mfaToken: res.mfaToken };
          await refresh();
          return {};
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Anmeldung fehlgeschlagen" };
        }
      },
      async verifyMfa(mfaToken: string, code: string) {
        try {
          await api.post("/api/login/mfa", { mfaToken, code });
          await refresh();
          return {};
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Code ungültig" };
        }
      },
      async signOut() {
        try {
          await api.post("/api/logout", {});
        } catch {
          // Sitzung serverseitig widerrufen ist best effort - der lokale
          // Zustand wird unten in jedem Fall zurückgesetzt.
        }
        // Aufräumen eines evtl. noch vorhandenen alten "api-cache" (vor der
        // Entfernung des Workbox-runtimeCaching für /api/* konnten dort bis
        // zu 24h personenbezogene Daten liegen, s. vite.config.ts).
        if (typeof caches !== "undefined") {
          caches.delete("api-cache").catch(() => {});
        }
        setState({ ...EMPTY_STATE, authChecked: true });
      },
      refreshClub: refresh,
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
