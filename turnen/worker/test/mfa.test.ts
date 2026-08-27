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
      body: JSON.stringify({ password: "password-123" }),
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
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
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
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
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

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
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

    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    expect(setupRes.status).toBe(200);
  });

  it("Admin-Account mit aktivierter MFA wird nicht blockiert", async () => {
    await seedUser({ email: "mfa-admin-ok@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "mfa-admin-ok@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
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

// MFA-Setup/Rotation gehärtet (externe Production-Readiness-Prüfung
// 2026-08-27, P1 "MFA SETUP / ROTATION ABSICHERN"): POST /api/me/mfa/setup
// schrieb das neue Secret vorher direkt in die aktive Spalte und setzte
// totp_enabled sofort auf 0 - ein einzelner authentifizierter Aufruf genügte,
// um eine bereits aktive, funktionierende MFA ohne jede weitere Bestätigung
// zu deaktivieren. Das ist jetzt eine Sicherheitsinvariante: totp_enabled
// darf durch einen Setup-Aufruf niemals auf false fallen.
describe("MFA-Setup/Rotation gehärtet (Sicherheitsinvariante)", () => {
  it("Initial-Setup ohne Passwort wird abgelehnt", async () => {
    await seedUser({ email: "mfa-rot-no-pw@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-no-pw@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("Initial-Setup mit falschem Passwort wird abgelehnt", async () => {
    await seedUser({ email: "mfa-rot-wrong-pw@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-wrong-pw@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "falsches-passwort" }),
    });
    expect(res.status).toBe(403);
  });

  it("ein Setup-Aufruf bei bereits aktiver MFA setzt totp_enabled NICHT auf false, solange nicht bestätigt wurde", async () => {
    await seedUser({ email: "mfa-rot-invariant@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-invariant@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    // MFA ist jetzt aktiv. Ein Angreifer mit einer gekaperten Sitzung (aber
    // ohne Kenntnis von Passwort/aktuellem Code) ruft setup erneut auf -
    // muss abgelehnt werden, OHNE die aktive MFA anzutasten.
    const attackRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(attackRes.status).toBe(403);

    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const meBody = (await meRes.json()) as { mfaEnabled: boolean };
    expect(meBody.mfaEnabled).toBe(true);

    // Der ursprüngliche TOTP-Code funktioniert weiterhin normal beim Login.
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-rot-invariant@test.local", password: "password-123" }),
    });
    const { mfaToken } = (await loginRes.json()) as { mfaToken: string };
    const freshCode = await generateTotp(base32Decode(secret));
    const mfaLoginRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code: freshCode }),
    });
    expect(mfaLoginRes.status).toBe(200);
  });

  it("Rotation ohne aktuellen Code (nur Passwort) wird abgelehnt", async () => {
    await seedUser({ email: "mfa-rot-no-code@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-no-code@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const rotateRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    expect(rotateRes.status).toBe(400);
  });

  it("Rotation mit falschem aktuellen Code wird abgelehnt, alte MFA bleibt aktiv", async () => {
    await seedUser({ email: "mfa-rot-wrong-code@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-wrong-code@test.local", "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret: oldSecret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(oldSecret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code }),
    });

    const rotateRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123", currentCode: "000000" }),
    });
    expect(rotateRes.status).toBe(403);

    // Alter Code funktioniert beim Login weiterhin.
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-rot-wrong-code@test.local", password: "password-123" }),
    });
    const { mfaToken } = (await loginRes.json()) as { mfaToken: string };
    const freshOldCode = await generateTotp(base32Decode(oldSecret));
    const mfaLoginRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code: freshOldCode }),
    });
    expect(mfaLoginRes.status).toBe(200);
  });

  it("Rotation mit falschem BESTÄTIGUNGS-Code (neuer Code falsch) lässt den alten Faktor aktiv", async () => {
    await seedUser({ email: "mfa-rot-wrong-confirm@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-wrong-confirm@test.local", "password-123");
    const initialSetup = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret: oldSecret } = (await initialSetup.json()) as { secret: string };
    const initialCode = await generateTotp(base32Decode(oldSecret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: initialCode }),
    });

    // Rotation korrekt starten (richtiges Passwort + richtiger aktueller Code) ...
    const rotateSetup = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123", currentCode: await generateTotp(base32Decode(oldSecret)) }),
    });
    expect(rotateSetup.status).toBe(200);

    // ... aber die Bestätigung des NEUEN Codes schlägt fehl.
    const confirmRes = await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: "000000" }),
    });
    expect(confirmRes.status).toBe(400);

    // Alter Faktor funktioniert weiterhin unverändert.
    const meRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    const meBody = (await meRes.json()) as { mfaEnabled: boolean };
    expect(meBody.mfaEnabled).toBe(true);
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-rot-wrong-confirm@test.local", password: "password-123" }),
    });
    const { mfaToken } = (await loginRes.json()) as { mfaToken: string };
    const finalCode = await generateTotp(base32Decode(oldSecret));
    const mfaLoginRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code: finalCode }),
    });
    expect(mfaLoginRes.status).toBe(200);
  });

  it("erfolgreiche Rotation: neuer Code funktioniert, neue Backup-Codes ausgegeben, alte Backup-Codes werden ungültig, andere Sitzungen widerrufen", async () => {
    await seedUser({ email: "mfa-rot-success@test.local", password: "password-123" });
    const token = await login(SELF, "mfa-rot-success@test.local", "password-123");
    const otherDeviceToken = await login(SELF, "mfa-rot-success@test.local", "password-123");

    const initialSetup = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret: oldSecret } = (await initialSetup.json()) as { secret: string };
    const initialCode = await generateTotp(base32Decode(oldSecret));
    const initialConfirm = await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: initialCode }),
    });
    const { backupCodes: oldBackupCodes } = (await initialConfirm.json()) as { backupCodes: string[] };

    const rotateSetup = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ password: "password-123", currentCode: await generateTotp(base32Decode(oldSecret)) }),
    });
    const { secret: newSecret } = (await rotateSetup.json()) as { secret: string };
    const newCode = await generateTotp(base32Decode(newSecret));
    const rotateConfirm = await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ code: newCode }),
    });
    expect(rotateConfirm.status).toBe(200);
    const { backupCodes: newBackupCodes } = (await rotateConfirm.json()) as { backupCodes: string[] };
    expect(newBackupCodes).not.toEqual(oldBackupCodes);

    // Neuer Code funktioniert beim Login.
    const loginRes = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-rot-success@test.local", password: "password-123" }),
    });
    const { mfaToken } = (await loginRes.json()) as { mfaToken: string };
    const freshNewCode = await generateTotp(base32Decode(newSecret));
    const mfaLoginRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken, code: freshNewCode }),
    });
    expect(mfaLoginRes.status).toBe(200);

    // Alter Backup-Code ist danach ungültig.
    const loginRes2 = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "mfa-rot-success@test.local", password: "password-123" }),
    });
    const { mfaToken: mfaToken2 } = (await loginRes2.json()) as { mfaToken: string };
    const oldBackupRes = await SELF.fetch("https://example.test/api/login/mfa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mfaToken: mfaToken2, code: oldBackupCodes[0] }),
    });
    expect(oldBackupRes.status).toBe(401);

    // Die Sitzung auf dem "anderen Gerät" wurde durch die Rotation widerrufen.
    const otherDeviceRes = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(otherDeviceToken) });
    expect(otherDeviceRes.status).toBe(401);
  });
});
