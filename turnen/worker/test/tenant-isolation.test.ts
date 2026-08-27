import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// P0-Fix (externe Production-Readiness-Prüfung 2026-08-27): ein Kind ohne
// Gruppe (z.B. frisch auf der Vereins-Warteliste) war vorher für JEDEN
// authentifizierten Nutzer sichtbar und bearbeitbar, unabhängig vom Verein -
// die Sichtbarkeitsprüfung behandelte "keine Gruppe" fälschlich als
// "für alle offen". children.club_id ist jetzt die primäre Mandantengrenze.
describe("Cross-Tenant-Isolation bei gruppenlosen Kindern (P0)", () => {
  it("Turnleiter A sieht ein gruppenloses Kind aus Verein B NICHT in der Kinderliste", async () => {
    const clubA = await seedClub("Verein Groupless A");
    const clubB = await seedClub("Verein Groupless B");
    await seedUser({ email: "groupless-a@test.local", password: "password-123", clubId: clubA.id, clubRole: "member" });
    await seedChild({ firstName: "Warteliste", lastName: "KindB", groupId: null, clubId: clubB.id });

    const tokenA = await login(SELF, "groupless-a@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(tokenA) });
    const children = (await res.json()) as { id: string; firstName: string }[];
    expect(children.some((c) => c.firstName === "Warteliste")).toBe(false);
  });

  it("Turnleiter A kann ein gruppenloses Kind aus Verein B NICHT bearbeiten (manipulierte ID)", async () => {
    const clubA = await seedClub("Verein Groupless C");
    const clubB = await seedClub("Verein Groupless D");
    await seedUser({ email: "groupless-c@test.local", password: "password-123", clubId: clubA.id, clubRole: "member" });
    const child = await seedChild({ firstName: "Fremd", lastName: "KindD", groupId: null, clubId: clubB.id });

    const tokenA = await login(SELF, "groupless-c@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "PUT",
      headers: authHeaders(tokenA),
      body: JSON.stringify({
        firstName: "Manipuliert",
        lastName: "KindD",
        birthDate: "2020-01-01",
        groupId: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("Mitglied desselben Vereins sieht und bearbeitet ein gruppenloses Kind des eigenen Vereins", async () => {
    const club = await seedClub("Verein Groupless E");
    await seedUser({ email: "groupless-e@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const child = await seedChild({ firstName: "Eigenes", lastName: "KindE", groupId: null, clubId: club.id });

    const token = await login(SELF, "groupless-e@test.local", "password-123");
    const listRes = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(token) });
    const children = (await listRes.json()) as { id: string; firstName: string }[];
    expect(children.some((c) => c.id === child.id)).toBe(true);

    const putRes = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: "Eigenes",
        lastName: "KindE-Bearbeitet",
        birthDate: "2020-01-01",
        groupId: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(putRes.status).toBe(200);
  });

  it("neu angelegtes gruppenloses Kind bekommt automatisch das club_id des anlegenden Vereins", async () => {
    const clubA = await seedClub("Verein Groupless F");
    const clubB = await seedClub("Verein Groupless G");
    await seedUser({ email: "groupless-f@test.local", password: "password-123", clubId: clubA.id, clubRole: "member" });
    await seedUser({ email: "groupless-g@test.local", password: "password-123", clubId: clubB.id, clubRole: "member" });

    const tokenA = await login(SELF, "groupless-f@test.local", "password-123");
    const createRes = await SELF.fetch("https://example.test/api/children", {
      method: "POST",
      headers: authHeaders(tokenA),
      body: JSON.stringify({
        firstName: "Neu",
        lastName: "Angelegt",
        birthDate: "2020-01-01",
        groupId: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    // Verein B (fremd) darf das neue Kind nicht sehen.
    const tokenB = await login(SELF, "groupless-g@test.local", "password-123");
    const listResB = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(tokenB) });
    const childrenB = (await listResB.json()) as { id: string }[];
    expect(childrenB.some((c) => c.id === created.id)).toBe(false);

    // Verein A (eigen) sieht es.
    const listResA = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(tokenA) });
    const childrenA = (await listResA.json()) as { id: string }[];
    expect(childrenA.some((c) => c.id === created.id)).toBe(true);
  });
});

// BOLA-Fix bei der Anwesenheitserfassung (Production-Readiness-Prüfung
// 2026-08-27): eine syntaktisch gültige UUID war keine Autorisierung - der
// Server prüfte nie, ob die übermittelte childId überhaupt zur Zielgruppe
// gehört.
describe("BOLA-Schutz bei der Anwesenheitserfassung", () => {
  it("lehnt eine Anwesenheitsmeldung für ein Kind einer fremden Gruppe ab", async () => {
    const club = await seedClub("Verein Attendance BOLA");
    const owner = await seedUser({ email: "bola-owner@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe BOLA", ownerId: owner.id, clubId: club.id });
    const otherGroup = await seedGroup({ name: "Andere Gruppe BOLA", ownerId: owner.id, clubId: club.id });
    const foreignChild = await seedChild({ firstName: "Fremd", lastName: "Kind", groupId: otherGroup.id, clubId: club.id });

    const token = await login(SELF, "bola-owner@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/attendance/${group.id}/2020-01-06`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ entries: [{ childId: foreignChild.id, present: true }] }),
    });
    expect(res.status).toBe(403);
  });

  it("akzeptiert eine Anwesenheitsmeldung für ein Kind der richtigen Gruppe", async () => {
    const club = await seedClub("Verein Attendance OK");
    const owner = await seedUser({ email: "bola-ok@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe OK", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Richtig", lastName: "Kind", groupId: group.id, clubId: club.id });

    const token = await login(SELF, "bola-ok@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/attendance/${group.id}/2020-01-06`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ entries: [{ childId: child.id, present: true }] }),
    });
    expect(res.status).toBe(200);
  });

  it("lehnt eine fremde User-ID als ledBy ab (nicht Mitglied desselben Vereins)", async () => {
    const club = await seedClub("Verein LedBy");
    const otherClub = await seedClub("Verein LedBy Fremd");
    const owner = await seedUser({ email: "ledby-owner@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const stranger = await seedUser({ email: "ledby-stranger@test.local", password: "password-123", clubId: otherClub.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe LedBy", ownerId: owner.id, clubId: club.id });

    const token = await login(SELF, "ledby-owner@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/attendance/${group.id}/2020-01-06`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ entries: [], ledBy: stranger.id }),
    });
    expect(res.status).toBe(400);
  });
});
