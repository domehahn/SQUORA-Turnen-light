import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

function isoDaysFromNow(delta: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function insertSubstituteRequest(input: {
  groupId: string;
  sessionDate: string;
  requestedBy: string;
  status?: string;
  claimedBy?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO substitute_requests (id, group_id, session_date, requested_by, status, claimed_by, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.groupId,
      input.sessionDate,
      input.requestedBy,
      input.status ?? "open",
      input.claimedBy ?? null,
      input.claimedBy ? "2020-01-01 00:00:00" : null
    )
    .run();
  return id;
}

describe("Vertretungsbörse: verstrichene Termine", () => {
  it("verstrichener offener Termin ist nicht mehr im Marktplatz und nicht übernehmbar", async () => {
    const club = await seedClub("Expiry Club A");
    const owner = await seedUser({ email: "exp-owner@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "exp-sub@test.local", password: "password-123", clubId: club.id, isSpringer: true });
    const group = await seedGroup({ name: "Expiry Gruppe", ownerId: owner.id, clubId: club.id });

    const ownerC = await login(SELF, "exp-owner@test.local", "password-123");
    const subC = await login(SELF, "exp-sub@test.local", "password-123");

    const pastId = await insertSubstituteRequest({
      groupId: group.id,
      sessionDate: isoDaysFromNow(-2),
      requestedBy: owner.id,
    });

    // Nicht mehr im "offene Anfragen"-Marktplatz.
    const open = await (await SELF.fetch(`${BASE}/api/substitute-requests/open`, {
      headers: { Cookie: subC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string }[]>();
    expect(open.find((r) => r.id === pastId)).toBeUndefined();

    // Übernehmen schlägt mit 409 fehl.
    const claim = await SELF.fetch(`${BASE}/api/substitute-requests/${pastId}/claim`, {
      method: "POST",
      headers: authHeaders(subC),
      body: "{}",
    });
    expect(claim.status).toBe(409);

    // Zukünftiger Termin bleibt übernehmbar.
    const futureId = await insertSubstituteRequest({
      groupId: group.id,
      sessionDate: isoDaysFromNow(7),
      requestedBy: owner.id,
    });
    const okClaim = await SELF.fetch(`${BASE}/api/substitute-requests/${futureId}/claim`, {
      method: "POST",
      headers: authHeaders(subC),
      body: "{}",
    });
    expect(okClaim.status).toBe(200);

    void ownerC;
  });

  it("Termin-Absage durch den Trainer löscht alle Vertretungs-Anfragen dazu komplett", async () => {
    const club = await seedClub("Expiry Club B");
    const owner = await seedUser({ email: "canc-owner@test.local", password: "password-123", clubId: club.id });
    const group = await seedGroup({ name: "Canc Gruppe", ownerId: owner.id, clubId: club.id });

    const ownerC = await login(SELF, "canc-owner@test.local", "password-123");

    const date = isoDaysFromNow(5);
    const claimedId = await insertSubstituteRequest({
      groupId: group.id,
      sessionDate: date,
      requestedBy: owner.id,
      status: "open",
    });

    const cancel = await SELF.fetch(`${BASE}/api/attendance/${group.id}/${date}/cancel`, {
      method: "POST",
      headers: authHeaders(ownerC),
      body: JSON.stringify({ reason: "Ferien" }),
    });
    expect(cancel.status).toBe(200);

    // Weg aus /mine (des Trainers) ...
    const mine = await (await SELF.fetch(`${BASE}/api/substitute-requests/mine`, {
      headers: { Cookie: ownerC, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string }[]>();
    expect(mine.find((r) => r.id === claimedId)).toBeUndefined();

    // ... und endgültig aus der DB (kein Archiv).
    const row = await env.DB.prepare("SELECT id FROM substitute_requests WHERE id = ?").bind(claimedId).first();
    expect(row).toBeNull();
  });
});
