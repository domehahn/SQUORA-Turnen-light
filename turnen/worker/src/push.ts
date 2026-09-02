import { SignJWT, importPKCS8 } from "jose";
import type { Env } from "./types";
import { recordOperationalEvent } from "./operations";
import { redactError } from "./log-redaction";

// Push an die native App über FCM HTTP v1. Firebase leitet für iOS-Tokens
// automatisch an APNs weiter (dort muss das APNs-Auth-Key hinterlegt sein) -
// deshalb reicht diese eine Integration für beide Plattformen.
//
// Aktiv nur, wenn FCM_SERVICE_ACCOUNT_JSON (Worker Secret) gesetzt ist. Sonst
// stiller No-op - wie E-Mail ohne RESEND_API_KEY.

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function parseServiceAccount(raw: string): ServiceAccount {
  const sa = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error("fcm_service_account_incomplete");
  }
  return sa as ServiceAccount;
}

// OAuth2-Access-Token für FCM per signiertem JWT (RS256) holen; ~1h gültig,
// hier modulweit zwischengespeichert.
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > now) return cachedAccessToken.token;

  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`fcm_oauth_failed_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

// Sendet an alle Geräte des Nutzers. Ungültige Tokens (UNREGISTERED /
// INVALID_ARGUMENT) werden aus device_tokens entfernt.
export async function sendPushToUser(
  env: Env,
  userId: string,
  msg: { title: string; body: string; link: string | null }
): Promise<void> {
  if (!env.FCM_SERVICE_ACCOUNT_JSON) return;

  const { results } = await env.DB.prepare("SELECT token FROM device_tokens WHERE user_id = ?")
    .bind(userId)
    .all<{ token: string }>();
  if (results.length === 0) return;

  let sa: ServiceAccount;
  let accessToken: string;
  try {
    sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
    accessToken = await getAccessToken(sa);
  } catch (err) {
    await recordOperationalEvent(env.DB, "push.setup_failed", "warning", err instanceof Error ? err.message : "unknown");
    console.error("Push-Setup fehlgeschlagen:", redactError(err));
    return;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const staleTokens: string[] = [];

  await Promise.all(
    results.map(async ({ token }) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: msg.title, body: msg.body },
              data: msg.link ? { link: msg.link } : {},
              android: { priority: "high" },
              apns: { payload: { aps: { sound: "default" } } },
            },
          }),
        });
        if (res.ok) return;
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { status?: string; details?: { errorCode?: string }[] } }
          | null;
        const status = errBody?.error?.status ?? "";
        const detailCode = errBody?.error?.details?.find((d) => d.errorCode)?.errorCode ?? "";
        if (status === "NOT_FOUND" || status === "INVALID_ARGUMENT" || detailCode === "UNREGISTERED") {
          staleTokens.push(token);
        } else {
          await recordOperationalEvent(env.DB, "push.send_failed", "warning", `${res.status}:${status || detailCode}`);
        }
      } catch (err) {
        console.error("Push-Versand fehlgeschlagen:", redactError(err));
      }
    })
  );

  if (staleTokens.length > 0) {
    const placeholders = staleTokens.map(() => "?").join(", ");
    await env.DB.prepare(`DELETE FROM device_tokens WHERE token IN (${placeholders})`)
      .bind(...staleTokens)
      .run();
  }
}
