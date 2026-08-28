import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(ensureMigrated);

describe("Vereinswarteliste: eindeutige Kandidaten", () => {
  it("zeigt weder zugeordnete noch bereits auf einer Gruppen-Warteliste stehende Kinder an", async () => {
    const club = await seedClub("Wartelistenverein");
    const email = `waitlist-${crypto.randomUUID()}@example.com`;
    const user = await seedUser({ email, password: "Correct-Horse-Battery-99", clubId: club.id });
    const group = await seedGroup({ name: "Große Turnen", ownerId: user.id, clubId: club.id });
    const assigned = await seedChild({ firstName: "Bereits", lastName: "Zugeordnet", groupId: group.id, clubId: club.id });
    const groupWaiting = await seedChild({ firstName: "Gruppen", lastName: "Warteliste", groupId: null, clubId: club.id });
    const eligible = await seedChild({ firstName: "Vereins", lastName: "Kandidat", groupId: null, clubId: club.id });
    await env.DB.prepare(
      "INSERT INTO waitlist_entries (id, group_id, child_id, requested_by) VALUES (?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), group.id, groupWaiting.id, user.id).run();
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");

    const candidates = await SELF.fetch("https://example.test/api/club-waitlist/candidates", { headers: authHeaders(cookie) });
    expect(candidates.status).toBe(200);
    const rows = await candidates.json<{ id: string }[]>();
    expect(rows.map((row) => row.id)).toEqual([eligible.id]);

    for (const childId of [assigned.id, groupWaiting.id]) {
      const response = await SELF.fetch("https://example.test/api/club-waitlist", {
        method: "POST", headers: authHeaders(cookie), body: JSON.stringify({ childId }),
      });
      expect(response.status).toBe(409);
    }
  });

  it("schließt einen Vereinswartelisten-Eintrag beim späteren Gruppenwechsel automatisch ab", async () => {
    const club = await seedClub("Wechselverein");
    const email = `move-waitlist-${crypto.randomUUID()}@example.com`;
    const user = await seedUser({ email, password: "Correct-Horse-Battery-99", clubId: club.id });
    const group = await seedGroup({ name: "Zielgruppe", ownerId: user.id, clubId: club.id });
    const child = await seedChild({ firstName: "Noch", lastName: "Gruppenlos", groupId: null, clubId: club.id });
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");

    const added = await SELF.fetch("https://example.test/api/club-waitlist", {
      method: "POST", headers: authHeaders(cookie), body: JSON.stringify({ childId: child.id }),
    });
    expect(added.status).toBe(201);
    const moved = await SELF.fetch(`https://example.test/api/children/${child.id}/move`, {
      method: "POST", headers: authHeaders(cookie), body: JSON.stringify({ toGroupId: group.id }),
    });
    expect(moved.status).toBe(200);
    const row = await env.DB.prepare("SELECT status FROM club_waitlist_entries WHERE child_id = ?").bind(child.id).first<{ status: string }>();
    expect(row?.status).toBe("placed");
  });
});

describe("Kind-Neuanlage: vorhandenes gruppenloses Kind", () => {
  it("liefert einen Zuordnungsvorschlag statt einen doppelten Datensatz anzulegen", async () => {
    const club = await seedClub("Duplikatverein");
    const email = `duplicate-${crypto.randomUUID()}@example.com`;
    const user = await seedUser({ email, password: "Correct-Horse-Battery-99", clubId: club.id });
    const group = await seedGroup({ name: "Turn-Entdecker", ownerId: user.id, clubId: club.id });
    const existing = await seedChild({ firstName: "Anna", lastName: "Beispiel", groupId: null, clubId: club.id });
    await env.DB.prepare("UPDATE children SET birth_date = '2020-05-10' WHERE id = ?").bind(existing.id).run();
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");

    const response = await SELF.fetch("https://example.test/api/children", {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({
        firstName: " anna ",
        lastName: "BEISPIEL",
        birthDate: "2020-05-10",
        groupId: group.id,
        emergencyContactName: null,
        emergencyContactPhone: null,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "unassigned_child_duplicate",
      existingChildId: existing.id,
      targetGroupId: group.id,
      targetGroupName: "Turn-Entdecker",
    });
    const count = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM children WHERE club_id = ? AND lower(trim(first_name)) = 'anna' AND lower(trim(last_name)) = 'beispiel' AND birth_date = '2020-05-10'"
    ).bind(club.id).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
