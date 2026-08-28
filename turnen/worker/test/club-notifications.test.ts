import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedGroup, seedUser } from "./helpers";

interface StoredNotification {
  type: string;
  title: string;
  body: string;
  child_id: string | null;
}

async function notificationsFor(userId: string): Promise<StoredNotification[]> {
  const { results } = await env.DB.prepare(
    "SELECT type, title, body, child_id FROM notifications WHERE user_id = ? ORDER BY created_at ASC"
  )
    .bind(userId)
    .all<StoredNotification>();
  return results;
}

beforeAll(async () => {
  await ensureMigrated();
});

describe("Vereinsweite Benachrichtigungen", () => {
  it("meldet Anlegen, Verschieben, Austritt und Löschen eines Kindes im gesamten Verein", async () => {
    const club = await seedClub("Benachrichtigungsverein Kinder");
    const actor = await seedUser({
      email: "notifications-actor@example.com",
      password: "StrongPassword123!",
      name: "Alex Aktion",
      clubId: club.id,
    });
    const observer = await seedUser({
      email: "notifications-observer@example.com",
      password: "StrongPassword123!",
      name: "Olivia Beobachtung",
      clubId: club.id,
    });
    const firstGroup = await seedGroup({ name: "Erste Gruppe", ownerId: actor.id, clubId: club.id });
    const secondGroup = await seedGroup({ name: "Zweite Gruppe", ownerId: actor.id, clubId: club.id });
    const cookie = await login(SELF, "notifications-actor@example.com", "StrongPassword123!");

    const createRes = await SELF.fetch("https://example.test/api/children", {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({
        firstName: "Klara",
        lastName: "Komet",
        birthDate: "2020-01-01",
        groupId: firstGroup.id,
      }),
    });
    expect(createRes.status).toBe(201);
    const child = (await createRes.json()) as { id: string };
    expect(await notificationsFor(observer.id)).toEqual([
      expect.objectContaining({ type: "club_child_created", title: "Kind neu hinzugefügt", body: expect.stringContaining("Klara Komet") }),
    ]);

    const moveRes = await SELF.fetch(`https://example.test/api/children/${child.id}/move`, {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({ toGroupId: secondGroup.id }),
    });
    expect(moveRes.status).toBe(200);
    expect(await notificationsFor(observer.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "club_child_moved",
          body: "Klara Komet wurde von „Erste Gruppe“ nach „Zweite Gruppe“ verschoben.",
        }),
      ])
    );

    const archiveRes = await SELF.fetch(`https://example.test/api/children/${child.id}/archive`, {
      method: "POST",
      headers: authHeaders(cookie),
    });
    expect(archiveRes.status).toBe(200);
    expect(await notificationsFor(observer.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "club_child_archived", title: "Kind ausgetreten", body: expect.stringContaining("Klara Komet") }),
      ])
    );

    const deleteRes = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "DELETE",
      headers: authHeaders(cookie),
    });
    expect(deleteRes.status).toBe(204);

    // Kind-bezogene ältere Meldungen werden beim Hard-Delete entfernt. Der
    // gewünschte, datenarme Löschhinweis bleibt ohne FK zum Kind sichtbar.
    expect(await notificationsFor(observer.id)).toEqual([
      {
        type: "club_child_deleted",
        title: "Kind gelöscht",
        body: "Klara Komet wurde endgültig gelöscht.",
        child_id: null,
      },
    ]);
  });

  it("meldet Vertretungsanfragen und tatsächlich geänderte Termine nur im zugehörigen Verein", async () => {
    const club = await seedClub("Benachrichtigungsverein Termine");
    const otherClub = await seedClub("Fremder Verein");
    const actor = await seedUser({
      email: "notifications-sessions-actor@example.com",
      password: "StrongPassword123!",
      name: "Theo Trainer",
      clubId: club.id,
    });
    const observer = await seedUser({
      email: "notifications-sessions-observer@example.com",
      password: "StrongPassword123!",
      name: "Vera Verein",
      clubId: club.id,
    });
    const outsider = await seedUser({
      email: "notifications-outsider@example.com",
      password: "StrongPassword123!",
      name: "Frieda Fremd",
      clubId: otherClub.id,
    });
    const group = await seedGroup({ name: "Termin-Gruppe", ownerId: actor.id, clubId: club.id });
    const cookie = await login(SELF, "notifications-sessions-actor@example.com", "StrongPassword123!");

    const substituteRes = await SELF.fetch("https://example.test/api/substitute-requests", {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({ groupId: group.id, date: "2026-09-02", note: "Fortbildung" }),
    });
    expect(substituteRes.status).toBe(201);

    const attendanceRes = await SELF.fetch(`https://example.test/api/attendance/${group.id}/2026-09-02`, {
      method: "PUT",
      headers: authHeaders(cookie),
      body: JSON.stringify({ entries: [], startTime: "18:30", endTime: "20:00", location: "Neue Halle" }),
    });
    expect(attendanceRes.status).toBe(200);

    for (const userId of [actor.id, observer.id]) {
      expect(await notificationsFor(userId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "substitute_request", title: "Vertretung gesucht für „Termin-Gruppe“" }),
          expect.objectContaining({
            type: "club_session_rescheduled",
            title: "Termin geändert: „Termin-Gruppe“",
            body: expect.stringContaining("Neue Halle"),
          }),
        ])
      );
    }
    expect(await notificationsFor(outsider.id)).toEqual([]);
  });
});
