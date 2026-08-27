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

  it("mfaSetupRequired ist true für Jugendleitung ohne MFA und false nach Aktivierung (SEC-02 Durchsetzung)", async () => {
    const club = await seedClub("Verein MFA-Pflicht");
    await seedUser({
      email: "mfa-required@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const token = await login(SELF, "mfa-required@test.local", "password-123");

    const meBefore = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const bodyBefore = (await meBefore.json()) as { mfaSetupRequired: boolean };
    expect(bodyBefore.mfaSetupRequired).toBe(true);

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", { method: "POST", headers: authHeaders(token) });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const meAfter = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const bodyAfter = (await meAfter.json()) as { mfaSetupRequired: boolean };
    expect(bodyAfter.mfaSetupRequired).toBe(false);
  });

  it("mfaSetupRequired ist false für normale Mitglieder ohne MFA", async () => {
    await seedUser({ email: "mfa-not-required@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-not-required@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const body = (await res.json()) as { mfaSetupRequired: boolean };
    expect(body.mfaSetupRequired).toBe(false);
  });
});
