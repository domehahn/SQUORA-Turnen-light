import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/useAuth";

export function RequireAuth() {
  const { isAuthenticated, authChecked } = useAuth();
  // Session-Management-Härtung: der Auth-Status kommt erst nach einem
  // GET /api/me zurück (HttpOnly-Cookie, nicht mehr synchron aus einem
  // localStorage-JWT lesbar) - bis dahin weder zu /login umleiten noch die
  // geschützte Seite zeigen.
  if (!authChecked) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
