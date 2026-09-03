import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

describe("Springer-Rolle", () => {
  it("Jugendleitung kann ein Mitglied ohne Gruppe zum Springer machen und wieder zurück", async () => {
    const club = await seedClub("Springer Club A");
    await seedUser({ email: "jl-a@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    const member = await seedUser({ email: "member-a@test.local", password: "password-123", clubId: club.id });
    const jl = await login(SELF, "jl-a@test.local", "password-123");

    const make = await SELF.fetch(`${BASE}/api/clubs/mine/members/${member.id}/make-springer`, {
      method: "POST",
      headers: authHeaders(jl),
      body: "{}",
    });
    expect(make.status).toBe(200);

    const members = await (await SELF.fetch(`${BASE}/api/clubs/mine/members`, { headers: authHeaders(jl) })).json<
      { id: string; role: string; isSpringer: number }[]
    >();
    const row = members.find((m) => m.id === member.id);
    expect(row?.isSpringer).toBe(1);
    expect(row?.role).toBe("member");

    const unset = await SELF.fetch(`${BASE}/api/clubs/mine/members/${member.id}/unset-springer`, {
      method: "POST",
      headers: authHeaders(jl),
      body: "{}",
    });
    expect(unset.status).toBe(200);
  });

  it("verweigert make-springer, wenn die Person noch eine Gruppe leitet", async () => {
    const club = await seedClub("Springer Club B");
    await seedUser({ email: "jl-b@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    const owner = await seedUser({ email: "owner-b@test.local", password: "password-123", clubId: club.id });
    await seedGroup({ name: "Gruppe B", ownerId: owner.id, clubId: club.id });
    const jl = await login(SELF, "jl-b@test.local", "password-123");

    const res = await SELF.fetch(`${BASE}/api/clubs/mine/members/${owner.id}/make-springer`, {
      method: "POST",
      headers: authHeaders(jl),
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("Springer:innen können keine eigene Gruppe anlegen", async () => {
    const club = await seedClub("Springer Club C");
    await seedUser({ email: "springer-c@test.local", password: "password-123", clubId: club.id, isSpringer: true });
    const cookie = await login(SELF, "springer-c@test.local", "password-123");

    const res = await SELF.fetch(`${BASE}/api/groups`, {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({
        name: "Verbotene Gruppe",
        minAge: 3,
        maxAge: 6,
        sortOrder: 0,
        maxChildren: 10,
        weekday: 1,
        startTime: "17:00",
        endTime: "18:00",
        location: "Halle",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("Springer:innen können nicht als Mit-Trainer:in eingetragen werden", async () => {
    const club = await seedClub("Springer Club D");
    const owner = await seedUser({ email: "owner-d@test.local", password: "password-123", clubId: club.id });
    const springer = await seedUser({
      email: "springer-d@test.local",
      password: "password-123",
      clubId: club.id,
      isSpringer: true,
    });
    const group = await seedGroup({ name: "Gruppe D", ownerId: owner.id, clubId: club.id });
    const ownerCookie = await login(SELF, "owner-d@test.local", "password-123");

    const res = await SELF.fetch(`${BASE}/api/groups/${group.id}/co-leaders`, {
      method: "POST",
      headers: authHeaders(ownerCookie),
      body: JSON.stringify({ userId: springer.id }),
    });
    expect(res.status).toBe(400);
  });
});
