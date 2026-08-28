import { SignJWT, jwtVerify } from "jose";

// War einheitlich 100_000 (globale Konstante). OWASP empfiehlt für
// PBKDF2-HMAC-SHA256 aktuell 600.000 Iterationen (Production-Readiness-
// Prüfung 2026-08-27); die Cloudflare-Workers-Runtime (workerd) lehnt
// crypto.subtle.deriveBits mit PBKDF2 oberhalb von 100.000 Iterationen
// jedoch mit "NotSupportedError: iteration counts above 100000 are not
// supported" ab (in Produktion am 27.08.2026 aufgefallen - jeder Login mit
// transparentem Rehashing crashte). Daher bewusst bei der von der Laufzeit
// unterstützten Obergrenze belassen, statt der OWASP-Empfehlung zu folgen.
// users.password_iterations (Migration 0038) bleibt trotzdem pro Nutzer
// gespeichert statt hartkodiert - falls workerd künftig höhere Werte
// erlaubt, lässt sich diese Konstante gefahrlos anheben, bestehende Hashes
// werden dann wie vorgesehen beim nächsten Login transparent angehoben.
export const CURRENT_PBKDF2_ITERATIONS = 100_000;
// NUR für MFA-Backup-Codes (s. index.ts) - bewusst von der Nutzer-Passwort-
// Iterationszahl entkoppelt: Backup-Codes sind kurzlebige, hochentropische
// Zufallswerte (keine von Menschen gewählten Passwörter), ihre Sicherheit
// kommt aus der Entropie, nicht aus PBKDF2-Kosten. So bleibt die einmal
// gewählte Zahl stabil, ohne pro Backup-Code eine eigene Iterationszahl
// mitspeichern zu müssen.
export const BACKUP_CODE_ITERATIONS = 100_000;

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, keyMaterial, 256);
}

export async function hashPassword(
  password: string,
  iterations = CURRENT_PBKDF2_ITERATIONS
): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, iterations);
  return { hash: toHex(derived), salt: toHex(salt), iterations };
}

// Have-I-Been-Pwned-Abgleich per k-Anonymity-API (Finding SEC-07, OWASP
// ASVS V2.1): das volle Passwort verlässt nie den Worker, nur die ersten 5
// Zeichen des SHA-1-Hex-Hashes werden an die API geschickt - der Abgleich
// mit den zurückgegebenen Suffixen passiert lokal. Best effort: schlägt
// die externe API fehl (Timeout/Netzwerk/Rate-Limit), wird das Passwort
// NICHT blockiert - ein Drittanbieter-Ausfall darf Login/Registrierung
// nicht lahmlegen.
export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const hashHex = toHex(digest).toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0]?.trim() === suffix);
  } catch {
    return false;
  }
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number): Promise<boolean> {
  const derived = await derive(password, fromHex(salt), iterations);
  const expected = fromHex(hash);
  const actual = new Uint8Array(derived);
  if (actual.length !== expected.length) return false;
  // Timing-safe Vergleich.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}

// Serverseitiges Session-Management (externe Production-Readiness-Prüfung
// 2026-08-27): löst das vorherige rein zustandslose JWT (30 Tage, dann 24h
// mit Sliding-Refresh) ab. Das JWT selbst trägt nur noch eine Sitzungs-ID
// (sid) - Gültigkeit/Widerruf/Idle-Timeout leben in der neuen `sessions`-
// Tabelle (db.ts), damit eine Sitzung aktiv beendet werden kann (Passwort
// ändern, MFA deaktivieren, "alle Geräte abmelden"), nicht nur passiv
// abläuft. Das JWT ist auf die absolute Session-Lebensdauer begrenzt, rein
// als zusätzliche kryptographische Absicherung falls die DB-Prüfung je
// übersprungen würde.
export const IDLE_TIMEOUT_SECONDS = 5 * 60; // 5 Minuten Inaktivität -> Logout
export const ABSOLUTE_SESSION_SECONDS = 8 * 60 * 60; // 8 Stunden harte Obergrenze
// Throttle für last_activity_at-Updates - nicht bei jedem Request schreiben.
export const ACTIVITY_UPDATE_THROTTLE_SECONDS = 30;

export async function signSessionJwt(userId: string, sessionId: string, secret: string): Promise<string> {
  return new SignJWT({ typ: "session", sid: sessionId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ABSOLUTE_SESSION_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export interface SessionJwtPayload {
  sub: string;
  sid: string;
}

// Nur "typ: session"-Tokens sind vollwertige Sitzungen - verhindert, dass
// ein MFA-Pre-Auth-Token (typ: "mfa_pending", siehe unten) versehentlich
// requireAuth passiert, bevor der zweite Faktor bestätigt wurde.
export async function verifySessionJwt(token: string, secret: string): Promise<SessionJwtPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (payload.typ !== "session" || typeof payload.sid !== "string") throw new Error("Kein Sitzungs-Token");
  return { sub: payload.sub as string, sid: payload.sid };
}

// Kurzlebiges Zwischen-Token für den zweiten MFA-Schritt (Finding SEC-02) -
// beweist nur "Passwort war korrekt", aber KEINE vollständige Sitzung.
const MFA_PENDING_LIFETIME_SECONDS = 5 * 60;

export async function signMfaPendingToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ typ: "mfa_pending" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_LIFETIME_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyMfaPendingToken(token: string, secret: string): Promise<string> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (payload.typ !== "mfa_pending") throw new Error("Kein MFA-Zwischen-Token");
  return payload.sub as string;
}

// Self-Service-Passwort-Reset (Finding SEC-07). Jeder Token trägt jetzt eine
// eindeutige jti (Finding aus der Production-Readiness-Prüfung 2026-08-27:
// der Token war vorher innerhalb seiner 30-Minuten-Gültigkeit mehrfach
// einlösbar) - db.consumePasswordResetJti() trägt sie beim Einlösen atomar
// in `used_password_reset_tokens` ein, ein zweiter Versuch mit demselben
// Token schlägt fehl (PRIMARY-KEY-Konflikt).
const PASSWORD_RESET_LIFETIME_SECONDS = 30 * 60;

export interface PasswordResetTokenPayload {
  userId: string;
  jti: string;
  expiresAt: number;
}

export async function signPasswordResetToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ typ: "password_reset", jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${PASSWORD_RESET_LIFETIME_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyPasswordResetToken(token: string, secret: string): Promise<PasswordResetTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (payload.typ !== "password_reset" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    throw new Error("Kein Passwort-Reset-Token");
  }
  return { userId: payload.sub as string, jti: payload.jti, expiresAt: payload.exp };
}

// Account-Setup Tokens (Einmalige Account-Aktivierung ohne Klartext-Passwort-Mail, P1 Hardening)
const ACCOUNT_SETUP_LIFETIME_SECONDS = 60 * 60; // 60 Minuten Gültigkeit

export interface AccountSetupTokenPayload {
  userId: string;
  jti: string;
  expiresAt: number;
}

export async function signAccountSetupToken(userId: string, secret: string): Promise<string> {
  return new SignJWT({ typ: "account_setup", jti: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCOUNT_SETUP_LIFETIME_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccountSetupToken(token: string, secret: string): Promise<AccountSetupTokenPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (payload.typ !== "account_setup" || typeof payload.jti !== "string" || typeof payload.exp !== "number") {
    throw new Error("Kein Account-Setup-Token");
  }
  return { userId: payload.sub as string, jti: payload.jti, expiresAt: payload.exp };
}
