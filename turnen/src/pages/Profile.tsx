import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";
import { QrCode } from "../components/QrCode";

export default function Profile() {
  const { userName, userEmail, clubName, clubRole, isAdmin, applyProfileToken } = useAuth();

  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[] | null>(null);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/me/mfa")
      .then((r) => setMfaEnabled(r.enabled))
      .catch(() => setMfaEnabled(false));
  }, []);

  async function handleMfaStart() {
    setMfaError(null);
    setMfaBusy(true);
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>("/api/me/mfa/setup", {});
      setMfaSetup(res);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : "Fehler beim Starten der Einrichtung");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleMfaConfirm(e: FormEvent) {
    e.preventDefault();
    setMfaError(null);
    setMfaBusy(true);
    try {
      const res = await api.post<{ backupCodes: string[] }>("/api/me/mfa/confirm", { code: mfaCode });
      setMfaBackupCodes(res.backupCodes);
      setMfaSetup(null);
      setMfaCode("");
      setMfaEnabled(true);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : "Code ungültig");
    } finally {
      setMfaBusy(false);
    }
  }

  async function handleMfaDisable(e: FormEvent) {
    e.preventDefault();
    setMfaError(null);
    setMfaBusy(true);
    try {
      await api.post("/api/me/mfa/disable", { password: mfaDisablePassword });
      setMfaEnabled(false);
      setMfaDisablePassword("");
      setMfaBackupCodes(null);
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : "Fehler beim Deaktivieren");
    } finally {
      setMfaBusy(false);
    }
  }

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
          {isAdmin && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
              Admin
            </span>
          )}
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

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Zwei-Faktor-Authentifizierung</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Schützt deinen Account zusätzlich mit einem Code aus einer Authenticator-App (z.B. Google Authenticator, Authy),
          selbst wenn dein Passwort kompromittiert wird.
          {(isAdmin || clubRole === "jugendleiter") && (
            <> Für deine Rolle mit vereinsweitem Zugriff empfohlen.</>
          )}
        </p>

        {mfaError && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {mfaError}</p>}

        {mfaBackupCodes && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">
              Zwei-Faktor-Authentifizierung aktiviert. Backup-Codes (jeweils einmal verwendbar, falls du dein Gerät
              verlierst) — jetzt notieren, sie werden nicht erneut angezeigt:
            </p>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs text-amber-900 dark:text-amber-200">
              {mfaBackupCodes.map((code) => (
                <span key={code}>{code}</span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMfaBackupCodes(null)}
              className="mt-3 rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900"
            >
              Notiert, ausblenden
            </button>
          </div>
        )}

        {mfaEnabled === null ? null : mfaEnabled && !mfaBackupCodes ? (
          <form onSubmit={handleMfaDisable} className="space-y-2">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Aktiv.</p>
            <div className="max-w-xs">
              <FloatingInput
                label="Passwort zur Bestätigung"
                type="password"
                required
                value={mfaDisablePassword}
                onChange={(e) => setMfaDisablePassword(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={mfaBusy}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Deaktivieren
            </button>
          </form>
        ) : !mfaSetup && !mfaBackupCodes ? (
          <button
            type="button"
            onClick={handleMfaStart}
            disabled={mfaBusy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            Einrichten
          </button>
        ) : mfaSetup ? (
          <form onSubmit={handleMfaConfirm} className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">Mit der Authenticator-App scannen:</p>
            <QrCode value={mfaSetup.otpauthUri} />
            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
              Kein Scanner zur Hand? Schlüssel manuell eingeben:
            </p>
            <p className="break-all rounded-md bg-slate-100 p-2 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {mfaSetup.secret}
            </p>
            <div className="max-w-xs">
              <FloatingInput
                label="6-stelliger Code zur Bestätigung"
                type="text"
                required
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={mfaBusy}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                Bestätigen
              </button>
              <button
                type="button"
                onClick={() => setMfaSetup(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
