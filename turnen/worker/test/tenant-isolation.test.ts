import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedChild, seedClub, seedFamily, seedGroup, seedUser } from "./helpers";

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

// Zweiter P0-Fix (externe Production-Readiness-Prüfung 2026-08-27, Migration
// 0039): families hatte keine eigene club_id, die Mandantengrenze wurde
// dynamisch über created_by -> user.club_id berechnet - ein Vereinswechsel
// der anlegenden Person hätte die Familie (und ihre über Kinder verknüpften
// Notfallkontakte) logisch mit in den neuen Verein wandern lassen.
describe("Cross-Tenant-Isolation bei Familien (P0)", () => {
  it("Verein A sieht eine Familie aus Verein B NICHT in der Familienliste", async () => {
    const clubA = await seedClub("Verein Family A");
    const clubB = await seedClub("Verein Family B");
    const creatorB = await seedUser({ email: "family-creator-b@test.local", password: "password-123", clubId: clubB.id });
    await seedUser({ email: "family-a@test.local", password: "password-123", clubId: clubA.id });
    await seedFamily({ name: "Familie B", createdBy: creatorB.id, clubId: clubB.id });

    const tokenA = await login(SELF, "family-a@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(tokenA) });
    const families = (await res.json()) as { name: string }[];
    expect(families.some((f) => f.name === "Familie B")).toBe(false);
  });

  it("eine Familie bleibt bei ihrem ursprünglichen Verein, auch wenn die anlegende Person den Verein wechselt", async () => {
    const clubA = await seedClub("Verein Family Switch A");
    const clubB = await seedClub("Verein Family Switch B");
    const creator = await seedUser({ email: "family-switcher@test.local", password: "password-123", clubId: clubA.id });
    await seedFamily({ name: "Familie Switch", createdBy: creator.id, clubId: clubA.id });

    // Die anlegende Person wechselt jetzt (z.B. als Trainer*in) zu Verein B.
    const { env } = await import("cloudflare:test");
    await env.DB.prepare("UPDATE users SET club_id = ? WHERE id = ?").bind(clubB.id, creator.id).run();

    // Verein B (neuer Verein der Person) sieht die alte Familie NICHT.
    await seedUser({ email: "family-other-b@test.local", password: "password-123", clubId: clubB.id });
    const tokenB = await login(SELF, "family-other-b@test.local", "password-123");
    const resB = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(tokenB) });
    const familiesB = (await resB.json()) as { name: string }[];
    expect(familiesB.some((f) => f.name === "Familie Switch")).toBe(false);

    // Verein A (ursprünglicher Verein) sieht sie weiterhin.
    await seedUser({ email: "family-other-a@test.local", password: "password-123", clubId: clubA.id });
    const tokenA = await login(SELF, "family-other-a@test.local", "password-123");
    const resA = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(tokenA) });
    const familiesA = (await resA.json()) as { name: string }[];
    expect(familiesA.some((f) => f.name === "Familie Switch")).toBe(true);
  });

  it("ein Kind aus Verein B kann NICHT mit einer Familie aus Verein A verknüpft werden (manipulierte familyId)", async () => {
    const clubA = await seedClub("Verein Family Link A");
    const clubB = await seedClub("Verein Family Link B");
    const creatorA = await seedUser({ email: "family-link-creator-a@test.local", password: "password-123", clubId: clubA.id });
    await seedUser({ email: "family-link-b@test.local", password: "password-123", clubId: clubB.id });
    const familyA = await seedFamily({ name: "Familie Link A", createdBy: creatorA.id, clubId: clubA.id });
    const childB = await seedChild({ firstName: "Kind", lastName: "B", groupId: null, clubId: clubB.id });

    const tokenB = await login(SELF, "family-link-b@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${childB.id}/family`, {
      method: "PUT",
      headers: authHeaders(tokenB),
      body: JSON.stringify({ familyId: familyA.id }),
    });
    expect(res.status).toBe(403);
  });

  it("ein Kind kann mit einer Familie desselben Vereins verknüpft werden", async () => {
    const club = await seedClub("Verein Family Link OK");
    const creator = await seedUser({ email: "family-link-ok-creator@test.local", password: "password-123", clubId: club.id });
    const family = await seedFamily({ name: "Familie OK", createdBy: creator.id, clubId: club.id });
    const child = await seedChild({ firstName: "Kind", lastName: "OK", groupId: null, clubId: club.id });

    const token = await login(SELF, "family-link-ok-creator@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}/family`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ familyId: family.id }),
    });
    expect(res.status).toBe(200);
  });
});
