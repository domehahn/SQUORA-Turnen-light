import { decryptField, encryptField } from "./crypto";
import type { Env } from "./types";

export const NOTIFICATION_CATEGORIES = [
  "requests",
  "substitutes",
  "waitlist",
  "membership",
  "attendance",
  "system",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export function notificationCategory(type: string): NotificationCategory {
  if (type.includes("substitute")) return "substitutes";
  if (type.includes("waitlist") || type.includes("placement")) return "waitlist";
  if (type.includes("attendance") || type.includes("session")) return "attendance";
  if (type.includes("member") || type.includes("club") || type.includes("join")) return "membership";
  if (type.includes("request") || type.includes("move") || type.includes("capacity")) return "requests";
  return "system";
}

export async function getNotificationPreferences(db: D1Database, userId: string): Promise<Record<NotificationCategory, boolean>> {
  const defaults = Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, true])) as Record<NotificationCategory, boolean>;
  const { results } = await db
    .prepare("SELECT category, email_enabled FROM notification_preferences WHERE user_id = ?")
    .bind(userId)
    .all<{ category: NotificationCategory; email_enabled: number }>();
  for (const row of results) defaults[row.category] = Boolean(row.email_enabled);
  return defaults;
}

export async function setNotificationPreferences(
  db: D1Database,
  userId: string,
  preferences: Partial<Record<NotificationCategory, boolean>>
): Promise<void> {
  const statements = Object.entries(preferences).map(([category, enabled]) =>
    db.prepare(
      `INSERT INTO notification_preferences (user_id, category, email_enabled, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, category) DO UPDATE SET email_enabled = excluded.email_enabled, updated_at = datetime('now')`
    ).bind(userId, category, enabled ? 1 : 0)
  );
  if (statements.length) await db.batch(statements);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recipientHash(email: string): Promise<string> {
  return sha256(email.trim().toLowerCase());
}

export interface RetryPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function createEmailDelivery(
  env: Env,
  input: { notificationId?: string; userId?: string; category: string; recipient: string; retryPayload?: RetryPayload }
): Promise<string | null> {
  if (!env.DB) return null;
  const id = crypto.randomUUID();
  const payload = input.retryPayload
    ? await encryptField(JSON.stringify(input.retryPayload), env.ENCRYPTION_KEY)
    : null;
  await env.DB.prepare(
    `INSERT INTO email_deliveries
       (id, notification_id, user_id, category, recipient_hash, status, retryable, payload_encrypted)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`
  ).bind(
    id,
    input.notificationId ?? null,
    input.userId ?? null,
    input.category,
    await recipientHash(input.recipient),
    input.retryPayload ? 1 : 0,
    payload
  ).run();
  return id;
}

export async function markEmailSent(db: D1Database, deliveryId: string | null, providerId: string): Promise<void> {
  if (!deliveryId) return;
  await db.prepare(
    `UPDATE email_deliveries SET provider_id = ?, status = 'sent', attempt_count = attempt_count + 1,
       next_retry_at = NULL, last_error_code = NULL, updated_at = datetime('now') WHERE id = ?`
  ).bind(providerId, deliveryId).run();
}

export async function markEmailFailed(db: D1Database, deliveryId: string | null, code: string): Promise<void> {
  if (!deliveryId) return;
  await db.prepare(
    `UPDATE email_deliveries SET status = 'failed', attempt_count = attempt_count + 1, last_error_code = ?,
       next_retry_at = CASE WHEN retryable = 1 AND attempt_count < 2 THEN datetime('now', '+' || ((attempt_count + 1) * 15) || ' minutes') ELSE NULL END,
       payload_encrypted = CASE WHEN attempt_count >= 2 THEN NULL ELSE payload_encrypted END,
       updated_at = datetime('now') WHERE id = ?`
  ).bind(code.slice(0, 80), deliveryId).run();
}

export async function recordOperationalEvent(
  db: D1Database | undefined,
  eventType: string,
  severity: "info" | "warning" | "critical",
  detailCode?: string
): Promise<void> {
  if (!db) return;
  await db.prepare("INSERT INTO operational_events (id, event_type, severity, detail_code) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), eventType, severity, detailCode?.slice(0, 80) ?? null).run();
}

export async function listDueRetries(env: Env): Promise<{ id: string; attemptCount: number; payload: RetryPayload }[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, attempt_count, payload_encrypted FROM email_deliveries
     WHERE status = 'failed' AND retryable = 1 AND attempt_count < 3 AND next_retry_at <= datetime('now')
     ORDER BY next_retry_at ASC LIMIT 50`
  ).all<{ id: string; attempt_count: number; payload_encrypted: string }>();
  const due: { id: string; attemptCount: number; payload: RetryPayload }[] = [];
  for (const row of results) {
    const plain = await decryptField(row.payload_encrypted, env.ENCRYPTION_KEY);
    if (plain && plain !== "[Entschlüsselung fehlgeschlagen]") due.push({ id: row.id, attemptCount: row.attempt_count, payload: JSON.parse(plain) as RetryPayload });
  }
  return due;
}

const EVENT_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
};

export async function applyEmailWebhook(
  db: D1Database,
  input: { eventId: string; providerId: string; type: string; createdAt: string }
): Promise<boolean> {
  if (!EVENT_STATUS[input.type]) return false;
  const inserted = await db.prepare(
    "INSERT OR IGNORE INTO email_webhook_events (event_id, provider_id, event_type, event_created_at) VALUES (?, ?, ?, ?)"
  ).bind(input.eventId, input.providerId, input.type, input.createdAt).run();
  if ((inserted.meta.changes ?? 0) === 0) return false;
  const status = EVENT_STATUS[input.type];
  // Webhooks werden mindestens einmal und nicht zwingend in Reihenfolge
  // zugestellt. Ein spätes `sent` darf daher z.B. `delivered` nicht wieder
  // zurückstufen. Fehler-Endzustände bleiben ebenfalls erhalten.
  await db.prepare(
    `UPDATE email_deliveries SET
       status = CASE
         WHEN status IN ('failed', 'bounced', 'complained', 'suppressed') THEN status
         WHEN ?1 IN ('failed', 'bounced', 'complained', 'suppressed') THEN ?1
         WHEN status = 'delivered' AND ?1 IN ('sent', 'delayed') THEN status
         ELSE ?1
       END,
       next_retry_at = CASE
         WHEN ?1 = 'failed' AND retryable = 1 AND attempt_count < 3 THEN datetime('now', '+15 minutes')
         WHEN ?1 IN ('delivered', 'bounced', 'complained', 'suppressed') THEN NULL
         ELSE next_retry_at END,
       payload_encrypted = CASE WHEN ?1 IN ('delivered', 'bounced', 'complained', 'suppressed') THEN NULL ELSE payload_encrypted END,
       updated_at = datetime('now') WHERE provider_id = ?2`
  ).bind(status, input.providerId).run();
  if (["email.failed", "email.bounced", "email.complained", "email.suppressed"].includes(input.type)) {
    await recordOperationalEvent(db, "email.delivery_problem", input.type === "email.complained" ? "critical" : "warning", input.type);
  }
  return true;
}

export async function operationsSummary(db: D1Database) {
  const [deliveries, failedEmails, events, cron] = await Promise.all([
    db.prepare(
      `SELECT status, COUNT(*) as count FROM email_deliveries
       WHERE created_at >= datetime('now', '-7 days') GROUP BY status`
    ).all<{ status: string; count: number }>(),
    db.prepare(
      `SELECT id, category, status, attempt_count as attemptCount, retryable,
              last_error_code as lastErrorCode, next_retry_at as nextRetryAt,
              created_at as createdAt, updated_at as updatedAt
       FROM email_deliveries
       WHERE status IN ('failed', 'bounced', 'complained', 'suppressed')
         AND created_at >= datetime('now', '-7 days')
       ORDER BY updated_at DESC
       LIMIT 100`
    ).all<{
      id: string;
      category: string;
      status: string;
      attemptCount: number;
      retryable: number;
      lastErrorCode: string | null;
      nextRetryAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>(),
    db.prepare(
      `SELECT event_type as eventType, severity, detail_code as detailCode, occurred_at as occurredAt
       FROM operational_events WHERE occurred_at >= datetime('now', '-7 days') ORDER BY occurred_at DESC LIMIT 100`
    ).all<{ eventType: string; severity: string; detailCode: string | null; occurredAt: string }>(),
    db.prepare(
      "SELECT job_name as jobName, status, started_at as startedAt, finished_at as finishedAt, detail_code as detailCode FROM cron_runs ORDER BY job_name"
    ).all(),
  ]);
  return {
    emailByStatus: deliveries.results,
    failedEmails: failedEmails.results.map((delivery) => ({ ...delivery, retryable: Boolean(delivery.retryable) })),
    events: events.results,
    cronRuns: cron.results,
  };
}

export async function startCron(db: D1Database, jobName: string): Promise<void> {
  await db.prepare(
    `INSERT INTO cron_runs (job_name, status, started_at, finished_at, detail_code) VALUES (?, 'running', datetime('now'), NULL, NULL)
     ON CONFLICT(job_name) DO UPDATE SET status = 'running', started_at = datetime('now'), finished_at = NULL, detail_code = NULL`
  ).bind(jobName).run();
}

export async function finishCron(db: D1Database, jobName: string, error?: unknown): Promise<void> {
  const failed = Boolean(error);
  await db.prepare("UPDATE cron_runs SET status = ?, finished_at = datetime('now'), detail_code = ? WHERE job_name = ?")
    .bind(failed ? "failed" : "ok", failed ? "job_failed" : null, jobName).run();
  if (failed) await recordOperationalEvent(db, "cron.failed", "critical", jobName);
}

export async function cleanupOperationalData(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM email_webhook_events WHERE received_at < datetime('now', '-90 days')"),
    db.prepare("DELETE FROM operational_events WHERE occurred_at < datetime('now', '-90 days')"),
    db.prepare("DELETE FROM email_deliveries WHERE created_at < datetime('now', '-90 days')"),
  ]);
}

export async function cleanupExpiredNotifications(db: D1Database, retentionDays: number): Promise<void> {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return;
  await db
    .prepare("DELETE FROM notifications WHERE created_at < datetime('now', ?)")
    .bind(`-${retentionDays} days`)
    .run();
}
