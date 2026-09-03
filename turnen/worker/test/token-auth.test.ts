import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

async function appLogin(email: string, password: string): Promise<{ token: string; setCookie: string | null }> {
  const res = await SELF.fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", "X-Client": "turnen-app" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  const body = await res.json<{ token?: string }>();
  expect(typeof body.token).toBe("string");
  return { token: body.token as string, setCookie: res.headers.get("set-cookie") };
}

describe("Bearer-Token-Auth für die native App", () => {
  it("App-Login liefert Token; Bearer ohne Cookie ist authentifiziert", async () => {
    const club = await seedClub("Token Club A");
    await seedUser({ email: "token-a@test.local", password: "password-123", clubId: club.id });
    const { token } = await appLogin("token-a@test.local", "password-123");

    // GET nur mit Bearer, kein Cookie, kein Sec-Fetch-Site
    const me = await SELF.fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect((await me.json<{ email: string }>()).email).toBe("token-a@test.local");
  });

  it("Bearer-Requests umgehen die Same-Origin/CSRF-Prüfung (kein Browser-Vektor)", async () => {
    const club = await seedClub("Token Club B");
    await seedUser({ email: "token-b@test.local", password: "password-123", clubId: club.id });
    const { token } = await appLogin("token-b@test.local", "password-123");

    // POST ganz ohne Origin/Sec-Fetch-Site -> würde per Cookie mit 403 abgelehnt,
    // mit Bearer ist es erlaubt (hier: 400 wegen leerem Body, nicht 403).
    const res = await SELF.fetch(`${BASE}/api/substitute-requests`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });

  it("Logout per Bearer widerruft die Sitzung", async () => {
    const club = await seedClub("Token Club C");
    await seedUser({ email: "token-c@test.local", password: "password-123", clubId: club.id });
    const { token } = await appLogin("token-c@test.local", "password-123");

    const logout = await SELF.fetch(`${BASE}/api/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    expect(logout.status).toBe(200);

    const after = await SELF.fetch(`${BASE}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });

  it("Login von der nativen Origin (capacitor://localhost, kein Bearer, Sec-Fetch-Site: cross-site) wird nicht als CSRF geblockt", async () => {
    const club = await seedClub("Token Club E");
    await seedUser({ email: "token-e@test.local", password: "password-123", clubId: club.id });
    const res = await SELF.fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client": "turnen-app",
        Origin: "capacitor://localhost",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ email: "token-e@test.local", password: "password-123" }),
    });
    expect(res.status).toBe(200);
    expect(typeof (await res.json<{ token?: string }>()).token).toBe("string");
  });

  it("Web-Login (ohne X-Client) verhält sich unverändert - kein Token im Body", async () => {
    const club = await seedClub("Token Club D");
    await seedUser({ email: "token-d@test.local", password: "password-123", clubId: club.id });
    const res = await SELF.fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ email: "token-d@test.local", password: "password-123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ token?: string; user?: unknown }>();
    expect(body.token).toBeUndefined();
    expect(body.user).toBeTruthy();
    expect(res.headers.get("set-cookie")).toContain("turnen_session=");
  });
});
