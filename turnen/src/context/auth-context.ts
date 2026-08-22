import { createContext } from "react";

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  clubId: string | null;
  clubName: string | null;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => void;
  refreshClub: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
