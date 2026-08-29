import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Events & Helfer-Zuteilung API", () => {
  it("gibt leere Liste zurück, wenn noch keine Events vorhanden sind", async () => {
    const club = await seedClub("Events Club 1");
    await seedUser({
      email: "trainer1@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const token = await login(SELF, "trainer1@events.test", "password-12345");

    const res = await SELF.fetch("https://example.test/api/events", {
      headers: authHeaders(token),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("Jugendleitung kann Events mit Aufgaben und Materialien erstellen", async () => {
    const club = await seedClub("Events Club 2");
    await seedUser({
      email: "jl@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const token = await login(SELF, "jl@events.test", "password-12345");

    const res = await SELF.fetch("https://example.test/api/events", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Sommerspiele Pausenaktion",
        description: "Rahmenprogramm beim Jugendturnier",
        eventDate: "2026-07-15",
        startTime: "14:00",
        endTime: "17:30",
        location: "Sportplatz Rasen 2",
        requiredTrainers: 3,
        tasks: "Parcours aufbauen, Betreuung Hüpfburg, Urkunden",
        materials: "Turnmatten, Stoppuhr, Bälle, Urkunden",
      }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as any;
    expect(created.title).toBe("Sommerspiele Pausenaktion");
    expect(created.requiredTrainers).toBe(3);
    expect(created.tasks).toContain("Hüpfburg");
    expect(created.materials).toContain("Turnmatten");
    expect(created.helpers).toEqual([]);
  });

  it("Turntrainer oder Gruppenleiter kann ein Event erstellen und selbst verwalten", async () => {
    const club = await seedClub("Events Club 3");
    await seedUser({
      email: "trainer-member@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const token = await login(SELF, "trainer-member@events.test", "password-12345");

    const res = await SELF.fetch("https://example.test/api/events", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Trainingstag",
        eventDate: "2026-07-15",
      }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as any;
    expect(created.title).toBe("Trainingstag");

    const updateRes = await SELF.fetch(`https://example.test/api/events/${created.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "Aktualisierter Trainingstag" }),
    });
    expect(updateRes.status).toBe(200);
    expect(((await updateRes.json()) as any).title).toBe("Aktualisierter Trainingstag");

    const deleteRes = await SELF.fetch(`https://example.test/api/events/${created.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(deleteRes.status).toBe(204);
  });

  it("Trainer kann sich als Helfer melden und Meldung zurückziehen", async () => {
    const club = await seedClub("Events Club 4");
    await seedUser({
      email: "jl4@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const jlToken = await login(SELF, "jl4@events.test", "password-12345");

    const createRes = await SELF.fetch("https://example.test/api/events", {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        title: "Turnier Pausenaktion",
        eventDate: "2026-08-01",
        requiredTrainers: 2,
      }),
    });
    const event = (await createRes.json()) as any;

    const { id: trainerId } = await seedUser({
      email: "helfer1@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const trainerToken = await login(SELF, "helfer1@events.test", "password-12345");

    // Sich als Helfer melden
    const regRes = await SELF.fetch(`https://example.test/api/events/${event.id}/register`, {
      method: "POST",
      headers: authHeaders(trainerToken),
      body: JSON.stringify({}),
    });

    expect(regRes.status).toBe(200);
    const regEvent = (await regRes.json()) as any;
    expect(regEvent.helpers.length).toBe(1);
    expect(regEvent.helpers[0].userId).toBe(trainerId);
    expect(regEvent.isRegistered).toBe(true);

    // Meldung zurückziehen
    const unregRes = await SELF.fetch(`https://example.test/api/events/${event.id}/register`, {
      method: "POST",
      headers: authHeaders(trainerToken),
      body: JSON.stringify({ unregister: true }),
    });

    expect(unregRes.status).toBe(200);
    const unregEvent = (await unregRes.json()) as any;
    expect(unregEvent.helpers.length).toBe(0);
    expect(unregEvent.isRegistered).toBe(false);
  });

  it("Jugendleitung kann Trainer direkt zuweisen und Zuweisung aufheben", async () => {
    const club = await seedClub("Events Club 5");
    await seedUser({
      email: "jl5@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const jlToken = await login(SELF, "jl5@events.test", "password-12345");

    const { id: targetTrainerId } = await seedUser({
      email: "target-trainer@events.test",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });

    const createRes = await SELF.fetch("https://example.test/api/events", {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        title: "Sommerfest Betreuung",
        eventDate: "2026-08-10",
        requiredTrainers: 4,
      }),
    });
    const event = (await createRes.json()) as any;

    // Jugendleiter teilt Trainer zu
    const assignRes = await SELF.fetch(`https://example.test/api/events/${event.id}/assign`, {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({ userId: targetTrainerId }),
    });

    expect(assignRes.status).toBe(200);
    const assignedEvent = (await assignRes.json()) as any;
    expect(assignedEvent.helpers.length).toBe(1);
    expect(assignedEvent.helpers[0].userId).toBe(targetTrainerId);

    // Zuweisung aufheben
    const unassignRes = await SELF.fetch(`https://example.test/api/events/${event.id}/assign`, {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({ userId: targetTrainerId, unassign: true }),
    });

    expect(unassignRes.status).toBe(200);
    const unassignedEvent = (await unassignRes.json()) as any;
    expect(unassignedEvent.helpers.length).toBe(0);
  });
});
