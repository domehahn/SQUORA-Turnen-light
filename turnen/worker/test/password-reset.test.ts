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
