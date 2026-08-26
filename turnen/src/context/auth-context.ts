import { createContext } from "react";
import type { ClubRole } from "../lib/types";

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole | null;
  isAdmin: boolean;
  // Finding SEC-02 Folgearbeit: true für Admin/Jugendleitung ohne aktivierte
  // Zwei-Faktor-Authentifizierung - AppLayout zeigt dann ein blockierendes
  // Einrichtungs-Overlay.
  mfaSetupRequired: boolean;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string; mfaToken?: string }>;
  // Zweiter Schritt bei aktiviertem MFA (Finding SEC-02) - mfaToken kommt
  // aus signIn(), code ist der 6-stellige TOTP- oder ein Backup-Code.
  verifyMfa: (mfaToken: string, code: string) => Promise<{ error?: string }>;
  signOut: () => void;
  refreshClub: () => Promise<void>;
  // Nach einer Profiländerung (PUT /api/me) übernimmt das ein frisches JWT -
  // das alte Token trägt Name/E-Mail noch fest im Payload.
  applyProfileToken: (token: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
