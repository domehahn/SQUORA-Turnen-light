import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

function futureIso(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

describe("Anstehende Vertretungen (/api/substitute-requests/upcoming)", () => {
  it("zeigt offene UND übernommene Anfragen ab heute, mit status", async () => {
    const club = await seedClub("Upcoming Subs Club");
    const owner = await seedUser({ email: "up-owner@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "up-spr@test.local", password: "password-123", clubId: club.id, isSpringer: true });
    const group = await seedGroup({ name: "Upcoming Gruppe", ownerId: owner.id, clubId: club.id });

    const ownerC = await login(SELF, "up-owner@test.local", "password-123");
    const sprC = await login(SELF, "up-spr@test.local", "password-123");

    const date = futureIso(14);
    const reqId = (await (await SELF.fetch(`${BASE}/api/substitute-requests`, {
      method: "POST",
      headers: authHeaders(ownerC),
      body: JSON.stringify({ groupId: group.id, date, note: "" }),
    })).json<{ id: string }>()).id;

    // offen -> taucht als status "open" auf
    let upcoming = await (await SELF.fetch(`${BASE}/api/substitute-requests/upcoming`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string; status: string }[]>();
    expect(upcoming.find((r) => r.id === reqId)?.status).toBe("open");

    // übernommen -> status "claimed"
    await SELF.fetch(`${BASE}/api/substitute-requests/${reqId}/claim`, {
      method: "POST",
      headers: authHeaders(sprC),
      body: "{}",
    });
    upcoming = await (await SELF.fetch(`${BASE}/api/substitute-requests/upcoming`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string; status: string; claimedByName: string | null }[]>();
    expect(upcoming.find((r) => r.id === reqId)?.status).toBe("claimed");
  });
});
