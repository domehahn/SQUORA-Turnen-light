import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, enableMfaForTest, ensureMigrated, login, seedChild, seedClub, seedGroup, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Automatisierte negative Autorisierungstests (Finding SEC-08,
// PRIVACY_SECURITY_GAP_ANALYSIS.md Abschnitt 24 der Ursprungsanfrage) -
// jeder Test prüft, dass ein Zugriff, der NICHT erlaubt sein soll, auch
// wirklich verweigert wird (IDOR/BOLA/Cross-Tenant/Privilege Escalation).
// Läuft in echtem Workers-Runtime (workerd) gegen eine isolierte, pro
// Testlauf frisch migrierte In-Memory-D1 - keine Berührung von
// Produktionsdaten.

describe("Authentifizierung", () => {
  it("verweigert Zugriff ohne Token", async () => {
    const res = await SELF.fetch("https://example.test/api/children");
    expect(res.status).toBe(401);
  });

  it("verweigert Zugriff mit ungültigem/manipuliertem Token", async () => {
    const res = await SELF.fetch("https://example.test/api/children", {
      headers: { Authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("verweigert falsches Passwort", async () => {
    await seedUser({ email: "auth-wrong-pw@test.local", password: "correct-password-123" });
    const res = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "auth-wrong-pw@test.local", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("Rate Limiting (SEC-01)", () => {
  it("sperrt nach 10 fehlgeschlagenen Versuchen mit HTTP 429", async () => {
    const email = "rate-limit-test@test.local";
    await seedUser({ email, password: "correct-password-123" });

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch("https://example.test/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "wrong-password" }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(401); // die ersten 10 sind normale Fehlversuche

    const blocked = await SELF.fetch("https://example.test/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-password-123" }), // sogar mit korrektem Passwort
    });
    expect(blocked.status).toBe(429);
  });
});

describe("Cross-Tenant-Isolation (Vereine)", () => {
  it("Turnleiter A kann keine Kinder in eine fremde Gruppe aus Verein B anlegen", async () => {
    const clubA = await seedClub("Verein A");
    const clubB = await seedClub("Verein B");
    await seedUser({ email: "coach-a@test.local", password: "password-123", clubId: clubA.id, clubRole: "member" });
    const userB = await seedUser({ email: "coach-b@test.local", password: "password-123", clubId: clubB.id, clubRole: "member" });
    const groupB = await seedGroup({ name: "Gruppe B", ownerId: userB.id, clubId: clubB.id });

    const tokenA = await login(SELF, "coach-a@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/children", {
      method: "POST",
      headers: authHeaders(tokenA),
      body: JSON.stringify({
        firstName: "Test",
        lastName: "Kind",
        birthDate: "2020-01-01",
        groupId: groupB.id,
        notes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("Turnleiter A sieht keine Gruppe, die einem anderen Verein gehört und ihm nicht zugeordnet ist", async () => {
    const clubA = await seedClub("Verein A2");
    const clubB = await seedClub("Verein B2");
    await seedUser({ email: "coach-a2@test.local", password: "password-123", clubId: clubA.id, clubRole: "member" });
    const userB = await seedUser({ email: "coach-b2@test.local", password: "password-123", clubId: clubB.id, clubRole: "member" });
    const groupB = await seedGroup({ name: "Fremde Gruppe", ownerId: userB.id, clubId: clubB.id });

    const tokenA = await login(SELF, "coach-a2@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/groups", { headers: authHeaders(tokenA) });
    expect(res.status).toBe(200);
    const groups = (await res.json()) as { id: string }[];
    expect(groups.some((g) => g.id === groupB.id)).toBe(false);
  });
});

describe("IDOR/BOLA bei Kindern", () => {
  it("Turnleiter kann ein Kind einer fremden Gruppe nicht bearbeiten (manipulierte ID)", async () => {
    const club = await seedClub("Verein C");
    const owner = await seedUser({ email: "owner-c@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    await seedUser({ email: "outsider-c@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe C", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Max", lastName: "Mustermann", groupId: group.id });

    const outsiderToken = await login(SELF, "outsider-c@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "PUT",
      headers: authHeaders(outsiderToken),
      body: JSON.stringify({
        firstName: "Manipuliert",
        lastName: "Mustermann",
        birthDate: "2020-01-01",
        groupId: group.id,
        notes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("Turnleiter kann ein Kind einer fremden Gruppe nicht löschen (manipulierte ID)", async () => {
    const club = await seedClub("Verein D");
    const owner = await seedUser({ email: "owner-d@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    await seedUser({ email: "outsider-d@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe D", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Erika", lastName: "Musterfrau", groupId: group.id });

    const outsiderToken = await login(SELF, "outsider-d@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "DELETE",
      headers: authHeaders(outsiderToken),
    });
    expect(res.status).toBe(403);

    // Kind existiert danach noch (nichts wurde geloescht).
    const ownerToken = await login(SELF, "owner-d@test.local", "password-123");
    const listRes = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(ownerToken) });
    const children = (await listRes.json()) as { id: string }[];
    expect(children.some((c) => c.id === child.id)).toBe(true);
  });

  it("Jugendleitung (und damit die Admin-Rolle, die sich als Jugendleitung einwechselt) DARF ein Kind einer fremden Gruppe im selben Verein bearbeiten", async () => {
    const club = await seedClub("Verein E");
    const owner = await seedUser({ email: "owner-e@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    await seedUser({
      email: "leadership-e@test.local",
      password: "password-123",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const group = await seedGroup({ name: "Gruppe E", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Tom", lastName: "Beispiel", groupId: group.id });

    const leadershipToken = await login(SELF, "leadership-e@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "PUT",
      headers: authHeaders(leadershipToken),
      body: JSON.stringify({
        firstName: "Tom",
        lastName: "Beispiel-Bearbeitet",
        birthDate: "2020-01-01",
        groupId: group.id,
        notes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("Jugendleitung eines ANDEREN Vereins darf ein Kind trotzdem nicht bearbeiten (kein pauschaler Jugendleitung-Bypass)", async () => {
    const clubE = await seedClub("Verein F1");
    const clubOther = await seedClub("Verein F2");
    const owner = await seedUser({ email: "owner-f@test.local", password: "password-123", clubId: clubE.id, clubRole: "member" });
    await seedUser({
      email: "foreign-leadership-f@test.local",
      password: "password-123",
      clubId: clubOther.id,
      clubRole: "jugendleiter",
    });
    const group = await seedGroup({ name: "Gruppe F", ownerId: owner.id, clubId: clubE.id });
    const child = await seedChild({ firstName: "Nina", lastName: "Beispiel", groupId: group.id });

    const foreignToken = await login(SELF, "foreign-leadership-f@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/children/${child.id}`, {
      method: "PUT",
      headers: authHeaders(foreignToken),
      body: JSON.stringify({
        firstName: "Manipuliert",
        lastName: "Beispiel",
        birthDate: "2020-01-01",
        groupId: group.id,
        notes: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        familyId: null,
      }),
    });
    expect(res.status).toBe(403);
  });
});

// Least-Privilege-Härtung (externe Production-Readiness-Prüfung
// 2026-08-27): die vereinsweite Kinderliste enthielt bisher für jedes
// zurückgegebene Kind auch die Notfallkontakte, unabhängig davon, ob die
// anfragende Person eine Beziehung zur jeweiligen Gruppe hat.
describe("Least Privilege bei Notfallkontakten in der Kinderliste", () => {
  it("ein Turnleiter sieht die Notfallkontakte eines Kindes einer fremden Gruppe im selben Verein NICHT", async () => {
    const club = await seedClub("Verein Least-Privilege A");
    const owner = await seedUser({ email: "lp-owner@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    await seedUser({ email: "lp-outsider@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe LP", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Max", lastName: "LP", groupId: group.id, clubId: club.id });
    await env.DB.prepare("UPDATE children SET emergency_contact_name = ?, emergency_contact_phone = ? WHERE id = ?")
      .bind("Erika Mustermann", "0170 1234567", child.id)
      .run();

    const outsiderToken = await login(SELF, "lp-outsider@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(outsiderToken) });
    const children = (await res.json()) as { id: string; emergencyContactName: string | null; emergencyContactPhone: string | null }[];
    const seen = children.find((c) => c.id === child.id);
    expect(seen).toBeDefined();
    expect(seen!.emergencyContactName).toBeNull();
    expect(seen!.emergencyContactPhone).toBeNull();
  });

  it("die Gruppenleitung selbst sieht die Notfallkontakte ihrer eigenen Gruppe weiterhin", async () => {
    const club = await seedClub("Verein Least-Privilege B");
    const owner = await seedUser({ email: "lp-owner-b@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    const group = await seedGroup({ name: "Gruppe LP B", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Erika", lastName: "LP-B", groupId: group.id, clubId: club.id });
    await env.DB.prepare("UPDATE children SET emergency_contact_name = ? WHERE id = ?").bind("Kontakt B", child.id).run();

    const ownerToken = await login(SELF, "lp-owner-b@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(ownerToken) });
    const children = (await res.json()) as { id: string; emergencyContactName: string | null }[];
    expect(children.find((c) => c.id === child.id)?.emergencyContactName).toBe("Kontakt B");
  });

  it("die Jugendleitung sieht Notfallkontakte club-weit, auch für fremde Gruppen", async () => {
    const club = await seedClub("Verein Least-Privilege C");
    const owner = await seedUser({ email: "lp-owner-c@test.local", password: "password-123", clubId: club.id, clubRole: "member" });
    await seedUser({ email: "lp-leader-c@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    const group = await seedGroup({ name: "Gruppe LP C", ownerId: owner.id, clubId: club.id });
    const child = await seedChild({ firstName: "Max", lastName: "LP-C", groupId: group.id, clubId: club.id });
    await env.DB.prepare("UPDATE children SET emergency_contact_name = ? WHERE id = ?").bind("Kontakt C", child.id).run();

    const leaderToken = await login(SELF, "lp-leader-c@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/children", { headers: authHeaders(leaderToken) });
    const children = (await res.json()) as { id: string; emergencyContactName: string | null }[];
    expect(children.find((c) => c.id === child.id)?.emergencyContactName).toBe("Kontakt C");
  });
});

describe("Admin-Rolle (Privilege Escalation)", () => {
  it("normaler Nutzer kann keine Admin-Routen aufrufen", async () => {
    await seedUser({ email: "not-admin@test.local", password: "password-123" });
    const token = await login(SELF, "not-admin@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/admin/clubs", { headers: authHeaders(token) });
    expect(res.status).toBe(403);
  });

  it("normaler Nutzer kann sich nicht selbst zum Admin machen", async () => {
    const user = await seedUser({ email: "escalate@test.local", password: "password-123" });
    const token = await login(SELF, "escalate@test.local", "password-123");
    const res = await SELF.fetch(`https://example.test/api/admin/users/${user.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ isAdmin: true }),
    });
    expect(res.status).toBe(403);
  });

  // Admin-Routen liegen hinter requireAuth, das für is_admin ohne aktivierte
  // MFA blockt (s. test/mfa.test.ts, "MFA-Zwang für Platform-Admin") - MFA
  // hier vorab einrichten, sonst würde dieser Test aus dem falschen Grund
  // (MFA-Sperre statt der eigentlich geprüften Admin-Berechtigung) bestehen.
  it("Admin-Rolle kann Admin-Routen aufrufen (mit aktivierter MFA)", async () => {
    await seedUser({ email: "real-admin@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "real-admin@test.local", "password-123");
    await enableMfaForTest(token, "password-123");
    const res = await SELF.fetch("https://example.test/api/admin/clubs", { headers: authHeaders(token) });
    expect(res.status).toBe(200);
  });

  it("Admin-Rolle OHNE aktivierte MFA wird von Admin-Routen blockiert (MFA ist für is_admin verpflichtend, s. mfa.test.ts)", async () => {
    await seedUser({ email: "admin-no-mfa@test.local", password: "password-123", isAdmin: true });
    const token = await login(SELF, "admin-no-mfa@test.local", "password-123");
    const res = await SELF.fetch("https://example.test/api/admin/clubs", { headers: authHeaders(token) });
    expect(res.status).toBe(403);
  });
});

describe("Sofortiger Zugriffsverlust bei gelöschtem Account", () => {
  it("ein Token für einen gelöschten Nutzer wird sofort abgelehnt", async () => {
    const user = await seedUser({ email: "will-be-deleted@test.local", password: "password-123" });
    const token = await login(SELF, "will-be-deleted@test.local", "password-123");

    const before = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    expect(before.status).toBe(200);

    const { env } = await import("cloudflare:test");
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();

    const after = await SELF.fetch("https://example.test/api/me", { headers: authHeaders(token) });
    expect(after.status).toBe(401);
  });
});
