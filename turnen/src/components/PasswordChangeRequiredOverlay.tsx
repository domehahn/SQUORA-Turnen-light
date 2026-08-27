import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";
import { MIN_PASSWORD_LENGTH, PASSWORD_POLICY_HINT } from "../lib/passwordPolicy";

// Blockierendes Overlay für Accounts mit einem von jemand anderem
// vergebenen initialen Passwort (Admin-Nutzerverwaltung oder
// scripts/create-admin.mjs) - Nutzeranfrage 2026-08-27: "initial Passwort
// von Admin anlegen, aber beim ersten Login wechseln müssen". Zusätzlich
// zum serverseitigen Hard-Block in requireAuth (worker/src/index.ts) - das
// hier ist nur die UI-seitige Führung, kein Ersatz dafür. "Abmelden" bleibt
// immer möglich, sonst könnte sich niemand aus einem falsch vergebenen
// initialen Passwort befreien.
export function PasswordChangeRequiredOverlay() {
  const { signOut, refreshClub } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordRepeat, setNewPasswordRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== newPasswordRepeat) {
      setError("Die beiden neuen Passwörter stimmen nicht überein");
      return;
    }
    setBusy(true);
    try {
      await api.put("/api/me/password", { currentPassword, newPassword });
      await refreshClub();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Ändern des Passworts");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Passwort ändern erforderlich</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Dieser Account wurde mit einem initialen Passwort angelegt. Bitte lege jetzt ein eigenes, nur dir
          bekanntes Passwort fest, bevor die App weiter genutzt werden kann.
        </p>

        {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          <FloatingInput
            label="Aktuelles (initiales) Passwort"
            type="password"
            required
            autoFocus
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <FloatingInput
            label={`Neues Passwort (mind. ${MIN_PASSWORD_LENGTH} Zeichen)`}
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
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            Passwort ändern
          </button>
        </form>

        <button
          type="button"
          onClick={signOut}
          className="block w-full text-center text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          Abmelden
        </button>
      </div>
    </div>
  );
}
