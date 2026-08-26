import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Club, ClubRole } from "../../lib/types";
import { useAuth } from "../../context/useAuth";

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole;
  isAdmin: number;
  lastLoginAt: string | null;
}

function toIsoUtc(sqliteDate: string): string {
  return sqliteDate.includes("T") ? sqliteDate : `${sqliteDate.replace(" ", "T")}Z`;
}

function formatLastLogin(iso: string | null): string {
  if (!iso) return "nie";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(toIsoUtc(iso)));
}

// Vereinsübergreifende Nutzerverwaltung - nur für die Admin-Rolle. Rollen-
// und Vereinswechsel sowie Passwort-Reset wirken sofort auf den jeweiligen
// Account, unabhängig von dessen eigenem Verein.
export default function AdminUsers() {
  const { userId, isAdmin } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([api.get<AdminUser[]>("/api/admin/users"), api.get<Club[]>("/api/admin/clubs")]);
      setUsers(u);
      setClubs(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        Diese Seite ist nur für die vereinsübergreifende Admin-Rolle sichtbar.
      </div>
    );
  }

  async function handleClubChange(u: AdminUser, clubId: string) {
    setError(null);
    setInfo(null);
    setBusyId(u.id);
    try {
      await api.put(`/api/admin/users/${u.id}`, { clubId: clubId || null });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ändern");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRoleChange(u: AdminUser, clubRole: ClubRole) {
    setError(null);
    setInfo(null);
    setBusyId(u.id);
    try {
      await api.put(`/api/admin/users/${u.id}`, { clubRole });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ändern");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleAdmin(u: AdminUser) {
    setError(null);
    setInfo(null);
    setBusyId(u.id);
    try {
      await api.put(`/api/admin/users/${u.id}`, { isAdmin: !u.isAdmin });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ändern");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetPassword(u: AdminUser) {
    const newPassword = window.prompt(`Neues Passwort für ${u.email} (mind. 8 Zeichen):`);
    if (!newPassword) return;
    setError(null);
    setInfo(null);
    setBusyId(u.id);
    try {
      await api.put(`/api/admin/users/${u.id}/password`, { newPassword });
      setInfo(`Passwort für ${u.email} geändert.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Zurücksetzen");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(u: AdminUser) {
    if (!confirm(`Account „${u.email}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;
    setError(null);
    setInfo(null);
    setBusyId(u.id);
    try {
      await api.del(`/api/admin/users/${u.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Löschen");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Admin – Nutzer*innen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alle Accounts vereinsübergreifend: Verein, Rolle und Admin-Status ändern, Passwort zurücksetzen oder
          Account löschen.
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}
      {info && <p className="text-sm text-emerald-700 dark:text-emerald-400">{info}</p>}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Lädt…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">E-Mail</th>
                <th className="px-4 py-2 font-medium">Verein</th>
                <th className="px-4 py-2 font-medium">Rolle</th>
                <th className="px-4 py-2 text-center font-medium">Admin</th>
                <th className="px-4 py-2 font-medium">Zuletzt angemeldet</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                    {u.name ?? "–"}
                    {u.id === userId && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        du
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      value={u.clubId ?? ""}
                      onChange={(e) => handleClubChange(u, e.target.value)}
                      disabled={busyId === u.id}
                      className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="">– kein Verein –</option>
                      {clubs.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={u.clubRole}
                      onChange={(e) => handleRoleChange(u, e.target.value as ClubRole)}
                      disabled={busyId === u.id || !u.clubId}
                      className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      <option value="member">Turnleiter*in</option>
                      <option value="jugendleiter">Jugendleitung</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={Boolean(u.isAdmin)}
                      onChange={() => handleToggleAdmin(u)}
                      disabled={busyId === u.id}
                      className="h-4 w-4 cursor-pointer accent-emerald-600"
                    />
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{formatLastLogin(u.lastLoginAt)}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        onClick={() => handleResetPassword(u)}
                        disabled={busyId === u.id}
                        className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900"
                      >
                        Passwort setzen
                      </button>
                      {u.id !== userId && (
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={busyId === u.id}
                          className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/50 dark:text-red-300 dark:hover:bg-red-900"
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
