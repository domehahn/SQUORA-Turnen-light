import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Geräte- & Mängelmelder und Helfer-Aufgaben API", () => {
  it("Trainer kann Gerätemeldung erstellen und auslesen", async () => {
    const club = await seedClub("Equipment Club 1");
    await seedUser({
      email: "trainer-eq1@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const token = await login(SELF, "trainer-eq1@test.local", "password-12345");

    // 1. Auslesen (zunächst leer)
    const listRes1 = await SELF.fetch("https://example.test/api/equipment-reports", {
      headers: authHeaders(token),
    });
    expect(listRes1.status).toBe(200);
    expect(await listRes1.json()).toEqual([]);

    // 2. Mängelmeldung erstellen
    const createRes = await SELF.fetch("https://example.test/api/equipment-reports", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Sprungbrett Feder defekt",
        location: "Halle 1, Geräteraum links",
        severity: "high",
        description: "Rechte äußere Feder ist gerissen, Verletzungsgefahr!",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as any;
    expect(created.title).toBe("Sprungbrett Feder defekt");
    expect(created.severity).toBe("high");
    expect(created.status).toBe("open");

    // 3. Auslesen
    const listRes2 = await SELF.fetch("https://example.test/api/equipment-reports", {
      headers: authHeaders(token),
    });
    const list = (await listRes2.json()) as any[];
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);
  });

  it("Jugendleitung kann Status einer Gerätemeldung auf in_progress/resolved setzen und löschen", async () => {
    const club = await seedClub("Equipment Club 2");
    await seedUser({
      email: "jl-eq2@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const token = await login(SELF, "jl-eq2@test.local", "password-12345");

    const createRes = await SELF.fetch("https://example.test/api/equipment-reports", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Weichbodenmatte Naht offen",
        severity: "medium",
      }),
    });
    const report = (await createRes.json()) as any;

    // Status auf in_progress ändern
    const updateRes = await SELF.fetch(`https://example.test/api/equipment-reports/${report.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as any;
    expect(updated.status).toBe("in_progress");

    // Löschen
    const delRes = await SELF.fetch(`https://example.test/api/equipment-reports/${report.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(delRes.status).toBe(200);
  });

  it("Jugendleiter kann Trainer mit konkreter Aufgabe zum Event zuteilen", async () => {
    const club = await seedClub("Equipment Club 3");
    await seedUser({
      email: "jl-task@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const jlToken = await login(SELF, "jl-task@test.local", "password-12345");

    const { id: trainerId } = await seedUser({
      email: "trainer-task@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });

    const createEvRes = await SELF.fetch("https://example.test/api/events", {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        title: "Sommerfest 2026",
        eventDate: "2026-08-20",
        requiredTrainers: 3,
        tasks: "Parcours 1, Hüpfburg, Urkunden",
      }),
    });
    const event = (await createEvRes.json()) as any;

    // Zuteilen mit Aufgabe "Betreuung Hüpfburg"
    const assignRes = await SELF.fetch(`https://example.test/api/events/${event.id}/assign`, {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        userId: trainerId,
        assignedTask: "Betreuung Hüpfburg",
      }),
    });

    expect(assignRes.status).toBe(200);
    const updatedEv = (await assignRes.json()) as any;
    expect(updatedEv.helpers.length).toBe(1);
    expect(updatedEv.helpers[0].userId).toBe(trainerId);
    expect(updatedEv.helpers[0].assignedTask).toBe("Betreuung Hüpfburg");
  });
});
