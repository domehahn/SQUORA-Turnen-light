import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { FloatingInput } from "../components/FloatingField";
import { ThemeToggle } from "../components/ThemeToggle";
import SquoraBrand from "../components/SquoraBrand";
import { MIN_PASSWORD_LENGTH, PASSWORD_POLICY_HINT } from "../lib/passwordPolicy";

// Self-Service "Passwort vergessen" (Finding SEC-07) - zwei Modi je nachdem,
// ob ein ?token=... in der URL steckt (Link aus der Reset-E-Mail) oder
// nicht (Anfrage stellen).
//
// Token-URL-Leak behoben (P1, zweiter Production-Readiness-Härtungsdurchgang
// 2026-08-27): der Reset-Token blieb bisher dauerhaft in der sichtbaren
// Adresszeile/Browser-History stehen (aus useSearchParams gelesen, aber nie
// wieder entfernt) - sichtbar für jede Person mit Zugriff auf Bildschirm/
// Verlauf/Screenshot, landet in Analytics-Tools, die die URL protokollieren,
// und würde bei einem (hier nicht vorhandenen) externen Link von der Seite
// per Referrer-Header an die Zielseite weitergereicht. Token wird jetzt beim
// ersten Rendern EINMALIG aus der URL gelesen, in einer Ref (nicht einmal
// React-State, um unnötige Re-Renders/Persistenz zu vermeiden) für die
// Dauer der Seite gehalten, und die URL wird sofort per
// history.replaceState bereinigt - der Token verlässt diese Komponente
// danach nur noch als Teil des einen POST /api/password-reset/confirm.
export default function PasswordReset() {
  const [tokenState] = useState<{ token: string | null; type: string | null }>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    const type = params.get("type");
    if (t) {
      // Token unverzüglich aus Adresszeile/History entfernen
      window.history.replaceState(null, "", window.location.pathname);
      return { token: t, type };
    }
    return { token: null, type: null };
  });

  const token = tokenState.token;
  const hasToken = Boolean(token);
  const isSetup = tokenState.type === "setup";

  const [email, setEmail] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordRepeat, setNewPasswordRepeat] = useState("");
  const [confirmDone, setConfirmDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/password-reset/request", { email });
      setRequestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Anfordern");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== newPasswordRepeat) {
      setError("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    setSubmitting(true);
    try {
      const endpoint = isSetup ? "/api/account-setup/confirm" : "/api/password-reset/confirm";
      await api.post(endpoint, { token, newPassword });
      setConfirmDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Bestätigen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3 text-center">
          <SquoraBrand size="lg" layout="stack" />
        </div>

        {hasToken ? (
          confirmDone ? (
            <div className="space-y-3 text-center">
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                {isSetup ? "Konto erfolgreich aktiviert! Du kannst dich jetzt anmelden." : "Passwort geändert. Du kannst dich jetzt anmelden."}
              </p>
              <Link to="/login" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
                Zur Anmeldung
              </Link>
            </div>
          ) : (
            <form onSubmit={handleConfirm} className="space-y-3">
              <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                {isSetup ? "Konto aktivieren & persönliches Passwort festlegen." : "Neues Passwort festlegen."}
              </p>
              <FloatingInput
                label="Neues Passwort"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">{PASSWORD_POLICY_HINT}</p>
              <FloatingInput
                label="Neues Passwort wiederholen"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={newPasswordRepeat}
                onChange={(e) => setNewPasswordRepeat(e.target.value)}
              />
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                {submitting ? "Wird gespeichert…" : "Passwort setzen"}
              </button>
            </form>
          )
        ) : requestSent ? (
          <p className="text-center text-sm text-slate-600 dark:text-slate-300">
            Falls diese E-Mail-Adresse registriert ist, wurde eine Zurücksetzen-Mail verschickt. Bitte den Link
            darin innerhalb von 30 Minuten öffnen.
          </p>
        ) : (
          <form onSubmit={handleRequest} className="space-y-3">
            <p className="text-center text-sm text-slate-500 dark:text-slate-400">
              Passwort vergessen? Trag deine E-Mail-Adresse ein, wir schicken dir einen Link zum Zurücksetzen.
            </p>
            <FloatingInput label="E-Mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              {submitting ? "Wird gesendet…" : "Link anfordern"}
            </button>
            <Link to="/login" className="block text-center text-sm text-slate-500 hover:underline dark:text-slate-400">
              Zurück zur Anmeldung
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
