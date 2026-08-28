import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedUser } from "./helpers";
import { signPasswordResetToken, signAccountSetupToken } from "../src/auth";
import { base32Decode, generateTotp } from "../src/totp";

beforeAll(async () => {
  await ensureMigrated();
});

describe("P1-2 Account Setup Token Flow", () => {
  it("Admin legt User an -> kein Passwort in E-Mail/Antwort -> Activation Flow via account_setup Token", async () => {
    // 1. Admin Login & MFA Setup (Platform-Admins require MFA for /api/admin/*)
    const adminEmail = "setup-admin@test.local";
    await seedUser({ email: adminEmail, password: "password-123", isAdmin: true });
    const adminToken = await login(SELF, adminEmail, "password-123");
    const setupRes = await SELF.fetch("https://example.test/api/me/mfa/setup", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ password: "password-123" }),
    });
    const { secret } = (await setupRes.json()) as { secret: string };
    const code = await generateTotp(base32Decode(secret));
    await SELF.fetch("https://example.test/api/me/mfa/confirm", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ code }),
    });

    // 2. Admin ruft POST /api/admin/users ohne Passwort auf
    const newUserEmail = "new-member@test.local";
    const createRes = await SELF.fetch("https://example.test/api/admin/users", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({ email: newUserEmail, name: "Neues Mitglied", clubRole: "member" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { id: string; email: string };
    expect(createBody.id).toBeTruthy();
    expect(createBody.email).toBe(newUserEmail);

    // Login vor Aktivierung schlägt fehl
    const failLogin = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ email: newUserEmail, password: "password-123" }),
    });
    expect(failLogin.status).toBe(401);

    // 3. Generiere gültigen setupToken und ungültige Typtrennung-Tests
    const setupToken = await signAccountSetupToken(createBody.id, env.JWT_SECRET);
    const resetToken = await signPasswordResetToken(createBody.id, env.JWT_SECRET);

    // Typtrennung: account_setup Token darf NICHT bei password-reset/confirm funktionieren
    const crossRes1 = await SELF.fetch("https://example.test/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ token: setupToken, newPassword: "secure-new-password-123" }),
    });
    expect(crossRes1.status).toBe(401);

    // Typtrennung: password_reset Token darf NICHT bei account-setup/confirm funktionieren
    const crossRes2 = await SELF.fetch("https://example.test/api/account-setup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ token: resetToken, newPassword: "secure-new-password-123" }),
    });
    expect(crossRes2.status).toBe(401);

    // 4. Richtige Aktivierung via account-setup/confirm
    const confirmRes = await SELF.fetch("https://example.test/api/account-setup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ token: setupToken, newPassword: "secure-new-password-123" }),
    });
    expect(confirmRes.status).toBe(200);

    // 5. Zweiter Versuch mit demselben Token schlägt fehl (Single-Use JTI)
    const reuseRes = await SELF.fetch("https://example.test/api/account-setup/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ token: setupToken, newPassword: "another-password-123" }),
    });
    expect(reuseRes.status).toBe(401);

    // 6. Login mit neu gesetztem Passwort funktioniert
    const successLogin = await login(SELF, newUserEmail, "secure-new-password-123");
    expect(successLogin).toBeTruthy();
  });
});
