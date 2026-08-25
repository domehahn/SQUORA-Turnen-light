import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";

export default function Profile() {
  const { userName, userEmail, clubName, clubRole, applyProfileToken } = useAuth();

  const [name, setName] = useState(userName ?? "");
  const [email, setEmail] = useState(userEmail ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileInfo, setProfileInfo] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordRepeat, setNewPasswordRepeat] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordInfo, setPasswordInfo] = useState<string | null>(null);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileInfo(null);
    setProfileBusy(true);
    try {
      const result = await api.put<{ token: string }>("/api/me", { name: name.trim() || null, email: email.trim() });
      applyProfileToken(result.token);
      setProfileInfo("Profil aktualisiert.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setProfileBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordInfo(null);
    if (newPassword !== newPasswordRepeat) {
      setPasswordError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setPasswordBusy(true);
    try {
      await api.put("/api/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordRepeat("");
      setPasswordInfo("Passwort geändert.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Fehler beim Ändern des Passworts");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Profil</h2>
          {clubRole && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                clubRole === "jugendleiter"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {clubRole === "jugendleiter" ? "Jugendleitung" : "Turnleiter*in"}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Name, E-Mail-Adresse und Passwort deines Accounts.
          {clubName && <> Verein: {clubName}.</>}
        </p>
      </div>

      <form
        onSubmit={handleSaveProfile}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Persönliche Daten</h3>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px] flex-1">
            <FloatingInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="min-w-[200px] flex-1">
            <FloatingInput label="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        {profileError && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {profileError}</p>}
        {profileInfo && <p className="text-sm text-emerald-700 dark:text-emerald-400">{profileInfo}</p>}
        <button
          type="submit"
          disabled={profileBusy || !email.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Speichern
        </button>
      </form>

      <form
        onSubmit={handleChangePassword}
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Passwort ändern</h3>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px] flex-1">
            <FloatingInput
              label="Aktuelles Passwort"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px] flex-1">
            <FloatingInput
              label="Neues Passwort"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <FloatingInput
              label="Neues Passwort wiederholen"
              type="password"
              required
              minLength={8}
              value={newPasswordRepeat}
              onChange={(e) => setNewPasswordRepeat(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">Mindestens 8 Zeichen.</p>
        {passwordError && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {passwordError}</p>}
        {passwordInfo && <p className="text-sm text-emerald-700 dark:text-emerald-400">{passwordInfo}</p>}
        <button
          type="submit"
          disabled={passwordBusy || !currentPassword || newPassword.length < 8}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Passwort ändern
        </button>
      </form>
    </div>
  );
}
