import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

describe("Schwarzes Brett & Pinnwand API", () => {
  it("Trainer kann Beiträge erstellen und lesen", async () => {
    const club = await seedClub("Bulletin Club 1");
    await seedUser({
      email: "trainer-b1@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "member",
    });
    const token = await login(SELF, "trainer-b1@test.local", "password-12345");

    // 1. Liste zunächst leer
    const getRes1 = await SELF.fetch("https://example.test/api/bulletin-posts", {
      headers: authHeaders(token),
    });
    expect(getRes1.status).toBe(200);
    expect(await getRes1.json()).toEqual([]);

    // 2. Beitrag verfassen
    const createRes = await SELF.fetch("https://example.test/api/bulletin-posts", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "Hallenschließung in den Herbstferien",
        content: "Die Dreifachsporthalle bleibt vom 12. bis 23. Oktober wegen Wartungsarbeiten geschlossen.",
        category: "hall",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as any;
    expect(created.title).toBe("Hallenschließung in den Herbstferien");
    expect(created.category).toBe("hall");
    expect(created.isPinned).toBe(false);

    // 3. Auslesen
    const getRes2 = await SELF.fetch("https://example.test/api/bulletin-posts", {
      headers: authHeaders(token),
    });
    const list = (await getRes2.json()) as any[];
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);
  });

  it("Jugendleitung kann Beiträge anpinnen und angetackerte Beiträge erscheinen zuerst", async () => {
    const club = await seedClub("Bulletin Club 2");
    await seedUser({
      email: "jl-b2@test.local",
      password: "password-12345",
      clubId: club.id,
      clubRole: "jugendleiter",
    });
    const jlToken = await login(SELF, "jl-b2@test.local", "password-12345");

    // Normaler Beitrag zuerst
    await SELF.fetch("https://example.test/api/bulletin-posts", {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        title: "Normaler Beitrag",
        content: "Test Inhalt normal",
        category: "general",
      }),
    });

    // Angepinnter Beitrag danach
    const pinnedRes = await SELF.fetch("https://example.test/api/bulletin-posts", {
      method: "POST",
      headers: authHeaders(jlToken),
      body: JSON.stringify({
        title: "WICHTIGE MITTEILUNG",
        content: "Dringender Warnhinweis",
        category: "urgent",
        isPinned: true,
      }),
    });

    const pinnedPost = (await pinnedRes.json()) as any;
    expect(pinnedPost.isPinned).toBe(true);

    // Auslesen: Angepinnter Beitrag muss als Erstes stehen!
    const getRes = await SELF.fetch("https://example.test/api/bulletin-posts", {
      headers: authHeaders(jlToken),
    });
    const list = (await getRes.json()) as any[];
    expect(list.length).toBe(2);
    expect(list[0].title).toBe("WICHTIGE MITTEILUNG");
    expect(list[0].isPinned).toBe(true);

    // Beitrag löschen
    const delRes = await SELF.fetch(`https://example.test/api/bulletin-posts/${pinnedPost.id}`, {
      method: "DELETE",
      headers: authHeaders(jlToken),
    });
    expect(delRes.status).toBe(200);
  });
});
