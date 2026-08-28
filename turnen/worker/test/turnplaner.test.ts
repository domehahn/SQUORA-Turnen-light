import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Turnplaner & Hallen-Aufbauplaner API", () => {
  it("Übungsleiter kann Hallenaufbau erstellen, auslesen und löschen", async () => {
    const club = await seedClub("Turnplaner Club 1");
    await seedUser({
      email: "trainer-tp1@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const token = await login(SELF, "trainer-tp1@test.local", "password-12345");

    // 1. Liste zunächst leer
    const listRes1 = await SELF.fetch("https://example.test/api/training-plans", {
      headers: authHeaders(token),
    });
    expect(listRes1.status).toBe(200);
    expect(await listRes1.json()).toEqual([]);

    // 2. Hallenaufbau erstellen
    const createRes = await SELF.fetch("https://example.test/api/training-plans", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Wettkampf-Aufbau Kür D-Stufe",
        description: "Standardaufbau für die Samstags-Gruppe",
        canvasData: {
          equipment: [
            { id: "eq1", type: "schwebebalken", label: "Station 1 Balken", x: 20, y: 30, rotation: 0 },
            { id: "eq2", type: "weichboden", label: "Landematte Balken", x: 20, y: 55, rotation: 0 },
            { id: "eq3", type: "sprungbrett", label: "Sprungbrett Aufgang", x: 10, y: 30, rotation: 90 },
          ],
          generalNotes: "Sicherheitsabstand zur Sprossenwand beachten",
        },
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as any;
    expect(created.title).toBe("Wettkampf-Aufbau Kür D-Stufe");
    expect(created.canvasData.equipment.length).toBe(3);

    // 3. Auslesen
    const listRes2 = await SELF.fetch("https://example.test/api/training-plans", {
      headers: authHeaders(token),
    });
    const list = (await listRes2.json()) as any[];
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    // 4. Löschen
    const delRes = await SELF.fetch(`https://example.test/api/training-plans/${created.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(delRes.status).toBe(200);
  });
});
