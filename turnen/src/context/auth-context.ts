import { createContext } from "react";

export interface AuthState {
  isAuthenticated: boolean;
  userEmail: string | null;
  userName: string | null;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
