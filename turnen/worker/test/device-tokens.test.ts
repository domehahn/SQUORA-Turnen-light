import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authHeaders, ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

describe("Push-Geräte-Tokens", () => {
  it("registriert, aktualisiert (kein Duplikat) und entfernt einen Token", async () => {
    const club = await seedClub("Device Token Club");
    const user = await seedUser({ email: "dt@test.local", password: "password-123", clubId: club.id });
    const cookie = await login(SELF, "dt@test.local", "password-123");

    const reg = await SELF.fetch(`${BASE}/api/me/device-tokens`, {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({ token: "tok-abc", platform: "ios" }),
    });
    expect(reg.status).toBe(200);

    // erneut derselbe Token -> Upsert, kein zweiter Eintrag
    await SELF.fetch(`${BASE}/api/me/device-tokens`, {
      method: "POST",
      headers: authHeaders(cookie),
      body: JSON.stringify({ token: "tok-abc", platform: "android" }),
    });
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);

    const del = await SELF.fetch(`${BASE}/api/me/device-tokens`, {
      method: "DELETE",
      headers: authHeaders(cookie),
      body: JSON.stringify({ token: "tok-abc" }),
    });
    expect(del.status).toBe(200);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_tokens WHERE user_id = ?")
      .bind(user.id)
      .first<{ n: number }>();
    expect(after?.n).toBe(0);
  });

  it("lehnt ungültige Plattform / leeren Token ab", async () => {
    const club = await seedClub("Device Token Club B");
    await seedUser({ email: "dt-b@test.local", password: "password-123", clubId: club.id });
    const cookie = await login(SELF, "dt-b@test.local", "password-123");

    for (const bad of [{ token: "x", platform: "web" }, { token: "", platform: "ios" }, { platform: "ios" }]) {
      const res = await SELF.fetch(`${BASE}/api/me/device-tokens`, {
        method: "POST",
        headers: authHeaders(cookie),
        body: JSON.stringify(bad),
      });
      expect(res.status).toBe(400);
    }
  });
});
