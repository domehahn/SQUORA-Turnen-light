import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyEmailWebhook, cleanupExpiredNotifications, operationsSummary } from "../src/operations";
import { authHeaders, ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(ensureMigrated);

describe("Benachrichtigungspräferenzen und Kalenderfeed", () => {
  it("speichert Kategorien und lässt Sicherheitsmails unverändert außerhalb der Auswahl", async () => {
    const email = `prefs-${crypto.randomUUID()}@example.com`;
    await seedUser({ email, password: "Correct-Horse-Battery-99" });
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");
    const update = await SELF.fetch("https://example.test/api/me/notification-preferences", {
      method: "PUT",
      headers: authHeaders(cookie),
      body: JSON.stringify({ substitutes: false, requests: true }),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ substitutes: false, requests: true, system: true });
  });

  it("erzeugt einen geheimen, widerrufbaren iCal-Link ohne Kinderdaten", async () => {
    const email = `calendar-${crypto.randomUUID()}@example.com`;
    const user = await seedUser({ email, password: "Correct-Horse-Battery-99", name: "Kalender Test" });
    const club = await seedClub("Kalenderverein");
    await env.DB.prepare("UPDATE users SET club_id = ? WHERE id = ?").bind(club.id, user.id).run();
    const group = await seedGroup({ name: "Montagsgruppe", ownerId: user.id, clubId: club.id });
    await env.DB.prepare("UPDATE groups SET weekday = 1, start_time = '17:00', end_time = '18:00', location = 'Halle' WHERE id = ?")
      .bind(group.id).run();
    const child = await seedChild({ firstName: "Nicht", lastName: "Im Kalender", groupId: group.id, clubId: club.id });
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");

    const created = await SELF.fetch("https://example.test/api/me/calendar", {
      method: "POST", headers: authHeaders(cookie), body: "{}",
    });
    expect(created.status).toBe(201);
    const { url } = await created.json<{ url: string }>();
    expect(url).toMatch(/\/api\/calendar\/feed\/[a-f0-9]{64}$/);
    const feed = await SELF.fetch(url);
    expect(feed.status).toBe(200);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    const text = await feed.text();
    expect(text).toContain("SUMMARY:Montagsgruppe");
    expect(text).not.toContain(child.id);
    expect(text).not.toContain("Nicht Im Kalender");

    const revoked = await SELF.fetch("https://example.test/api/me/calendar", { method: "DELETE", headers: authHeaders(cookie) });
    expect(revoked.status).toBe(204);
    expect((await SELF.fetch(url)).status).toBe(404);
  });
});

describe("Saisonwechsel und Zustellstatus", () => {
  it("schlägt der Jugendleitung passende Zielgruppen zum Stichtag vor", async () => {
    const club = await seedClub("Saisonverein");
    const email = `leader-${crypto.randomUUID()}@example.com`;
    const leader = await seedUser({ email, password: "Correct-Horse-Battery-99", clubId: club.id, clubRole: "jugendleiter" });
    const young = await seedGroup({ name: "Jung", ownerId: leader.id, clubId: club.id, minAge: 3, maxAge: 6 });
    const older = await seedGroup({ name: "Älter", ownerId: leader.id, clubId: club.id, minAge: 6, maxAge: 10 });
    const child = await seedChild({ firstName: "Saison", lastName: "Kind", groupId: young.id, clubId: club.id });
    await env.DB.prepare("UPDATE children SET birth_date = '2019-01-01' WHERE id = ?").bind(child.id).run();
    const cookie = await login(SELF, email, "Correct-Horse-Battery-99");
    const response = await SELF.fetch("https://example.test/api/season-transition/proposals?referenceDate=2026-08-01", { headers: authHeaders(cookie) });
    expect(response.status).toBe(200);
    const result = await response.json<{ proposals: { childId: string; candidates: { id: string }[] }[] }>();
    expect(result.proposals.find((proposal) => proposal.childId === child.id)?.candidates).toContainEqual(expect.objectContaining({ id: older.id }));
  });

  it("verarbeitet Resend-Events idempotent und stuft delivered nicht zurück", async () => {
    const deliveryId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO email_deliveries (id, category, recipient_hash, status, provider_id)
       VALUES (?, 'system', 'hash', 'sent', 'provider-test')`
    ).bind(deliveryId).run();
    expect(await applyEmailWebhook(env.DB, { eventId: "event-delivered", providerId: "provider-test", type: "email.delivered", createdAt: new Date().toISOString() })).toBe(true);
    expect(await applyEmailWebhook(env.DB, { eventId: "event-sent-late", providerId: "provider-test", type: "email.sent", createdAt: new Date().toISOString() })).toBe(true);
    expect(await applyEmailWebhook(env.DB, { eventId: "event-sent-late", providerId: "provider-test", type: "email.sent", createdAt: new Date().toISOString() })).toBe(false);
    const row = await env.DB.prepare("SELECT status FROM email_deliveries WHERE id = ?").bind(deliveryId).first<{ status: string }>();
    expect(row?.status).toBe("delivered");
  });

  it("liefert fehlgeschlagene E-Mails mit Diagnosemetadaten, aber ohne Empfänger oder Inhalt", async () => {
    const deliveryId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO email_deliveries
         (id, category, recipient_hash, status, attempt_count, retryable, last_error_code, next_retry_at)
       VALUES (?, 'substitutes', 'recipient-secret-hash', 'failed', 2, 1, 'provider_unavailable', datetime('now', '+15 minutes'))`
    ).bind(deliveryId).run();

    const summary = await operationsSummary(env.DB);
    const failed = summary.failedEmails.find((delivery) => delivery.id === deliveryId);

    expect(failed).toMatchObject({
      category: "substitutes",
      status: "failed",
      attemptCount: 2,
      retryable: true,
      lastErrorCode: "provider_unavailable",
    });
    expect(failed?.nextRetryAt).not.toBeNull();
    expect(failed).not.toHaveProperty("recipient_hash");
    expect(failed).not.toHaveProperty("payload_encrypted");
    expect(failed).not.toHaveProperty("provider_id");
  });
});

