import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";
import { ThemeToggle } from "../components/ThemeToggle";
import SquoraBrand from "../components/SquoraBrand";

export default function Login() {
  const { isAuthenticated, signIn, verifyMfa } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from ?? "/gruppen";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result.error) setError(result.error);
    else if (result.mfaToken) setMfaToken(result.mfaToken);
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    const result = await verifyMfa(mfaToken, mfaCode);
    setSubmitting(false);
    if (result.error) setError(result.error);
  }

  if (mfaToken) {
    return (
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <form
          onSubmit={handleMfaSubmit}
          className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <SquoraBrand size="lg" layout="stack" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Bitte gib den 6-stelligen Code aus deiner Authenticator-App ein (oder einen Backup-Code).
            </p>
          </div>
          <FloatingInput
            label="Code"
            type="text"
            required
            autoFocus
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            {submitting ? "Prüfen…" : "Bestätigen"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMfaToken(null);
              setMfaCode("");
              setError(null);
            }}
            className="w-full text-center text-sm text-slate-500 hover:underline dark:text-slate-400"
          >
            Zurück
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <SquoraBrand size="lg" layout="stack" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Anmeldung für die Gruppenverwaltung.</p>
        </div>
        <FloatingInput
          label="E-Mail"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FloatingInput
          label="Passwort"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          {submitting ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
