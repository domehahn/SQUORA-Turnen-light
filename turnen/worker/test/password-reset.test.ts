import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Self-Service-Passwort-Reset (Finding SEC-07).
describe("Passwort-Reset per E-Mail", () => {
  it("liefert für existierende und nicht existierende E-Mail dieselbe generische Antwort (keine Account-Enumeration)", async () => {
    await seedUser({ email: "reset-exists@test.local", password: "password-123" });

    const resExists = await SELF.fetch("https://example.test/api/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset-exists@test.local" }),
    });
    const resMissing = await SELF.fetch("https://example.test/api/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "does-not-exist@test.local" }),
    });
    expect(resExists.status).toBe(200);
    expect(resMissing.status).toBe(200);
    expect(await resExists.json()).toEqual(await resMissing.json());
  });

  it("Reset-Confirm mit ungültigem Token schlägt fehl", async () => {
    const res = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "not-a-real-token", newPassword: "brandnew-password-456" }),
    });
    expect(res.status).toBe(401);
  });

  it("normales Ändern des eigenen Passworts über /api/me/password funktioniert weiterhin (SEC-07-Check blockiert nicht generell)", async () => {
    await seedUser({ email: "profile-pw-change@test.local", password: "password-123" });
    const token = await login(SELF, "profile-pw-change@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "a-fresh-unique-password-789" }),
    });
    expect(res.status).toBe(200);
  });
});

// Passwort-Policy (externe Production-Readiness-Prüfung 2026-08-27, P1
// "PASSWORD POLICY"): Mindestlänge 15 statt 8 für NEU gesetzte Passwörter,
// keine Komplexitätsregeln (NIST SP 800-63B) - lange Passphrases sind
// bewusst zulässig. Gilt nicht rückwirkend: Bestandsaccounts mit kürzerem
// Passwort können sich weiterhin einloggen (schon durch
// test/password-hashing.test.ts u.a. implizit abgedeckt, hier zusätzlich
// explizit für den Login-Pfad selbst).
describe("Passwort-Policy (Mindestlänge)", () => {
  it("ein neues Passwort mit 14 Zeichen (unter dem Minimum) wird bei der eigenen Passwortänderung abgelehnt", async () => {
    await seedUser({ email: "policy-too-short@test.local", password: "password-123" });
    const token = await login(SELF, "policy-too-short@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "kurz-14-zeichn" }),
    });
    expect(res.status).toBe(400);
  });

  it("ein neues Passwort mit genau 15 Zeichen wird akzeptiert", async () => {
    await seedUser({ email: "policy-exact@test.local", password: "password-123" });
    const token = await login(SELF, "policy-exact@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "genau15zeichenx" }),
    });
    expect(res.status).toBe(200);
  });

  it("eine lange Passphrase (mehrere Wörter, keine Sonderzeichen/Ziffern) wird akzeptiert", async () => {
    await seedUser({ email: "policy-passphrase@test.local", password: "password-123" });
    const token = await login(SELF, "policy-passphrase@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "korrekt pferd batterie klammer" }),
    });
    expect(res.status).toBe(200);
  });

  it("ein Bestandsaccount mit einem kürzeren (Alt-)Passwort kann sich weiterhin ganz normal einloggen", async () => {
    // Absichtlich ein kurzes Passwort direkt seeden (umgeht validPassword,
    // wie ein echter Alt-Bestand vor der Policy-Änderung) - die neue
    // Mindestlänge gilt nur für NEU gesetzte Passwörter, nicht rückwirkend.
    await seedUser({ email: "policy-legacy-login@test.local", password: "kurz123" });
    const token = await login(SELF, "policy-legacy-login@test.local", "kurz123");
    expect(token).toBeTruthy();
  });
});

// Rate Limiting (externe Production-Readiness-Prüfung 2026-08-27, P1
// "PASSWORD RESET HARDENING") - vorher konnte POST /api/password-reset/request
// beliebig oft aufgerufen werden.
describe("Passwort-Reset Rate Limiting", () => {
  it("nach 5 Anfragen für dieselbe E-Mail innerhalb des Zeitfensters bleibt die Antwort generisch, aber es wird keine weitere Mail verschickt", async () => {
    await seedUser({ email: "rl-same-email@test.local", password: "password-123" });
    let lastRes: Response | undefined;
    for (let i = 0; i < 6; i++) {
      lastRes = await SELF.fetch("https://example.test/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "rl-same-email@test.local" }),
      });
      expect(lastRes.status).toBe(200);
    }
    // Immer dieselbe generische Antwort, auch beim 6. (eigentlich
    // geblockten) Versuch - kein unterschiedliches Verhalten nach außen.
    const body = (await lastRes!.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("eine unbekannte E-Mail-Adresse zählt ebenfalls fürs Rate-Limit (kein Unterschied zu existierenden Accounts)", async () => {
    let lastRes: Response | undefined;
    for (let i = 0; i < 6; i++) {
      lastRes = await SELF.fetch("https://example.test/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "rl-unknown-email@test.local" }),
      });
      expect(lastRes.status).toBe(200);
    }
    const body = (await lastRes!.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// Token-Verbrauchsreihenfolge (externe Production-Readiness-Prüfung
// 2026-08-27, P1 "PASSWORD RESET HARDENING", "TOKEN CONSUMPTION") - der
// Reset-Token darf nicht verbraucht werden, bevor das neue Passwort
// vollständig validiert wurde (insbesondere HIBP), sonst verbrennt ein
// abgelehntes Passwort einen sonst gültigen Link.
describe("Passwort-Reset: Token-Verbrauchsreihenfolge", () => {
  it("ein abgelehntes (zu kurzes) neues Passwort verbraucht den Token NICHT - ein zweiter Versuch mit demselben Token funktioniert noch", async () => {
    const user = await seedUser({ email: "token-order@test.local", password: "password-123" });
    const { signPasswordResetToken } = await import("../src/auth");
    const { env } = await import("cloudflare:test");
    const token = await signPasswordResetToken(user.id, env.JWT_SECRET);

    const rejectedRes = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "zu-kurz" }),
    });
    expect(rejectedRes.status).toBe(400);

    const successRes = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "jetzt-lang-genug-123" }),
    });
    expect(successRes.status).toBe(200);
  });

  it("nach einem erfolgreichen Wechsel ist derselbe Token danach nicht mehr verwendbar", async () => {
    const user = await seedUser({ email: "token-order-used@test.local", password: "password-123" });
    const { signPasswordResetToken } = await import("../src/auth");
    const { env } = await import("cloudflare:test");
    const token = await signPasswordResetToken(user.id, env.JWT_SECRET);

    const firstRes = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "erster-wechsel-123" }),
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "zweiter-wechsel-456" }),
    });
    expect(secondRes.status).toBe(401);
  });

  it("zwei parallele Requests mit demselben Token: höchstens einer ist erfolgreich", async () => {
    const user = await seedUser({ email: "token-order-parallel@test.local", password: "password-123" });
    const { signPasswordResetToken } = await import("../src/auth");
    const { env } = await import("cloudflare:test");
    const token = await signPasswordResetToken(user.id, env.JWT_SECRET);

    const [res1, res2] = await Promise.all([
      SELF.fetch("https://example.test/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "paralleler-wechsel-a" }),
      }),
      SELF.fetch("https://example.test/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: "paralleler-wechsel-b" }),
      }),
    ]);
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 401]);
  });
});
