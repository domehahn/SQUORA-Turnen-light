import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { enableMfaForTest, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

function get(cookie: string, path: string) {
  return SELF.fetch(`${BASE}${path}`, { headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } });
}

describe("Saisonwechsel-Vorschläge: Leserechte", () => {
  it("Jugendleitung und Plattform-Admin dürfen lesen, einfache Mitglieder nicht", async () => {
    const club = await seedClub("Saison Club");
    await seedUser({ email: "jl-st@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    await seedUser({ email: "member-st@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "admin-st@test.local", password: "password-123", clubId: club.id, isAdmin: true });

    const jl = await login(SELF, "jl-st@test.local", "password-123");
    const member = await login(SELF, "member-st@test.local", "password-123");
    const admin = await login(SELF, "admin-st@test.local", "password-123");
    await enableMfaForTest(admin, "password-123");

    const path = "/api/season-transition/proposals?referenceDate=2026-08-01";
    expect((await get(jl, path)).status).toBe(200);
    expect((await get(admin, path)).status).toBe(200);
    expect((await get(member, path)).status).toBe(403);
  });
});
