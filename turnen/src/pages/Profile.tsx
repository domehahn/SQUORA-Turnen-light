import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";
import { QrCode } from "../components/QrCode";
import { MIN_PASSWORD_LENGTH, PASSWORD_POLICY_HINT } from "../lib/passwordPolicy";

export default function Profile() {
  const { userName, userEmail, clubName, clubRole, isAdmin, refreshClub } = useAuth();

  const [activeSessions, setActiveSessions] = useState<number | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionsInfo, setSessionsInfo] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const preferenceLabels = {
    requests: "Anfragen und Gruppenwechsel",
    substitutes: "Vertretungen",
    waitlist: "Warteliste und Platzvorschläge",
    membership: "Verein und Mitgliedschaft",
    attendance: "Termine und Anwesenheit",
    system: "Sonstige App-Hinweise",
  };
  type PreferenceKey = keyof typeof preferenceLabels;
  const [preferences, setPreferences] = useState<Record<PreferenceKey, boolean> | null>(null);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [preferenceInfo, setPreferenceInfo] = useState<string | null>(null);
  const [calendarActive, setCalendarActive] = useState(false);
  const [calendarUrl, setCalendarUrl] = useState<string | null>(null);
  const [calendarBusy, setCalendarBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Record<PreferenceKey, boolean>>("/api/me/notification-preferences"),
      api.get<{ active: boolean }>("/api/me/calendar"),
    ]).then(([prefs, calendar]) => {
      setPreferences(prefs);
      setCalendarActive(calendar.active);
    }).catch(() => undefined);
  }, []);

  async function savePreferences() {
    if (!preferences) return;
    setPreferenceBusy(true);
    setPreferenceInfo(null);
    try {
      setPreferences(await api.put<Record<PreferenceKey, boolean>>("/api/me/notification-preferences", preferences));
      setPreferenceInfo("E-Mail-Einstellungen gespeichert.");
    } finally {
      setPreferenceBusy(false);
    }
  }

  async function createCalendarSubscription() {
    setCalendarBusy(true);
    try {
      const result = await api.post<{ url: string }>("/api/me/calendar", {});
      setCalendarActive(true);
      setCalendarUrl(result.url);
    } finally {
      setCalendarBusy(false);
    }
  }

  async function revokeCalendarSubscription() {
    setCalendarBusy(true);
    try {
      await api.del("/api/me/calendar");
      setCalendarActive(false);
      setCalendarUrl(null);
    } finally {
      setCalendarBusy(false);
    }
  }

  useEffect(() => {
    api
      .get<{ id: string; current: boolean }[]>("/api/me/sessions")
      .then((sessions) => setActiveSessions(sessions.length))
      .catch(() => setActiveSessions(null));
  }, []);

  async function handleRevokeOtherSessions() {
    setSessionsError(null);
    setSessionsInfo(null);
    setSessionsBusy(true);
    try {
      await api.post("/api/me/sessions/revoke-all", {});
      setSessionsInfo("Alle anderen Sitzungen wurden abgemeldet.");
      setActiveSessions(1);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : "Fehler beim Abmelden anderer Geräte");
    } finally {
      setSessionsBusy(false);
    }
  }

  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[] | null>(null);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");
  // Re-Authentifizierung vor Einrichtung/Rotation (Härtung, externe
  // Production-Readiness-Prüfung 2026-08-27) - ein einzelner authentifizierter
  // Aufruf darf keine bestehende MFA mehr anfassen können, daher immer
  // Passwort nötig, bei bereits aktiver MFA zusätzlich der aktuelle Code.
  const [mfaStartForm, setMfaStartForm] = useState(false);
  const [mfaStartPassword, setMfaStartPassword] = useState("");
  const [mfaStartCurrentCode, setMfaStartCurrentCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/me/mfa")
      .then((r) => setMfaEnabled(r.enabled))
      .catch(() => setMfaEnabled(false));
  }, []);

  async function handleMfaStart(e: FormEvent) {
    e.preventDefault();
    setMfaError(null);
    setMfaBusy(true);
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>("/api/me/mfa/setup", {
        password: mfaStartPassword,
        currentCode: mfaEnabled ? mfaStartCurrentCode : undefined,
      });
      setMfaSetup(res);
      setMfaStartForm(false);
      setMfaStartPassword("");
      setMfaStartCurrentCode("");
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
  const [profileCurrentPassword, setProfileCurrentPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileInfo, setProfileInfo] = useState<string | null>(null);
  const emailChanged = email.trim() !== (userEmail ?? "");

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
      await api.put("/api/me", {
        name: name.trim() || null,
        email: email.trim(),
        // Step-up-Authentifizierung (Production-Readiness-Prüfung
        // 2026-08-27): nur nötig, wenn sich die E-Mail-Adresse tatsächlich
        // ändert - sie ist zugleich der Login-Name.
        ...(emailChanged ? { currentPassword: profileCurrentPassword } : {}),
      });
      setProfileCurrentPassword("");
      await refreshClub();
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
        {emailChanged && (
          <div className="max-w-xs">
            <FloatingInput
              label="Aktuelles Passwort (zur Bestätigung der E-Mail-Änderung)"
              type="password"
              required
              value={profileCurrentPassword}
              onChange={(e) => setProfileCurrentPassword(e.target.value)}
            />
          </div>
        )}
        {profileError && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {profileError}</p>}
        {profileInfo && <p className="text-sm text-emerald-700 dark:text-emerald-400">{profileInfo}</p>}
        <button
          type="submit"
          disabled={profileBusy || !email.trim() || (emailChanged && !profileCurrentPassword)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          Speichern
        </button>
      </form>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Benachrichtigungen</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          In-App-Nachrichten bleiben immer aktiv. Hier legst du fest, welche Kategorien zusätzlich per E-Mail kommen.
          Sicherheitsmails wie Passwort-Reset sind davon nicht betroffen.
        </p>
        {preferences && Object.entries(preferenceLabels).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={preferences[key as PreferenceKey]}
              onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
        {preferenceInfo && <p className="text-sm text-emerald-700 dark:text-emerald-400">{preferenceInfo}</p>}
        <button type="button" onClick={savePreferences} disabled={!preferences || preferenceBusy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          E-Mail-Einstellungen speichern
        </button>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Kalender-Abonnement</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Abonniere eigene und mitgeleitete Trainings sowie übernommene Vertretungen in Apple Kalender, Google Calendar oder Outlook. Der geheime Link enthält keine Kinderdaten.
        </p>
        {calendarUrl && (
          <div className="space-y-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
            <p className="text-xs text-amber-800 dark:text-amber-300">Diesen Link jetzt kopieren – er wird aus Sicherheitsgründen nur einmal angezeigt.</p>
            <input readOnly value={calendarUrl} className="w-full rounded border border-amber-300 bg-white p-2 text-xs dark:bg-slate-900" />
            <button type="button" onClick={() => navigator.clipboard.writeText(calendarUrl)} className="rounded-md border border-amber-400 px-3 py-1.5 text-xs">Link kopieren</button>
          </div>
        )}
        <p className={`text-sm ${calendarActive ? "text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`}>
          {calendarActive ? "Abonnement aktiv." : "Noch kein Abonnement aktiv."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={createCalendarSubscription} disabled={calendarBusy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {calendarActive ? "Neuen Link erzeugen" : "Abonnement erstellen"}
          </button>
          {calendarActive && <button type="button" onClick={revokeCalendarSubscription} disabled={calendarBusy} className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:text-red-400">Widerrufen</button>}
        </div>
      </div>

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
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <FloatingInput
              label="Neues Passwort wiederholen"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={newPasswordRepeat}
              onChange={(e) => setNewPasswordRepeat(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">{PASSWORD_POLICY_HINT}</p>
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

        {mfaEnabled === null ? null : mfaEnabled && !mfaBackupCodes && !mfaSetup ? (
          <div className="space-y-4">
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

            {/* Rotation: neues Gerät/Authenticator einrichten, ohne MFA
                zwischenzeitlich zu deaktivieren - alter Faktor bleibt bis zur
                Bestätigung des neuen vollständig aktiv (s. Kommentar in
                worker/src/index.ts, POST /api/me/mfa/setup). */}
            {mfaStartForm ? (
              <form onSubmit={handleMfaStart} className="max-w-xs space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Neu einrichten (z.B. neues Gerät) - aktuelles Passwort und aktueller Code bestätigen:
                </p>
                <FloatingInput
                  label="Aktuelles Passwort"
                  type="password"
                  required
                  autoFocus
                  value={mfaStartPassword}
                  onChange={(e) => setMfaStartPassword(e.target.value)}
                />
                <FloatingInput
                  label="Aktueller Code oder Backup-Code"
                  type="text"
                  required
                  value={mfaStartCurrentCode}
                  onChange={(e) => setMfaStartCurrentCode(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={mfaBusy}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                  >
                    Weiter
                  </button>
                  <button
                    type="button"
                    onClick={() => setMfaStartForm(false)}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Abbrechen
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setMfaStartForm(true)}
                className="text-sm text-slate-500 hover:underline dark:text-slate-400"
              >
                Neu einrichten (neues Gerät)
              </button>
            )}
          </div>
        ) : !mfaEnabled && !mfaSetup && !mfaBackupCodes ? (
          mfaStartForm ? (
            <form onSubmit={handleMfaStart} className="max-w-xs space-y-2">
              <FloatingInput
                label="Aktuelles Passwort zur Bestätigung"
                type="password"
                required
                autoFocus
                value={mfaStartPassword}
                onChange={(e) => setMfaStartPassword(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={mfaBusy}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  Weiter
                </button>
                <button
                  type="button"
                  onClick={() => setMfaStartForm(false)}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Abbrechen
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setMfaStartForm(true)}
              disabled={mfaBusy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Einrichten
            </button>
          )
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

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sitzungen</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Aus Sicherheitsgründen wird eine Sitzung nach 5 Minuten Inaktivität automatisch beendet, spätestens nach 8
          Stunden in jedem Fall.
          {activeSessions !== null && (
            <>
              {" "}
              Aktuell {activeSessions} aktive {activeSessions === 1 ? "Sitzung" : "Sitzungen"}.
            </>
          )}
        </p>
        {sessionsError && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {sessionsError}</p>}
        {sessionsInfo && <p className="text-sm text-emerald-700 dark:text-emerald-400">{sessionsInfo}</p>}
        <button
          type="button"
          onClick={handleRevokeOtherSessions}
          disabled={sessionsBusy}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Alle anderen Geräte abmelden
        </button>
      </div>
    </div>
  );
}
