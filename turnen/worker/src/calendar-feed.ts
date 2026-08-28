function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashCalendarToken(token: string): Promise<string> {
  return hex(await sha256(token));
}

export function createCalendarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeIcs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function dateStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function localDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

export async function calendarFeedForToken(db: D1Database, token: string): Promise<string | null> {
  const tokenHash = await hashCalendarToken(token);
  const owner = await db.prepare(
    `SELECT u.id, COALESCE(u.name, u.email) as name FROM calendar_tokens ct
     JOIN users u ON u.id = ct.user_id WHERE ct.token_hash = ? AND ct.revoked_at IS NULL`
  ).bind(tokenHash).first<{ id: string; name: string }>();
  if (!owner) return null;

  const { results: groups } = await db.prepare(
    `SELECT DISTINCT g.id, g.name, g.club_id, g.weekday, g.start_time, g.end_time, g.location
     FROM groups g LEFT JOIN group_co_leaders gcl ON gcl.group_id = g.id
     WHERE (g.owner_id = ? OR gcl.user_id = ?) AND g.weekday IS NOT NULL AND g.start_time IS NOT NULL AND g.end_time IS NOT NULL`
  ).bind(owner.id, owner.id).all<{ id: string; name: string; club_id: string | null; weekday: number; start_time: string; end_time: string; location: string | null }>();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const until = new Date(from);
  until.setMonth(until.getMonth() + 6);
  const [{ results: overrides }, { results: holidays }] = await Promise.all([
    db.prepare(
      `SELECT s.group_id, s.session_date, s.cancelled, s.start_time, s.end_time, s.location
       FROM attendance_sessions s JOIN groups g ON g.id = s.group_id
       LEFT JOIN group_co_leaders gcl ON gcl.group_id = g.id
       WHERE (g.owner_id = ? OR gcl.user_id = ?) AND s.session_date >= date('now') AND s.session_date <= date('now', '+6 months')`
    ).bind(owner.id, owner.id).all<{ group_id: string; session_date: string; cancelled: number; start_time: string | null; end_time: string | null; location: string | null }>(),
    db.prepare(
      `SELECT h.club_id, h.start_date, h.end_date FROM holidays h
       WHERE h.club_id IN (SELECT club_id FROM groups WHERE owner_id = ? OR id IN (SELECT group_id FROM group_co_leaders WHERE user_id = ?))
         AND h.end_date >= date('now') AND h.start_date <= date('now', '+6 months')`
    ).bind(owner.id, owner.id).all<{ club_id: string; start_date: string; end_date: string }>(),
  ]);
  const overrideBySession = new Map(overrides.map((item) => [`${item.group_id}:${item.session_date}`, item]));
  const events: string[] = [];
  for (const group of groups) {
    const cursor = new Date(from);
    cursor.setDate(cursor.getDate() + ((group.weekday - cursor.getDay() + 7) % 7));
    while (cursor <= until) {
      const date = cursor.toISOString().slice(0, 10);
      const override = overrideBySession.get(`${group.id}:${date}`);
      const isHoliday = group.club_id && holidays.some((holiday) => holiday.club_id === group.club_id && holiday.start_date <= date && holiday.end_date >= date);
      if (!override?.cancelled && !isHoliday) {
        const start = override?.start_time ?? group.start_time;
        const end = override?.end_time ?? group.end_time;
        const location = override?.location ?? group.location;
        events.push([
          "BEGIN:VEVENT",
          `UID:${group.id}-${date}@turnen.squora.de`,
          `DTSTAMP:${dateStamp(new Date())}`,
          `DTSTART;TZID=Europe/Berlin:${localDateTime(date, start)}`,
          `DTEND;TZID=Europe/Berlin:${localDateTime(date, end)}`,
          `SUMMARY:${escapeIcs(group.name)}`,
          ...(location ? [`LOCATION:${escapeIcs(location)}`] : []),
          "END:VEVENT",
        ].join("\r\n"));
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  }
  const { results: substitutes } = await db.prepare(
    `SELECT sr.id, sr.session_date, g.name, g.start_time, g.end_time, g.location
     FROM substitute_requests sr JOIN groups g ON g.id = sr.group_id
     WHERE sr.claimed_by = ? AND sr.status = 'claimed' AND sr.session_date >= date('now') AND sr.session_date <= date('now', '+6 months')`
  ).bind(owner.id).all<{ id: string; session_date: string; name: string; start_time: string | null; end_time: string | null; location: string | null }>();
  for (const item of substitutes) {
    if (!item.start_time || !item.end_time) continue;
    events.push([
      "BEGIN:VEVENT",
      `UID:substitute-${item.id}@turnen.squora.de`,
      `DTSTAMP:${dateStamp(new Date())}`,
      `DTSTART;TZID=Europe/Berlin:${localDateTime(item.session_date, item.start_time)}`,
      `DTEND;TZID=Europe/Berlin:${localDateTime(item.session_date, item.end_time)}`,
      `SUMMARY:${escapeIcs(`Vertretung: ${item.name}`)}`,
      ...(item.location ? [`LOCATION:${escapeIcs(item.location)}`] : []),
      "END:VEVENT",
    ].join("\r\n"));
  }
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SQUORA//Turnen//DE", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeIcs(`Turnen – ${owner.name}`)}`, ...events, "END:VCALENDAR", ""].join("\r\n");
}
