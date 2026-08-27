import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// CSRF Defense-in-Depth (externe Production-Readiness-Prüfung 2026-08-27):
// SameSite=Strict schützt bereits gegen die meisten Cross-Site-Requests,
// zusätzlich prüft der Server bei zustandsändernden Methoden explizit
// Origin/Sec-Fetch-Site.
describe("CSRF Defense-in-Depth (Origin-/Sec-Fetch-Site-Prüfung)", () => {
  it("POST mit fremdem Origin wird abgelehnt, obwohl das Session-Cookie gültig ist", async () => {
    await seedUser({ email: "csrf-foreign-origin@test.local", password: "password-123" });
    const cookie = await login(SELF, "csrf-foreign-origin@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/notifications/read-all", {
      method: "POST",
      headers: { ...authHeaders(cookie), Origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  it("POST mit fremdem Sec-Fetch-Site (cross-site) wird abgelehnt, auch ohne Origin-Header", async () => {
    await seedUser({ email: "csrf-foreign-fetch-site@test.local", password: "password-123" });
    const cookie = await login(SELF, "csrf-foreign-fetch-site@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/notifications/read-all", {
      method: "POST",
      headers: { ...authHeaders(cookie), "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("POST vom eigenen Frontend-Origin wird weiterhin akzeptiert", async () => {
    await seedUser({ email: "csrf-own-origin@test.local", password: "password-123" });
    const cookie = await login(SELF, "csrf-own-origin@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/notifications/read-all", {
      method: "POST",
      headers: { ...authHeaders(cookie), Origin: "https://example.test" },
    });
    expect(res.status).toBe(200);
  });

  it("GET wird unabhängig vom Origin nie blockiert (nur zustandsändernde Methoden)", async () => {
    await seedUser({ email: "csrf-get-unaffected@test.local", password: "password-123" });
    const cookie = await login(SELF, "csrf-get-unaffected@test.local", "password-123");

    const res = await SELF.fetch("https://example.test/api/me", {
      headers: { ...authHeaders(cookie), Origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
  });
});
