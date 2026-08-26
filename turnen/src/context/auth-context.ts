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
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => void;
  refreshClub: () => Promise<void>;
  // Nach einer Profiländerung (PUT /api/me) übernimmt das ein frisches JWT -
  // das alte Token trägt Name/E-Mail noch fest im Payload.
  applyProfileToken: (token: string) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
