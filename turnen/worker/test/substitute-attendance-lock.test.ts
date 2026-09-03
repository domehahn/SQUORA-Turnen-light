import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";
const DATE = "2026-03-04"; // Mittwoch
const WEEKDAY = new Date(`${DATE}T00:00:00Z`).getUTCDay();

describe("Vertretung sperrt die Anwesenheit für die ursprüngliche Leitung", () => {
  it("übergibt Erfassung + Stunde an die Vertretung, sperrt die Original-Leitung", async () => {
    const club = await seedClub("Vertretungs-Lock Club");
    const owner = await seedUser({ email: "owner-vl@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "spr-vl@test.local", password: "password-123", clubId: club.id, isSpringer: true });
    const group = await seedGroup({ name: "Gruppe VL", ownerId: owner.id, clubId: club.id });
    await env.DB.prepare("UPDATE groups SET weekday = ?, start_time = '17:00', end_time = '18:30' WHERE id = ?")
      .bind(WEEKDAY, group.id)
      .run();
    const child = await seedChild({ firstName: "Kind", lastName: "VL", groupId: group.id, clubId: club.id });

    const ownerC = await login(SELF, "owner-vl@test.local", "password-123");
    const sprC = await login(SELF, "spr-vl@test.local", "password-123");

    // Original-Leitung kann zunächst normal erfassen
    const before = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${DATE}`, {
      method: "PUT",
      headers: authHeaders(ownerC),
      body: JSON.stringify({ entries: [{ childId: child.id, present: true }], ledBy: owner.id }),
    });
    expect(before.status).toBe(200);

    // Vertretung anlegen + vom Springer übernehmen lassen
    const reqRes = await SELF.fetch(`${BASE}/api/substitute-requests`, {
      method: "POST",
      headers: authHeaders(ownerC),
      body: JSON.stringify({ groupId: group.id, date: DATE, note: "krank" }),
    });
    expect(reqRes.status).toBe(201);
    const reqId = (await reqRes.json<{ id: string }>()).id;

    // Vor der Übernahme: Status "open" - Hinweis, aber keine Sperre
    const openInfo = await (await SELF.fetch(
      `${BASE}/api/attendance-substitutes/${group.id}?from=${DATE}&to=${DATE}`,
      { headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" } }
    )).json<Record<string, { status: string }>>();
    expect(openInfo[DATE]?.status).toBe("open");
    const stillEditable = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${DATE}`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    });
    expect(stillEditable.status).toBe(200);

    const claim = await SELF.fetch(`${BASE}/api/substitute-requests/${reqId}/claim`, {
      method: "POST",
      headers: authHeaders(sprC),
      body: "{}",
    });
    expect(claim.status).toBe(200);

    // Jetzt ist die Original-Leitung gesperrt ...
    const ownerGet = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${DATE}`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    });
    expect(ownerGet.status).toBe(403);
    const ownerPut = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${DATE}`, {
      method: "PUT",
      headers: authHeaders(ownerC),
      body: JSON.stringify({ entries: [{ childId: child.id, present: false }], ledBy: owner.id }),
    });
    expect(ownerPut.status).toBe(403);

    // ... und sieht den Grund über /attendance-substitutes
    const subInfo = await (await SELF.fetch(
      `${BASE}/api/attendance-substitutes/${group.id}?from=${DATE}&to=${DATE}`,
      { headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" } }
    )).json<Record<string, { status: string; claimedByName: string | null }>>();
    expect(subInfo[DATE]?.status).toBe("claimed");

    // Die Vertretung darf erfassen
    const sprPut = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${DATE}`, {
      method: "PUT",
      headers: authHeaders(sprC),
      body: JSON.stringify({ entries: [{ childId: child.id, present: true }] }),
    });
    expect(sprPut.status).toBe(200);

    // Stundennachweis: die Stunde zählt für die Vertretung, nicht für die Original-Leitung
    const sprReport = await (await SELF.fetch(`${BASE}/api/hours-report?year=2026&quarter=1`, {
      headers: { Cookie: sprC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ months: { sessions: { date: string }[] }[] }>();
    const sprDates = sprReport.months.flatMap((m) => m.sessions.map((s) => s.date));
    expect(sprDates).toContain(DATE);

    const ownerReport = await (await SELF.fetch(`${BASE}/api/hours-report?year=2026&quarter=1`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ months: { sessions: { date: string }[] }[] }>();
    const ownerDates = ownerReport.months.flatMap((m) => m.sessions.map((s) => s.date));
    expect(ownerDates).not.toContain(DATE);
  });
});
