import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as db from "../src/db";
import { ensureMigrated, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Anwesenheitsstatistik", () => {
  it("liefert Prozentwerte und begrenzt eine Auswertung auf den angeforderten Zeitraum", async () => {
    const club = await seedClub("Attendance Stats Club");
    const owner = await seedUser({
      email: "attendance-stats@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "member",
    });
    const group = await seedGroup({ name: "Attendance Stats Group", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Quote", lastName: "Kind", groupId: group.id, clubId: club.id });

    const sessions = [
      { offset: "-2 days", present: 1, cancelled: 0 },
      { offset: "-10 days", present: 0, cancelled: 0 },
      { offset: "-30 days", present: 0, cancelled: 0 },
      { offset: "-80 days", present: 0, cancelled: 0 },
      { offset: "-100 days", present: 1, cancelled: 0 },
      { offset: "+1 day", present: 1, cancelled: 0 },
      { offset: "-5 days", present: 1, cancelled: 1 },
    ];

    for (const session of sessions) {
      const sessionId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO attendance_sessions (id, group_id, session_date, cancelled) VALUES (?, ?, date('now', ?), ?)"
      )
        .bind(sessionId, group.id, session.offset, session.cancelled)
        .run();
      await env.DB.prepare("INSERT INTO attendance_entries (session_id, child_id, present) VALUES (?, ?, ?)")
        .bind(sessionId, child.id, session.present)
        .run();
    }

    const range = await env.DB.prepare(
      "SELECT date('now', '-89 days') AS fromDate, date('now') AS toDate"
    ).first<{ fromDate: string; toDate: string }>();
    expect(range).not.toBeNull();

    const stats = await db.getAttendanceStats(env.DB, owner.id, club.id, range!.fromDate, range!.toDate);
    expect(stats.childrenStats[child.id]).toEqual({
      presentCount: 1,
      totalRecorded: 4,
      quote: 25,
      isInactive: true,
    });

    const ownGroupStats = await db.getAttendanceStats(env.DB, owner.id, null, range!.fromDate, range!.toDate);
    expect(ownGroupStats.childrenStats[child.id]).toEqual(stats.childrenStats[child.id]);
  });
});
