import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, seedChild, seedClub, seedGroup, seedUser } from "./helpers";
import * as db from "../src/db";

beforeAll(async () => {
  await ensureMigrated();
});

// Speicherbegrenzung für archivierte Kinder (Finding PRIV-05). Die konkrete
// Frist ist eine Konfigurationsgröße (siehe ARCHIVED_CHILD_RETENTION_DAYS)
// - hier wird nur die Mechanik geprüft: listArchivedChildrenOlderThan()
// findet ausschließlich archivierte Kinder jenseits der Frist, aktive und
// noch nicht lange genug archivierte Kinder bleiben unberührt.
describe("Retention archivierter Kinder (PRIV-05)", () => {
  it("findet nur archivierte Kinder jenseits der Frist", async () => {
    const club = await seedClub("Verein Retention");
    const owner = await seedUser({ email: "owner-retention@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe Retention", ownerId: owner.id, clubId: club.id });

    const activeChild = await seedChild({ firstName: "Aktiv", lastName: "Kind", groupId: group.id });

    const recentlyArchived = await seedChild({ firstName: "Kuerzlich", lastName: "Archiviert", groupId: group.id });
    await env.DB.prepare("UPDATE children SET status = 'archived', archived_at = datetime('now', '-10 days') WHERE id = ?")
      .bind(recentlyArchived.id)
      .run();

    const longArchived = await seedChild({ firstName: "Lange", lastName: "Archiviert", groupId: group.id });
    await env.DB.prepare("UPDATE children SET status = 'archived', archived_at = datetime('now', '-400 days') WHERE id = ?")
      .bind(longArchived.id)
      .run();

    const stale = await db.listArchivedChildrenOlderThan(env.DB, 365);
    const staleIds = stale.map((c) => c.id);
    expect(staleIds).toContain(longArchived.id);
    expect(staleIds).not.toContain(recentlyArchived.id);
    expect(staleIds).not.toContain(activeChild.id);
  });

  it("löscht ein reifes Kind vollständig inkl. Audit-Redaction, ohne fremde actor_id-FK zu verletzen", async () => {
    const club = await seedClub("Verein Retention 2");
    const owner = await seedUser({ email: "owner-retention2@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe Retention 2", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Zu", lastName: "Loeschen", groupId: group.id });
    await env.DB.prepare("UPDATE children SET status = 'archived', archived_at = datetime('now', '-400 days') WHERE id = ?")
      .bind(child.id)
      .run();

    // Simuliert genau das, was deleteStaleArchivedChildren() in index.ts tut
    // (actorId: null, da kein handelnder Nutzer bei einem automatisierten Job).
    await db.logAudit(env.DB, {
      clubId: club.id,
      actorId: null,
      actorName: "Automatische Löschung (Aufbewahrungsfrist)",
      action: "child.retention_deleted",
      targetLabel: "Test",
      childId: child.id,
    });
    await db.redactChildTraces(env.DB, child.id);
    await db.deleteChild(env.DB, child.id);

    const stillThere = await db.getChildRowById(env.DB, child.id);
    expect(stillThere).toBeNull();
  });
});
