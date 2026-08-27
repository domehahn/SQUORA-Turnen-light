import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Serverseitiges Session-Management (externe Production-Readiness-Prüfung
// 2026-08-27): HttpOnly-Cookie statt localStorage-JWT, Idle-/Absolute-
// Timeout serverseitig durchgesetzt (nicht nur ein Client-Timer),
// Widerruf bei Passwortänderung/-Reset/MFA-Deaktivierung/"alle Geräte
// abmelden".
describe("Session-Management", () => {
  it("Login setzt ein HttpOnly-Cookie, kein Token im Response-Body", async () => {
    await seedUser({ email: "session-cookie@test.local", password: "password-123" });
    const res = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "session-cookie@test.local", password: "password-123" }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token).toBeUndefined();
  });

  it("Logout widerruft die Sitzung - das Cookie ist danach nicht mehr gültig", async () => {
    await seedUser({ email: "session-logout@test.local", password: "password-123" });
    const cookie = await login(SELF, "session-logout@test.local", "password-123");

    const beforeRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(beforeRes.status).toBe(200);

    const logoutRes = await SELF.fetch("https://example.test/api/logout", { method: "POST", headers: authHeaders(cookie) });
    expect(logoutRes.status).toBe(200);

    const afterRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(afterRes.status).toBe(401);
  });

  it("Idle-Timeout: eine seit > 5 Minuten inaktive Sitzung wird abgelehnt", async () => {
    await seedUser({ email: "session-idle@test.local", password: "password-123" });
    const cookie = await login(SELF, "session-idle@test.local", "password-123");

    // Sitzung ist per JWT-sid identifiziert (signiert, nicht direkt aus dem
    // Cookie-Wert lesbar) - stattdessen die einzige Sitzung dieses Nutzers
    // in der DB manipulieren.
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind("session-idle@test.local").first<{ id: string }>();
    await env.DB.prepare("UPDATE sessions SET last_activity_at = datetime('now', '-10 minutes') WHERE user_id = ?")
      .bind(user!.id)
      .run();

    const res = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(res.status).toBe(401);
  });

  // Externe Production-Readiness-Prüfung 2026-08-27: die Benachrichtigungs-
  // glocke pollt alle 60s GET /api/notifications im Hintergrund, solange der
  // Tab offen ist. Ohne Ausnahme hätte das den Idle-Timeout wirkungslos
  // gemacht - die Sitzung wäre nie als inaktiv erkannt worden, obwohl
  // niemand tatsächlich mit der App interagiert.
  it("Idle-Timeout: wiederholtes GET /api/notifications (Hintergrund-Polling) hält die Sitzung NICHT künstlich am Leben", async () => {
    await seedUser({ email: "session-idle-poll@test.local", password: "password-123" });
    const cookie = await login(SELF, "session-idle-poll@test.local", "password-123");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("session-idle-poll@test.local")
      .first<{ id: string }>();

    // Sitzung ist bereits 4 Minuten inaktiv (noch innerhalb des 5-Minuten-
    // Fensters) - simuliert, dass die Person seit 4 Minuten weg ist.
    await env.DB.prepare("UPDATE sessions SET last_activity_at = datetime('now', '-4 minutes') WHERE user_id = ?")
      .bind(user!.id)
      .run();

    // Hintergrund-Poll darf last_activity_at nicht auf "jetzt" zurücksetzen.
    const pollRes = await SELF.fetch("https://example.test/api/notifications", { headers: authHeaders(cookie) });
    expect(pollRes.status).toBe(200);

    const afterPoll = await env.DB.prepare("SELECT last_activity_at FROM sessions WHERE user_id = ?")
      .bind(user!.id)
      .first<{ last_activity_at: string }>();
    // Weiterhin auf dem alten (vor 4 Minuten gesetzten) Stand - der Poll hat
    // ihn nicht angehoben.
    expect(new Date(`${afterPoll!.last_activity_at.replace(" ", "T")}Z`).getTime()).toBeLessThan(Date.now() - 3 * 60 * 1000);

    // Jetzt insgesamt > 5 Minuten inaktiv - trotz des zwischenzeitlichen
    // Polls muss die Sitzung als abgelaufen gelten.
    await env.DB.prepare("UPDATE sessions SET last_activity_at = datetime('now', '-6 minutes') WHERE user_id = ?")
      .bind(user!.id)
      .run();
    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(meRes.status).toBe(401);
  });

  it("Absolute Timeout: eine Sitzung jenseits ihrer absoluten Gültigkeit wird abgelehnt, auch bei frischer Aktivität", async () => {
    await seedUser({ email: "session-absolute@test.local", password: "password-123" });
    const cookie = await login(SELF, "session-absolute@test.local", "password-123");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("session-absolute@test.local")
      .first<{ id: string }>();
    await env.DB.prepare(
      "UPDATE sessions SET absolute_expires_at = datetime('now', '-1 minutes'), last_activity_at = datetime('now') WHERE user_id = ?"
    )
      .bind(user!.id)
      .run();

    const res = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(res.status).toBe(401);
  });

  it("Passwortänderung widerruft andere Sitzungen, nicht die aktuelle", async () => {
    await seedUser({ email: "session-pwchange@test.local", password: "password-123" });
    const cookieA = await login(SELF, "session-pwchange@test.local", "password-123");
    const cookieB = await login(SELF, "session-pwchange@test.local", "password-123");

    const changeRes = await SELF.fetch("https://example.test/api/me/password", {
      method: "PUT",
      headers: authHeaders(cookieA),
      body: JSON.stringify({ currentPassword: "password-123", newPassword: "a-new-password-999" }),
    });
    expect(changeRes.status).toBe(200);

    const stillOkA = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookieA) });
    expect(stillOkA.status).toBe(200);

    const revokedB = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookieB) });
    expect(revokedB.status).toBe(401);
  });

  it("'Alle Geräte abmelden' widerruft andere Sitzungen, nicht die aktuelle", async () => {
    await seedUser({ email: "session-revoke-all@test.local", password: "password-123" });
    const cookieA = await login(SELF, "session-revoke-all@test.local", "password-123");
    const cookieB = await login(SELF, "session-revoke-all@test.local", "password-123");

    const revokeRes = await SELF.fetch("https://example.test/api/me/sessions/revoke-all", {
      method: "POST",
      headers: authHeaders(cookieA),
    });
    expect(revokeRes.status).toBe(200);

    expect((await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookieA) })).status).toBe(200);
    expect((await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookieB) })).status).toBe(401);
  });

  it("Passwort-Reset-Link ist nur einmal einlösbar (End-to-End über die echte Route)", async () => {
    const { signPasswordResetToken } = await import("../src/auth");
    await seedUser({ email: "session-reset-once@test.local", password: "password-123" });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("session-reset-once@test.local")
      .first<{ id: string }>();
    const token = await signPasswordResetToken(user!.id, env.JWT_SECRET);

    const firstConfirm = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "brandnew-password-111" }),
    });
    expect(firstConfirm.status).toBe(200);

    const secondConfirm = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "another-password-222" }),
    });
    expect(secondConfirm.status).toBe(401);
  });

  it("Passwort-Reset widerruft alle Sitzungen des Nutzers", async () => {
    const { signPasswordResetToken } = await import("../src/auth");
    await seedUser({ email: "session-reset-revoke@test.local", password: "password-123" });
    const cookie = await login(SELF, "session-reset-revoke@test.local", "password-123");
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind("session-reset-revoke@test.local")
      .first<{ id: string }>();
    const token = await signPasswordResetToken(user!.id, env.JWT_SECRET);

    await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "yet-another-password-333" }),
    });

    const res = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(cookie) });
    expect(res.status).toBe(401);
  });
});
