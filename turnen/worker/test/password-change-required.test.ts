import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Erzwungener Passwortwechsel (Nutzeranfrage 2026-08-27): wer mit einem von
// einer anderen Person vergebenen initialen Passwort einloggt (Admin-
// Nutzerverwaltung oder scripts/create-admin.mjs), muss es zuerst über
// PUT /api/me/password ändern, bevor irgendetwas anderes nutzbar ist.
describe("Erzwungener Passwortwechsel (must_change_password)", () => {
  it("ein Account mit must_change_password wird von normalen Routen blockiert (403, passwordChangeRequired)", async () => {
    const user = await seedUser({ email: "pw-change-blocked@test.local", password: "initial-pass-123" });
    await env.DB.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").bind(user.id).run();
    const token = await login(SELF, "pw-change-blocked@test.local", "initial-pass-123");

    const res = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(token) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { passwordChangeRequired?: boolean };
    expect(body.passwordChangeRequired).toBe(true);
  });

  it("/api/me, /api/logout und /api/me/password bleiben trotz must_change_password erreichbar", async () => {
    const user = await seedUser({ email: "pw-change-exempt@test.local", password: "initial-pass-123" });
    await env.DB.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").bind(user.id).run();
    const token = await login(SELF, "pw-change-exempt@test.local", "initial-pass-123");

    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { passwordChangeRequired: boolean };
    expect(meBody.passwordChangeRequired).toBe(true);
  });

  it("nach erfolgreichem Passwortwechsel über PUT /api/me/password ist der Account normal nutzbar", async () => {
    const user = await seedUser({ email: "pw-change-fixed@test.local", password: "initial-pass-123" });
    await env.DB.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").bind(user.id).run();
    const token = await login(SELF, "pw-change-fixed@test.local", "initial-pass-123");

    const changeRes = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ currentPassword: "initial-pass-123", newPassword: "eigenes-neues-passwort-456" }),
    });
    expect(changeRes.status).toBe(200);

    // Passwortänderung widerruft andere Sitzungen, nicht die aktuelle -
    // dieselbe Sitzung/dasselbe Cookie funktioniert also direkt weiter.
    const res = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(token) });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ must_change_password: number }>();
    expect(row!.must_change_password).toBe(0);
  });

  it("ein neu über POST /api/admin/users angelegter Account hat must_change_password=1", async () => {
    await seedUser({ email: "pw-change-admin-creator@test.local", password: "password-123", isAdmin: true });
    const adminToken = await login(SELF, "pw-change-admin-creator@test.local", "password-123");
    // Admin-Account hat selbst noch keine MFA aktiviert - für /api/admin/users
    // ist das relevant (MFA-Zwang), deshalb hier den MFA-Exempt-Pfad nutzen:
    // Setup + Confirm, damit der erstellende Admin selbst keine 403 bekommt.
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret } = (await setupRes.json()) as { secret: string };
    const { base32Decode, generateTotp } = await import("../src/totp");
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ code }),
    });

    const createRes = await SELF.fetch("https://example.test/api/admin/users", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ email: "pw-change-new-user@test.local", password: "temp-password-789" }),
    });
    expect(createRes.status).toBe(201);

    const newUserToken = await login(SELF, "pw-change-new-user@test.local", "temp-password-789");
    const res = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(newUserToken) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { passwordChangeRequired?: boolean };
    expect(body.passwordChangeRequired).toBe(true);
  });

  it("PUT /api/admin/users/:id/password (Admin setzt fremdes Passwort zurück) setzt must_change_password wieder auf 1", async () => {
    await seedUser({ email: "pw-change-admin-reset-actor@test.local", password: "password-123", isAdmin: true });
    const adminToken = await login(SELF, "pw-change-admin-reset-actor@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret } = (await setupRes.json()) as { secret: string };
    const { base32Decode, generateTotp } = await import("../src/totp");
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ code }),
    });

    // Zielnutzer hat bereits sein eigenes Passwort gesetzt (must_change_password = 0)
    // und eine aktive Sitzung (z.B. auf einem kompromittierten Gerät).
    const target = await seedUser({ email: "pw-change-reset-target@test.local", password: "old-password-123" });
    await env.DB.prepare("UPDATE users SET must_change_password = 0 WHERE id = ?").bind(target.id).run();
    const targetToken = await login(SELF, "pw-change-reset-target@test.local", "old-password-123");
    const beforeReset = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(targetToken) });
    expect(beforeReset.status).toBe(200);

    const resetRes = await SELF.fetch(`https://example.test/api/admin/users/${target.id}/password`, {
      method: "PUT",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ newPassword: "admin-vergebenes-passwort-999" }),
    });
    expect(resetRes.status).toBe(200);

    const row = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?")
      .bind(target.id)
      .first<{ must_change_password: number }>();
    expect(row!.must_change_password).toBe(1);

    // Finding P1 "ADMIN PASSWORD RESET": die vorher aktive Sitzung der
    // Zielperson muss nach dem Reset ausnahmslos ungültig sein - ein
    // Admin-Reset ist ein Security-Recovery-Vorgang, kein reiner
    // Komfort-Reset.
    const afterReset = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(targetToken) });
    expect(afterReset.status).toBe(401);
  });

  it("transparentes PBKDF2-Rehashing beim Login rührt must_change_password NICHT an", async () => {
    const user = await seedUser({ email: "pw-change-rehash@test.local", password: "password-123" });
    await env.DB.prepare("UPDATE users SET must_change_password = 1, password_iterations = 1 WHERE id = ?")
      .bind(user.id)
      .run();
    // Iterations=1 ist niedriger als CURRENT_PBKDF2_ITERATIONS und triggert
    // beim Login das transparente Rehashing - das darf must_change_password
    // nicht auf 0 zurücksetzen (kein echter, selbst gewählter Wechsel).
    // Der Hash selbst muss dafür neu mit iterations=1 berechnet werden.
    const { hashPassword } = await import("../src/auth");
    const { hash, salt } = await hashPassword("password-123", 1);
    await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").bind(hash, salt, user.id).run();

    await login(SELF, "pw-change-rehash@test.local", "password-123");

    const row = await env.DB.prepare("SELECT must_change_password FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ must_change_password: number }>();
    expect(row!.must_change_password).toBe(1);
  });
});
