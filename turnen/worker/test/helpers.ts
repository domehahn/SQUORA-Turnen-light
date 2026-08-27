import { applyD1Migrations, env } from "cloudflare:test";
import { hashPassword } from "../src/auth";

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
  const { hash, salt } = await hashPassword(input.password);
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, password_salt, club_id, club_role, is_admin)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.email, input.name ?? null, hash, salt, input.clubId ?? null, input.clubRole ?? "member", input.isAdmin ? 1 : 0)
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

// Login über den echten Endpunkt statt eines Test-Shortcuts - deckt damit
// automatisch auch Rate Limiting (SEC-01) und die Login-Route selbst mit ab.
export async function login(SELF: Fetcher, email: string, password: string): Promise<string> {
  const res = await SELF.fetch("https://example.test/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`Login fehlgeschlagen (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
