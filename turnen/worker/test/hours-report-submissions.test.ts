import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureMigrated, login, seedClub, seedUser } from "./helpers";

beforeAll(async () => {
  await ensureMigrated();
});

const BASE = "https://example.test";

function pdfHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, "Content-Type": "application/pdf", "Sec-Fetch-Site": "same-origin" };
}
function jsonHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
}

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // "%PDF-1.4\n"

describe("Eingereichte Stundennachweise", () => {
  it("kompletter Ablauf: einreichen → sichtbar für Jugendleitung/Kassenwart → abrechnen → gesperrt", async () => {
    const club = await seedClub("Nachweis Club A");
    await seedUser({ email: "jl-hn@test.local", password: "password-123", clubId: club.id, clubRole: "jugendleiter" });
    await seedUser({ email: "kw-hn@test.local", password: "password-123", clubId: club.id, isKassenwart: true });
    await seedUser({ email: "ul-hn@test.local", password: "password-123", clubId: club.id });
    await seedUser({ email: "member-hn@test.local", password: "password-123", clubId: club.id });

    const ul = await login(SELF, "ul-hn@test.local", "password-123");
    const kw = await login(SELF, "kw-hn@test.local", "password-123");
    const jl = await login(SELF, "jl-hn@test.local", "password-123");
    const member = await login(SELF, "member-hn@test.local", "password-123");

    // Einreichen
    const submit = await SELF.fetch(`${BASE}/api/hours-report/submissions?year=2026&quarter=1`, {
      method: "PUT",
      headers: pdfHeaders(ul),
      body: FAKE_PDF,
    });
    expect(submit.status).toBe(200);

    // Eigene Liste
    const mine = await (await SELF.fetch(`${BASE}/api/hours-report/submissions/mine`, {
      headers: { Cookie: ul, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string; status: string; year: number }[]>();
    expect(mine).toHaveLength(1);
    expect(mine[0].status).toBe("submitted");
    const id = mine[0].id;

    // PDF abrufbar
    const pdf = await SELF.fetch(`${BASE}/api/hours-report/submissions/${id}/pdf`, {
      headers: { Cookie: ul, "Sec-Fetch-Site": "same-origin" },
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    // Body vollständig konsumieren, sonst bleibt der R2-Stream offen und die
    // isolierte Test-Storage kann nicht aufgeräumt werden.
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    expect(pdfBytes.length).toBe(FAKE_PDF.length);

    // Vereinsliste: Jugendleitung + Kassenwart ja, normales Mitglied nein
    for (const cookie of [jl, kw]) {
      const res = await SELF.fetch(`${BASE}/api/hours-report/submissions`, {
        headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" },
      });
      expect(res.status).toBe(200);
      expect((await res.json<unknown[]>()).length).toBe(1);
    }
    const memberList = await SELF.fetch(`${BASE}/api/hours-report/submissions`, {
      headers: { Cookie: member, "Sec-Fetch-Site": "same-origin" },
    });
    expect(memberList.status).toBe(403);

    // Jugendleitung darf NICHT abrechnen
    const jlSettle = await SELF.fetch(`${BASE}/api/hours-report/submissions/${id}/settle`, {
      method: "POST",
      headers: jsonHeaders(jl),
      body: JSON.stringify({ amountEuro: "50", rateEuro: "10", note: "x" }),
    });
    expect(jlSettle.status).toBe(403);

    // Kassenwart rechnet ab
    const settle = await SELF.fetch(`${BASE}/api/hours-report/submissions/${id}/settle`, {
      method: "POST",
      headers: jsonHeaders(kw),
      body: JSON.stringify({ amountEuro: "48,50", rateEuro: "10", note: "überwiesen" }),
    });
    expect(settle.status).toBe(200);

    const afterSettle = await (await SELF.fetch(`${BASE}/api/hours-report/submissions`, {
      headers: { Cookie: kw, "Sec-Fetch-Site": "same-origin" },
    })).json<{ status: string; settledAmountCents: number | null }[]>();
    expect(afterSettle[0].status).toBe("settled");
    expect(afterSettle[0].settledAmountCents).toBe(4850);

    // Erneutes Einreichen jetzt gesperrt
    const resubmit = await SELF.fetch(`${BASE}/api/hours-report/submissions?year=2026&quarter=1`, {
      method: "PUT",
      headers: pdfHeaders(ul),
      body: FAKE_PDF,
    });
    expect(resubmit.status).toBe(409);
  });

  it("Kassenwart:in darf selbst Nachweise einreichen, aber nicht den eigenen abrechnen", async () => {
    const club = await seedClub("Nachweis Club B");
    await seedUser({ email: "kw-b@test.local", password: "password-123", clubId: club.id, isKassenwart: true });
    const kw = await login(SELF, "kw-b@test.local", "password-123");

    const submit = await SELF.fetch(`${BASE}/api/hours-report/submissions?year=2026&quarter=2`, {
      method: "PUT",
      headers: pdfHeaders(kw),
      body: FAKE_PDF,
    });
    expect(submit.status).toBe(200);

    const mine = await (await SELF.fetch(`${BASE}/api/hours-report/submissions/mine`, {
      headers: { Cookie: kw, "Sec-Fetch-Site": "same-origin" },
    })).json<{ id: string }[]>();
    expect(mine).toHaveLength(1);

    // Vier-Augen-Prinzip: den eigenen Nachweis nicht selbst abrechnen
    const selfSettle = await SELF.fetch(`${BASE}/api/hours-report/submissions/${mine[0].id}/settle`, {
      method: "POST",
      headers: jsonHeaders(kw),
      body: JSON.stringify({ amountEuro: "10", rateEuro: "10", note: "" }),
    });
    expect(selfSettle.status).toBe(403);
  });

  it("erlaubt erneutes Einreichen, solange noch nicht abgerechnet", async () => {
    const club = await seedClub("Nachweis Club C");
    await seedUser({ email: "ul-c@test.local", password: "password-123", clubId: club.id });
    const ul = await login(SELF, "ul-c@test.local", "password-123");

    for (let i = 0; i < 2; i++) {
      const res = await SELF.fetch(`${BASE}/api/hours-report/submissions?year=2025&quarter=0`, {
        method: "PUT",
        headers: pdfHeaders(ul),
        body: FAKE_PDF,
      });
      expect(res.status).toBe(200);
    }
    const mine = await (await SELF.fetch(`${BASE}/api/hours-report/submissions/mine`, {
      headers: { Cookie: ul, "Sec-Fetch-Site": "same-origin" },
    })).json<unknown[]>();
    expect(mine).toHaveLength(1);
  });
});
