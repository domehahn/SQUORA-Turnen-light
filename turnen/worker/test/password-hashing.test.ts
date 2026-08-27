import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Passwort-Hashing-Härtung (Nutzeranfrage nach der Production-Readiness-
// Prüfung): PBKDF2-Iterationen sind jetzt pro Nutzer gespeichert statt
// global hartkodiert, damit bestehende Hashes mit ihrer ursprünglichen
// (niedrigeren) Zahl gültig bleiben und sich transparent auf die neue,
// höhere Zahl heben lassen.
describe("Passwort-Hashing (PBKDF2-Iterationen)", () => {
  it("ein mit der alten, niedrigeren Iterationszahl gehashtes Passwort funktioniert weiterhin beim Login und wird danach automatisch angehoben", async () => {
    const { hashPassword } = await import("../src/auth");
    const LEGACY_ITERATIONS = 100_000;
    const { hash, salt } = await hashPassword("legacy-password-123", LEGACY_ITERATIONS);
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, "legacy-hash@test.local", "Legacy", hash, salt, LEGACY_ITERATIONS)
      .run();

    const before = await env.DB.prepare("SELECT password_iterations FROM users WHERE id = ?")
      .bind(id)
      .first<{ password_iterations: number }>();
    expect(before?.password_iterations).toBe(LEGACY_ITERATIONS);

    const res = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "legacy-hash@test.local", password: "legacy-password-123" }),
    });
    expect(res.status).toBe(200);

    const after = await env.DB.prepare("SELECT password_iterations FROM users WHERE id = ?")
      .bind(id)
      .first<{ password_iterations: number }>();
    expect(after!.password_iterations).toBeGreaterThan(LEGACY_ITERATIONS);

    // Login mit demselben Passwort funktioniert nach dem Rehashing weiterhin.
    const res2 = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "legacy-hash@test.local", password: "legacy-password-123" }),
    });
    expect(res2.status).toBe(200);
  });

  it("neu angelegte Nutzer bekommen direkt die aktuelle, höhere Iterationszahl", async () => {
    await seedUser({ email: "fresh-hash@test.local", password: "fresh-password-456" });
    const row = await env.DB.prepare("SELECT password_iterations FROM users WHERE email = ?")
      .bind("fresh-hash@test.local")
      .first<{ password_iterations: number }>();
    expect(row!.password_iterations).toBeGreaterThanOrEqual(600_000);
  });
});
