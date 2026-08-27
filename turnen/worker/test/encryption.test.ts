import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

// Application-Level Encryption für personenbezogene Kontaktdaten (Finding
// PRIV-02 für Notfallkontakte, P1 "FAMILY FIELD ENCRYPTION" für Familien-
// Kontaktdaten, externe Production-Readiness-Prüfung 2026-08-27) - prüft
// explizit, dass die Werte tatsächlich verschlüsselt in D1 landen (nicht
// nur, dass die API sie korrekt zurückgibt).
describe("Application-Level Encryption (at rest)", () => {
  it("Notfallkontakte eines Kindes liegen verschlüsselt in D1, die API liefert den Klartext zurück", async () => {
    const club = await seedClub("Verein Encryption Child");
    await seedUser({ email: "enc-child@test.local", password: "password-123", clubId: club.id });
    const token = await login(SELF, "enc-child@test.local", "password-123");

    const createRes = await SELF.fetch("https://example.test/api/children", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: "Max",
        lastName: "Mustermann",
        birthDate: "2018-01-01",
        groupId: null,
        emergencyContactName: "Erika Mustermann",
        emergencyContactPhone: "0170 1234567",
        familyId: null,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; emergencyContactName: string; emergencyContactPhone: string };
    expect(created.emergencyContactName).toBe("Erika Mustermann");
    expect(created.emergencyContactPhone).toBe("0170 1234567");

    const row = await env.DB.prepare("SELECT emergency_contact_name, emergency_contact_phone FROM children WHERE id = ?")
      .bind(created.id)
      .first<{ emergency_contact_name: string; emergency_contact_phone: string }>();
    expect(row!.emergency_contact_name).not.toBe("Erika Mustermann");
    expect(row!.emergency_contact_name).not.toContain("Erika");
    expect(row!.emergency_contact_name).toMatch(/^v1:/);
    expect(row!.emergency_contact_phone).not.toContain("0170");
    expect(row!.emergency_contact_phone).toMatch(/^v1:/);
  });

  it("Familien-Kontaktdaten liegen verschlüsselt in D1, die API liefert den Klartext zurück", async () => {
    const club = await seedClub("Verein Encryption Family");
    await seedUser({ email: "enc-family@test.local", password: "password-123", clubId: club.id });
    const token = await login(SELF, "enc-family@test.local", "password-123");

    const createRes = await SELF.fetch("https://example.test/api/families", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Familie Geheim",
        contactName: "Erika Geheim",
        contactPhone: "0170 9999999",
        contactEmail: "erika@geheim.example",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      contactName: string;
      contactPhone: string;
      contactEmail: string;
    };
    expect(created.contactName).toBe("Erika Geheim");
    expect(created.contactPhone).toBe("0170 9999999");
    expect(created.contactEmail).toBe("erika@geheim.example");

    const row = await env.DB.prepare("SELECT contact_name, contact_phone, contact_email FROM families WHERE id = ?")
      .bind(created.id)
      .first<{ contact_name: string; contact_phone: string; contact_email: string }>();
    expect(row!.contact_name).not.toContain("Erika");
    expect(row!.contact_name).toMatch(/^v1:/);
    expect(row!.contact_phone).not.toContain("9999999");
    expect(row!.contact_phone).toMatch(/^v1:/);
    expect(row!.contact_email).not.toContain("geheim");
    expect(row!.contact_email).toMatch(/^v1:/);

    // GET /api/families liefert nach dem Anlegen ebenfalls den Klartext.
    const listRes = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(token) });
    const families = (await listRes.json()) as { id: string; contactEmail: string }[];
    expect(families.find((f) => f.id === created.id)?.contactEmail).toBe("erika@geheim.example");
  });

  it("historischer Klartext-Bestand (vor Einführung der Verschlüsselung) bleibt lesbar", async () => {
    // Simuliert eine Familie, die vor der Verschlüsselungs-Einführung
    // angelegt wurde - contact_email liegt im Klartext, ohne "v1:"-Präfix.
    const club = await seedClub("Verein Legacy Plaintext");
    const creator = await seedUser({ email: "legacy-plaintext-creator@test.local", password: "password-123", clubId: club.id });
    const familyId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO families (id, name, contact_name, contact_phone, contact_email, created_by, club_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(familyId, "Familie Alt-Bestand", "Alter Kontakt", "0170 1111111", "alt@bestand.example", creator.id, club.id)
      .run();

    const token = await login(SELF, "legacy-plaintext-creator@test.local", "password-123");
    const listRes = await SELF.fetch("https://example.test/api/families", { headers: authHeaders(token) });
    const families = (await listRes.json()) as { id: string; contactEmail: string; contactName: string }[];
    const found = families.find((f) => f.id === familyId);
    expect(found?.contactEmail).toBe("alt@bestand.example");
    expect(found?.contactName).toBe("Alter Kontakt");
  });
});
