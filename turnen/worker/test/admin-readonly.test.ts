import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, enableMfaForTest, ensureMigrated, login, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

describe("Plattform-Admin: alles sehen, nichts bearbeiten", () => {
  it("Admin liest Vereinsdaten wie die Jugendleitung, Schreibzugriff auf Vereinsdaten ist gesperrt", async () => {
    const club = await seedClub("Readonly Admin Club");
    const owner = await seedUser({ email: "ro-owner@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "ro-admin@test.local", password: "password-123", clubId: club.id, isAdmin: true });
    const group = await seedGroup({ name: "RO Gruppe", ownerId: owner.id, clubId: club.id });

    const admin = await login(SELF, "ro-admin@test.local", "password-123");
    await enableMfaForTest(admin, "password-123");

    // Lesen: club-weite Endpunkte, die sonst nur die Jugendleitung sieht
    for (const path of [
      "/api/substitute-requests/club",
      "/api/club-join-requests/incoming",
      "/api/capacity-requests/incoming",
      "/api/session-override-requests/incoming",
      "/api/hours-report/submissions",
      "/api/clubs/mine/members",
    ]) {
      const res = await SELF.fetch(`${BASE}${path}`, { headers: { Cookie: admin, "Sec-Fetch-Site": "same-origin" } });
      expect(res.status, path).toBe(200);
    }

    // Schreiben auf Vereinsdaten: gesperrt
    const createGroup = await SELF.fetch(`${BASE}/api/groups`, {
      method: "POST",
      headers: authHeaders(admin),
      body: JSON.stringify({
        name: "X", minAge: 3, maxAge: 6, sortOrder: 0, maxChildren: 10, weekday: 1,
        startTime: "17:00", endTime: "18:00", location: "H",
      }),
    });
    expect(createGroup.status).toBe(403);

    const promote = await SELF.fetch(`${BASE}/api/clubs/mine/members/${owner.id}/promote`, {
      method: "POST",
      headers: authHeaders(admin),
      body: "{}",
    });
    expect(promote.status).toBe(403);

    const cancel = await SELF.fetch(`${BASE}/api/attendance/${group.id}/2026-03-04/cancel`, {
      method: "POST",
      headers: authHeaders(admin),
      body: JSON.stringify({ reason: "x" }),
    });
    expect(cancel.status).toBe(403);

    // Konto-/Plattform-Verwaltung bleibt erlaubt
    const listUsers = await SELF.fetch(`${BASE}/api/admin/users`, {
      headers: { Cookie: admin, "Sec-Fetch-Site": "same-origin" },
    });
    expect(listUsers.status).toBe(200);

    const updateProfile = await SELF.fetch(`${BASE}/api/me`, {
      method: "PUT",
      headers: authHeaders(admin),
      body: JSON.stringify({ name: "Admin RO", email: "ro-admin@test.local" }),
    });
    expect(updateProfile.status).toBe(200);
  });
});
