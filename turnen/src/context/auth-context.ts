import { createContext } from "react";
import type { ClubRole } from "../lib/types";

export interface AuthState {
  isAuthenticated: boolean;
  // Session-Management-Härtung: true, sobald die erste GET-/api/me-Prüfung
  // beim App-Start durchgelaufen ist (egal ob erfolgreich oder nicht) - der
  // Auth-Status lässt sich nicht mehr synchron aus einem gespeicherten JWT
  // lesen (HttpOnly-Cookie statt localStorage).
  authChecked: boolean;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole | null;
  // Additives Flag neben clubRole: darf eingereichte Stundennachweise des
  // Vereins einsehen und abrechnen (kombinierbar mit jeder Rolle).
  isKassenwart: boolean;
  isAdmin: boolean;
  // true für Admin-Accounts (is_admin) ohne aktivierte Zwei-Faktor-
  // Authentifizierung (Nutzerentscheidung 2026-08-27, zweiter Durchgang:
  // MFA-Zwang nur für Platform-Admin, nicht Jugendleitung) - AppLayout zeigt
  // dann ein blockierendes Einrichtungs-Overlay.
  mfaSetupRequired: boolean;
  // true, solange ein von jemand anderem vergebenes initiales Passwort
  // (Admin-Nutzerverwaltung/scripts/create-admin.mjs) noch nicht durch ein
  // selbst gewähltes ersetzt wurde (Nutzeranfrage 2026-08-27) - hat Vorrang
  // vor mfaSetupRequired.
  passwordChangeRequired: boolean;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string; mfaToken?: string }>;
  // Zweiter Schritt bei aktiviertem MFA (Finding SEC-02) - mfaToken kommt
  // aus signIn(), code ist der 6-stellige TOTP- oder ein Backup-Code.
  verifyMfa: (mfaToken: string, code: string) => Promise<{ error?: string }>;
  // Widerruft die Sitzung serverseitig (POST /api/logout) und setzt den
  // lokalen Zustand zurück.
  signOut: () => Promise<void>;
  // Lädt Profil-/Vereinsstatus (Name, E-Mail, Verein, Rolle, MFA-Status)
  // neu - für den initialen Auth-Check und nach Profiländerungen (kein
  // Token-Umtausch mehr nötig, PUT /api/me gibt direkt den Nutzer zurück).
  refreshClub: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
