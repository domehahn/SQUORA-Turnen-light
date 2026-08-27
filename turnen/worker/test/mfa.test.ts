import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, extractSessionCookie, login, seedClub, seedUser } from "./helpers";
import { base32Decode, generateTotp } from "../src/totp";

beforeAll(async () => {
  await ensureMigrated();
});

// TOTP-MFA (Finding SEC-02) - deckt den vollen Ablauf ab: Einrichtung,
// Bestätigung, Login mit zweitem Faktor, Backup-Code, und dass das
// MFA-Zwischen-Token (typ: "mfa_pending") keine vollwertige Sitzung ist.
describe("MFA (TOTP)", () => {
  it("Login ohne aktiviertes MFA funktioniert weiterhin normal", async () => {
    await seedUser({ email: "mfa-off@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-off@test.local", "password-123");
    expect(token).toBeTruthy();
  });

  it("kompletter Ablauf: Setup -> Confirm -> Login erfordert Code -> Login mit Code erfolgreich", async () => {
    await seedUser({ email: "mfa-full@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-full@test.local", "password-123");

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
    });
    expect(setupRes.status).toBe(200);
    const { secret } = (await setupRes.json()) as { secret: string };

    const code = await generateTotp(base32Decode(secret));
    const confirmRes = await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });
    expect(confirmRes.status).toBe(200);
    const { backupCodes } = (await confirmRes.json()) as { backupCodes: string[] };
    expect(backupCodes.length).toBe(8);

    // Normaler Login liefert jetzt nur noch ein Zwischen-Token, keine Sitzung.
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-full@test.local", password: "password-123" }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = (await loginRes.json()) as { mfaRequired?: boolean; mfaToken?: string; token?: string };
    expect(loginBody.mfaRequired).toBe(true);
    expect(loginBody.token).toBeUndefined();

    // Das MFA-Zwischen-Token darf KEINE vollwertige Sitzung sein.
    const misuseRes = await SELF.fetch("https://example.test/api/me", {
      headers: authHeaders(loginBody.mfaToken as string),
    });
    expect(misuseRes.status).toBe(401);

    const mfaCode = await generateTotp(base32Decode(secret));
    const mfaLoginRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: loginBody.mfaToken, code: mfaCode }),
    });
    expect(mfaLoginRes.status).toBe(200);
    const sessionCookie = extractSessionCookie(mfaLoginRes.headers.get("set-cookie") as string);

    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(sessionCookie) });
    expect(meRes.status).toBe(200);

    // Ein Backup-Code funktioniert alternativ zum TOTP-Code und danach nicht
    // noch einmal (einmalig verwendbar).
    const loginRes2 = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-full@test.local", password: "password-123" }),
    });
    const loginBody2 = (await loginRes2.json()) as { mfaToken: string };
    const backupRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: loginBody2.mfaToken, code: backupCodes[0] }),
    });
    expect(backupRes.status).toBe(200);

    const loginRes3 = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-full@test.local", password: "password-123" }),
    });
    const loginBody3 = (await loginRes3.json()) as { mfaToken: string };
    const reuseRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: loginBody3.mfaToken, code: backupCodes[0] }),
    });
    expect(reuseRes.status).toBe(401);
  });

  it("Login mit falschem MFA-Code schlägt fehl", async () => {
    await seedUser({ email: "mfa-wrong@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-wrong@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-wrong@test.local", password: "password-123" }),
    });
    const { mfaToken } = (await loginRes.json()) as { mfaToken: string };
    const wrongRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code: "000000" }),
    });
    expect(wrongRes.status).toBe(401);
  });

  it("MFA kann mit korrektem Passwort wieder deaktiviert werden", async () => {
    const token = await (async () => {
      await seedUser({ email: "mfa-disable@test.local", password: "password-123" });
      return login(SELF, "mfa-disable@test.local", "password-123");
    })();
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const disableRes = await SELF.fetch("https://example.test/api/me/mfa/disable", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    expect(disableRes.status).toBe(200);

    // Nach Deaktivierung wieder normaler Login ohne zweiten Faktor.
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-disable@test.local", password: "password-123" }),
    });
    const body = (await loginRes.json()) as { mfaRequired?: boolean };
    expect(body.mfaRequired).toBeUndefined();
    expect(loginRes.headers.get("set-cookie")).toBeTruthy();
  });

  it("MFA ist reines Opt-in: Jugendleitung kann die App ohne MFA normal nutzen, mfaEnabled spiegelt nur den tatsächlichen Status", async () => {
    const club = await seedClub("Verein MFA-Optin");
    await seedUser({
      email: "mfa-optin@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const token = await login(SELF, "mfa-optin@test.local", "password-123");

    const meBefore = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    expect(meBefore.status).toBe(200);
    const bodyBefore = (await meBefore.json()) as { mfaEnabled: boolean };
    expect(bodyBefore.mfaEnabled).toBe(false);

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const meAfter = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const bodyAfter = (await meAfter.json()) as { mfaEnabled: boolean };
    expect(bodyAfter.mfaEnabled).toBe(true);
  });
});

// API-seitige MFA-Durchsetzung für Platform-Admin (Nutzerentscheidung
// 2026-08-27, zweiter Durchgang: nach der vollständigen Rücknahme erneut
// angefordert, aber bewusst nur für is_admin, nicht Jugendleitung - höchste
// Zugriffsstufe, vereinsübergreifend).
describe("MFA-Zwang für Platform-Admin", () => {
  it("Admin-Account ohne aktivierte MFA wird von normalen Routen blockiert (403, mfaSetupRequired)", async () => {
    await seedUser({ email: "mfa-admin-blocked@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "mfa-admin-blocked@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(token) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { mfaSetupRequired?: boolean };
    expect(body.mfaSetupRequired).toBe(true);
  });

  it("Admin-Account ohne MFA kann trotzdem /api/me, /api/logout und die MFA-Einrichtung selbst erreichen (kann sich sonst nicht befreien)", async () => {
    await seedUser({ email: "mfa-admin-exempt@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "mfa-admin-exempt@test.local", "password-123");

    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { mfaSetupRequired: boolean };
    expect(meBody.mfaSetupRequired).toBe(true);

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    expect(setupRes.status).toBe(200);
  });

  it("Admin-Account mit aktivierter MFA wird nicht blockiert", async () => {
    await seedUser({ email: "mfa-admin-ok@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "mfa-admin-ok@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
  });

  it("Jugendleitung (ohne is_admin) wird weiterhin NICHT zur MFA gezwungen", async () => {
    const club = await seedClub("Verein MFA-Admin-Only");
    await seedUser({
      email: "mfa-leader-not-forced@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const token = await login(SELF, "mfa-leader-not-forced@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
  });
});
