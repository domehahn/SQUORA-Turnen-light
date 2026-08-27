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
//
// CURRENT_PBKDF2_ITERATIONS steht bei 100_000 (nicht der OWASP-Empfehlung
// von 600_000), weil workerds crypto.subtle.deriveBits PBKDF2 oberhalb von
// 100.000 Iterationen mit NotSupportedError ablehnt (in Produktion am
// 27.08.2026 aufgefallen). Die Tests hier nutzen deshalb einen künstlich
// niedrigeren Legacy-Wert (50_000), um den Rehashing-Mechanismus selbst zu
// prüfen, unabhängig von der aktuell gültigen Ziel-Iterationszahl.
describe("Passwort-Hashing (PBKDF2-Iterationen)", () => {
  it("ein mit der alten, niedrigeren Iterationszahl gehashtes Passwort funktioniert weiterhin beim Login und wird danach automatisch angehoben", async () => {
    const { hashPassword } = await import("../src/auth");
    const LEGACY_ITERATIONS = 50_000;
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
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
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
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ email: "legacy-hash@test.local", password: "legacy-password-123" }),
    });
    expect(res2.status).toBe(200);
  });

  it("neu angelegte Nutzer bekommen direkt die aktuelle Iterationszahl", async () => {
    const { CURRENT_PBKDF2_ITERATIONS } = await import("../src/auth");
    await seedUser({ email: "fresh-hash@test.local", password: "fresh-password-456" });
    const row = await env.DB.prepare("SELECT password_iterations FROM users WHERE email = ?")
      .bind("fresh-hash@test.local")
      .first<{ password_iterations: number }>();
    expect(row!.password_iterations).toBe(CURRENT_PBKDF2_ITERATIONS);
  });
});
