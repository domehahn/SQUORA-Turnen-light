import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/db";
import { ensureMigrated, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Stundennachweis blendet abgesagte Termine aus", () => {
  it("zählt einen als 'Turnen fällt aus' markierten Termin weder im Export noch in der Gesamtübersicht", async () => {
    const club = await seedClub("Hours Export Club");
    const owner = await seedUser({
      email: "hours-export@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "member",
    });
    const group = await seedGroup({ name: "Hours Export Group", ownerId: owner.id, clubId: club.id });

    const held = crypto.randomUUID();
    const cancelled = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO attendance_sessions (id, group_id, session_date, start_time, end_time, led_by, cancelled) VALUES (?, ?, date('now', '-7 days'), '17:00', '18:00', ?, 0)"
    )
      .bind(held, group.id, owner.id)
      .run();
    await env.DB.prepare(
      "INSERT INTO attendance_sessions (id, group_id, session_date, start_time, end_time, led_by, cancelled, cancel_reason) VALUES (?, ?, date('now', '-3 days'), '17:00', '18:00', ?, 1, 'Turnen fällt aus')"
    )
      .bind(cancelled, group.id, owner.id)
      .run();

    const from = (await env.DB.prepare("SELECT date('now', '-30 days') AS d").first<{ d: string }>())!.d;
    const to = (await env.DB.prepare("SELECT date('now') AS d").first<{ d: string }>())!.d;

    const heldDate = (await env.DB.prepare("SELECT session_date FROM attendance_sessions WHERE id = ?").bind(held).first<{ session_date: string }>())!.session_date;

    const exportRows = await db.listSessionsForExport(env.DB, [group.id], from, to);
    expect(exportRows).toHaveLength(1);
    expect(exportRows[0].sessionDate).toBe(heldDate);

    const ledRows = await db.listAllLedSessionsForUser(env.DB, owner.id);
    expect(ledRows).toHaveLength(1);
  });
});
