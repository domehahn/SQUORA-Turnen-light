import { SELF, applyD1Migrations, env } from "cloudflare:test";
import { hashPassword } from "../src/auth";
import { base32Decode, generateTotp } from "../src/totp";

// Test-Fixtures: legen Nutzer/Vereine/Gruppen/Kinder direkt über echte
// db.ts/auth.ts-Funktionen bzw. minimale Rohinserts an, dieselbe Logik wie
// die App selbst nutzt (z.B. PBKDF2-Hashing) - keine eigene Test-only-Logik,
// die von der echten Autorisierung abweichen könnte.

// vitest-pool-workers' top-level `setupFiles` läuft in dieser Version nicht
// zuverlässig innerhalb des Worker-Kontexts (leere DB trotz konfiguriertem
// setupFiles) - daher wird hier explizit in einem `beforeAll` je Testdatei
// migriert, direkt mit `cloudflare:test`s eigenen Helfern. Mehrfacher
// Aufruf ist unschädlich (CREATE TABLE würde beim zweiten Mal fehlschlagen,
// daher einmalig pro Modul-Ladung gemerkt).
let migrated = false;
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  migrated = true;
}

export async function seedUser(input: {
  email: string;
  password: string;
  name?: string | null;
  clubId?: string | null;
  clubRole?: "member" | "jugendleiter";
  isAdmin?: boolean;
}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const { hash, salt, iterations } = await hashPassword(input.password);
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations, club_id, club_role, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.email,
      input.name ?? null,
      hash,
      salt,
      iterations,
      input.clubId ?? null,
      input.clubRole ?? "member",
      input.isAdmin ? 1 : 0
    )
    .run();
  return { id };
}

export async function seedClub(name: string): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO clubs (id, name) VALUES (?, ?)").bind(id, name).run();
  return { id };
}

export async function seedGroup(input: {
  name: string;
  ownerId: string;
  clubId: string;
  minAge?: number;
  maxAge?: number;
}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO groups (id, name, min_age, max_age, sort_order, owner_id, club_id) VALUES (?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(id, input.name, input.minAge ?? 3, input.maxAge ?? 10, input.ownerId, input.clubId)
    .run();
  return { id };
}

export async function seedChild(input: {
  firstName: string;
  lastName: string;
  groupId: string | null;
  clubId?: string | null;
}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO children (id, first_name, last_name, birth_date, group_id, club_id) VALUES (?, ?, ?, '2020-01-01', ?, ?)`
  )
    .bind(id, input.firstName, input.lastName, input.groupId, input.clubId ?? null)
    .run();
  return { id };
}

export async function seedFamily(input: {
  name: string;
  createdBy: string | null;
  clubId?: string | null;
}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO families (id, name, created_by, club_id) VALUES (?, ?, ?, ?)`)
    .bind(id, input.name, input.createdBy, input.clubId ?? null)
    .run();
  return { id };
}

// Login über den echten Endpunkt statt eines Test-Shortcuts - deckt damit
// automatisch auch Rate Limiting (SEC-01) und die Login-Route selbst mit ab.
// Seit der Session-Management-Härtung setzt der Login ein HttpOnly-Cookie
// statt ein JWT im Response-Body zurückzugeben - SELF.fetch() hat (anders
// als ein echter Browser) keinen eigenen Cookie-Jar, deshalb wird das
// rohe Set-Cookie hier extrahiert und muss von den Tests manuell auf
// folgende Requests gesetzt werden (s. authHeaders()).
export async function login(SELF: Fetcher, email: string, password: string): Promise<string> {
  const res = await SELF.fetch("https://example.test/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login fehlgeschlagen (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login-Response ohne Set-Cookie");
  return extractSessionCookie(setCookie);
}

export function extractSessionCookie(setCookieHeader: string): string {
  const match = setCookieHeader.match(/turnen_session=([^;]+)/);
  if (!match) throw new Error("turnen_session nicht im Set-Cookie-Header gefunden");
  return `turnen_session=${match[1]}`;
}

export function authHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, "Content-Type": "application/json" };
}

// Richtet MFA für einen bereits eingeloggten Test-Nutzer ein (Finding
// "API-seitige MFA-Durchsetzung": Admin/Jugendleitung ohne aktivierte MFA
// werden jetzt auch serverseitig blockiert, nicht mehr nur im Frontend-
// Overlay) - Tests, die eine privilegierte Rolle gegen eine "normale"
// Route prüfen wollen, müssen vorher echte MFA einrichten, sonst greift
// die Durchsetzung selbst und verfälscht das Testergebnis.
export async function enableMfaForTest(cookie: string, password: string): Promise<void> {
  const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ password }),
  });
  if (setupRes.status !== 200) throw new Error(`MFA-Setup fehlgeschlagen (${setupRes.status}): ${await setupRes.text()}`);
  const { secret } = (await setupRes.json()) as { secret: string };
  const code = await generateTotp(base32Decode(secret));
  const confirmRes = await SELF.fetch("https://example.test/api/me/mfa/confirm", {
    method: "POST",
    headers: authHeaders(cookie),
    body: JSON.stringify({ code }),
  });
  if (confirmRes.status !== 200) throw new Error(`MFA-Bestätigung fehlgeschlagen (${confirmRes.status}): ${await confirmRes.text()}`);
}
