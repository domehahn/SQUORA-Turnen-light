import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAuth } from "../context/useAuth";
import { FloatingInput } from "../components/FloatingField";
import { QrCode } from "../components/QrCode";

// Blockierendes Setup-Overlay für Platform-Admin-Accounts (is_admin) ohne
// aktivierte Zwei-Faktor-Authentifizierung (Nutzerentscheidung 2026-08-27,
// zweiter Durchgang: nur Admin, nicht Jugendleitung - höchste Zugriffsstufe,
// vereinsübergreifend). Zusätzlich zum echten serverseitigen Hard-Block in
// requireAuth (worker/src/index.ts) - dieses Overlay ist nur die UI-seitige
// Führung durch die Einrichtung, kein Ersatz dafür. Ein Fehler bei der
// Einrichtung darf niemanden vollständig aussperren, "Abmelden" bleibt
// immer möglich.
//
// POST /api/me/mfa/setup verlangt seit der MFA-Rotations-Härtung
// (Production-Readiness-Prüfung 2026-08-27) immer eine Passwort-
// Re-Authentifizierung - hier ist totp_enabled naturgemäß immer false (sonst
// würde dieses Overlay gar nicht angezeigt), daher genügt das Passwort ohne
// zusätzlichen aktuellen Code.
export function MfaEnforcementOverlay() {
  const { signOut, refreshClub } = useAuth();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>("/api/me/mfa/setup", { password });
      setSetup(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Starten der Einrichtung");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ backupCodes: string[] }>("/api/me/mfa/confirm", { code });
      setBackupCodes(res.backupCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Code ungültig");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Zwei-Faktor-Authentifizierung erforderlich
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Für Admin-Accounts (vereinsübergreifender Zugriff) ist die Einrichtung verpflichtend, bevor die
          App weiter genutzt werden kann.
        </p>

        {error && <p className="text-sm text-red-600 dark:text-red-400">Fehler: {error}</p>}

        {backupCodes ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">
                Aktiviert. Backup-Codes (einmal verwendbar, falls du dein Gerät verlierst) — jetzt notieren:
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs text-amber-900 dark:text-amber-200">
                {backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => refreshClub()}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Notiert, weiter zur App
            </button>
          </div>
        ) : setup ? (
          <form onSubmit={handleConfirm} className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">Mit der Authenticator-App scannen:</p>
            <QrCode value={setup.otpauthUri} />
            <p className="text-center text-xs text-slate-400 dark:text-slate-500">
              Kein Scanner zur Hand? Schlüssel manuell eingeben:
            </p>
            <p className="break-all rounded-md bg-slate-100 p-2 font-mono text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {setup.secret}
            </p>
            <FloatingInput
              label="6-stelliger Code zur Bestätigung"
              type="text"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Bestätigen
            </button>
          </form>
        ) : (
          <form onSubmit={handleStart} className="space-y-3">
            <FloatingInput
              label="Aktuelles Passwort zur Bestätigung"
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              Einrichtung starten
            </button>
          </form>
        )}

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
