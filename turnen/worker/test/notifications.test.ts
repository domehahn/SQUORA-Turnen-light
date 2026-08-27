import { fetchMock } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sendEmailOnly } from "../src/notifications";
import type { Env } from "../src/types";

const baseEnv = {
  RESEND_API_KEY: "test-resend-key",
  EMAIL_FROM_ADDRESS: "no_reply@squora.de",
} as Env;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

describe("Resend-E-Mail-Versand", () => {
  it("sendet Text und HTML mit dem konfigurierten Absender an Resend", async () => {
    fetchMock
      .get("https://api.resend.com")
      .intercept({
        path: "/emails",
        method: "POST",
        headers: { Authorization: "Bearer test-resend-key", "Content-Type": "application/json" },
        body: (body) => {
          const payload = JSON.parse(body) as Record<string, unknown>;
          return (
            payload.from === "Turnen <no_reply@squora.de>" &&
            payload.to === "erika@example.com" &&
            payload.subject === "Testnachricht" &&
            payload.text === "Hallo\n\nhttps://example.test/link" &&
            typeof payload.html === "string" &&
            payload.html.includes("https://example.test/link")
          );
        },
      })
      .reply(200, { id: "email_test" });

    const sent = await sendEmailOnly(baseEnv, {
      to: "erika@example.com",
      subject: "Testnachricht",
      text: "Hallo",
      link: "https://example.test/link",
      linkLabel: "Öffnen",
    });

    expect(sent).toBe(true);
    fetchMock.assertNoPendingInterceptors();
  });

  it("meldet fehlende Resend-Konfiguration als nicht versendet", async () => {
    const sent = await sendEmailOnly({ ...baseEnv, RESEND_API_KEY: undefined }, {
      to: "erika@example.com",
      subject: "Testnachricht",
      text: "Hallo",
    });

    expect(sent).toBe(false);
  });

  it("meldet eine Ablehnung durch Resend als nicht versendet", async () => {
    fetchMock
      .get("https://api.resend.com")
      .intercept({ path: "/emails", method: "POST" })
      .reply(403, { message: "sender rejected" }, { headers: { "x-request-id": "request-test" } });

    const sent = await sendEmailOnly(baseEnv, {
      to: "erika@example.com",
      subject: "Testnachricht",
      text: "Hallo",
    });

    expect(sent).toBe(false);
    fetchMock.assertNoPendingInterceptors();
  });
});