describe("Aufbewahrungsfrist für In-App-Benachrichtigungen", () => {
  it("löscht gelesene und ungelesene Meldungen nach 90 Tagen, aber keine neueren", async () => {
    const user = await seedUser({
      email: `notification-retention-${crypto.randomUUID()}@example.com`,
      password: "Correct-Horse-Battery-99",
    });
    const oldUnread = crypto.randomUUID();
    const oldRead = crypto.randomUUID();
    const recent = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, 'test', 'Alt', 'Ungelesen', datetime('now', '-91 days'))"
      ).bind(oldUnread, user.id),
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, title, body, read_at, created_at) VALUES (?, ?, 'test', 'Alt', 'Gelesen', datetime('now'), datetime('now', '-91 days'))"
      ).bind(oldRead, user.id),
      env.DB.prepare(
        "INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, 'test', 'Neu', 'Bleibt', datetime('now', '-89 days'))"
      ).bind(recent, user.id),
    ]);

    await cleanupExpiredNotifications(env.DB, 90);

    const { results } = await env.DB.prepare("SELECT id FROM notifications WHERE user_id = ? ORDER BY id")
      .bind(user.id)
      .all<{ id: string }>();
    expect(results.map((row) => row.id)).toEqual([recent]);
  });

  it("löscht bei einer ungültigen Frist sicherheitshalber nichts", async () => {
    const user = await seedUser({
      email: `notification-retention-safe-${crypto.randomUUID()}@example.com`,
      password: "Correct-Horse-Battery-99",
    });
    const notificationId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO notifications (id, user_id, type, title, body, created_at) VALUES (?, ?, 'test', 'Alt', 'Bleibt', datetime('now', '-365 days'))"
    ).bind(notificationId, user.id).run();

    await cleanupExpiredNotifications(env.DB, 0);

    const row = await env.DB.prepare("SELECT id FROM notifications WHERE id = ?").bind(notificationId).first<{ id: string }>();
    expect(row?.id).toBe(notificationId);
  });
});
