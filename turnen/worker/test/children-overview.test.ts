import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

function get(cookie: string, path: string) {
  return SELF.fetch(`${BASE}${path}`, { headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } });
}

describe("Kinder-Gesamtübersicht (/api/children/overview)", () => {
  it("liefert vereinsweit alle Kinder für Jugendleitung, Kassenwart:in und Admin - nicht für einfache Mitglieder", async () => {
    const club = await seedClub("Übersicht Club");
    const other = await seedClub("Fremd Club");

    const jl = await seedUser({ email: "jl-ov@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    await seedUser({ email: "kw-ov@test.local", password: "password-123", clubId: club.id, isKassenwart: true });
    await seedUser({ email: "member-ov@test.local", password: "password-123", clubId: club.id });
    const otherOwner = await seedUser({ email: "own-ov@test.local", password: "password-123", clubId: other.id });

    const groupA = await seedGroup({ name: "Gruppe A", ownerId: jl.id, clubId: club.id });
    const groupOther = await seedGroup({ name: "Fremd", ownerId: otherOwner.id, clubId: other.id });

    await seedChild({ firstName: "Anna", lastName: "Müller", groupId: groupA.id, clubId: club.id });
    await seedChild({ firstName: "Ben", lastName: "Schmidt", groupId: null, clubId: club.id });
    await seedChild({ firstName: "Cara", lastName: "Fremd", groupId: groupOther.id, clubId: other.id });

    const jlCookie = await login(SELF, "jl-ov@test.local", "password-123");
    const kwCookie = await login(SELF, "kw-ov@test.local", "password-123");
    const memberCookie = await login(SELF, "member-ov@test.local", "password-123");

    const jlRes = await get(jlCookie, "/api/children/overview");
    expect(jlRes.status).toBe(200);
    const jlRows = await jlRes.json<{ lastName: string; groupName: string | null }[]>();
    expect(jlRows.map((r) => r.lastName).sort()).toEqual(["Müller", "Schmidt"]);
    expect(jlRows.find((r) => r.lastName === "Müller")?.groupName).toBe("Gruppe A");
    expect(jlRows.find((r) => r.lastName === "Schmidt")?.groupName).toBeNull();

    const kwRes = await get(kwCookie, "/api/children/overview");
    expect(kwRes.status).toBe(200);
    expect(await kwRes.json<unknown[]>()).toHaveLength(2);

    // Einfaches Mitglied ohne Zusatzrolle: kein Zugriff.
    const memberRes = await get(memberCookie, "/api/children/overview");
    expect(memberRes.status).toBe(403);
  });
});
