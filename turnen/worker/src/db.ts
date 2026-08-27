import type {
  AttendanceEntry,
  AttendanceEntryRow,
  AuditLogEntry,
  AuditLogRow,
  CapacityRequestAction,
  CapacityRequestDetail,
  CapacityRequestRow,
  Child,
  ChildRow,
  Club,
  ClubRole,
  ClubRow,
  Family,
  FamilyRow,
  Group,
  GroupRow,
  Holiday,
  HolidayRow,
  MoveRequestDetail,
  MoveRequestRow,
  MoveRequestStatus,
  Notification,
  NotificationRow,
  ClubJoinRequestDetail,
  ClubJoinRequestRow,
  ClubJoinRequestStatus,
  ClubWaitlistEntryDetail,
  SessionOverrideRequestDetail,
  SessionOverrideRequestRow,
  SessionOverrideRequestStatus,
  ClubWaitlistRow,
  ClubWaitlistStatus,
  PlacementRequestDetail,
  PlacementRequestRow,
  PlacementRequestStatus,
  SubstituteRequestDetail,
  SubstituteRequestRow,
  SubstituteRequestStatus,
  User,
  UserRow,
  WaitlistEntryDetail,
  WaitlistEntryRow,
  WaitlistStatus,
} from "./types";

type GroupOwnership = { owner_id: string | null; club_id: string | null };

// Eine Gruppe darf bearbeitet werden, wenn der anfragende Nutzer sie
// angelegt hat, oder wenn es eine "herrenlose" Alt-Gruppe ohne Besitzer und
// ohne Verein ist (Bestandsschutz für Gruppen aus der Zeit vor Vereinen).
// Deckt NICHT Mit-Trainer*innen ab (siehe group_co_leaders) - dafür bei
// Einzel-Prüfungen canWriteGroupAsync() verwenden, bei Listen die separat
// vorab geladene Mit-Trainer-Zuordnung (siehe listCoLeaderGroupIdsForUser).
export function canWriteGroup(group: GroupOwnership, userId: string): boolean {
  return group.owner_id === userId || (group.owner_id === null && group.club_id === null);
}

// --- Mit-Trainer*innen (mehrere gleichberechtigte Leitungen pro Gruppe) --------

// Alle Gruppen-IDs, bei denen die Person Mit-Trainer*in ist - einmal pro
// Anfrage vorab laden und dann synchron in .map() über Listen verwenden,
// um N+1-Abfragen zu vermeiden.
export async function listCoLeaderGroupIdsForUser(db: D1Database, userId: string): Promise<Set<string>> {
  const { results } = await db
    .prepare("SELECT group_id FROM group_co_leaders WHERE user_id = ?")
    .bind(userId)
    .all<{ group_id: string }>();
  return new Set(results.map((r) => r.group_id));
}

// Einzelprüfung (z.B. in Routen-Handlern) - deckt Besitzer, Mit-Trainer*in
// und herrenlose Alt-Gruppen ab.
export async function canWriteGroupAsync(
  db: D1Database,
  group: GroupOwnership & { id: string },
  userId: string
): Promise<boolean> {
  if (canWriteGroup(group, userId)) return true;
  const row = await db
    .prepare("SELECT 1 FROM group_co_leaders WHERE group_id = ? AND user_id = ?")
    .bind(group.id, userId)
    .first();
  return Boolean(row);
}

export interface GroupCoLeader {
  id: string;
  name: string | null;
  email: string;
}

export async function listGroupCoLeaders(db: D1Database, groupId: string): Promise<GroupCoLeader[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id as id, u.name as name, u.email as email
       FROM group_co_leaders gcl
       JOIN users u ON u.id = gcl.user_id
       WHERE gcl.group_id = ?
       ORDER BY u.name ASC, u.email ASC`
    )
    .bind(groupId)
    .all<GroupCoLeader>();
  return results;
}

export async function addGroupCoLeader(db: D1Database, groupId: string, userId: string, addedBy: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO group_co_leaders (group_id, user_id, added_by) VALUES (?, ?, ?)")
    .bind(groupId, userId, addedBy)
    .run();
}

export async function removeGroupCoLeader(db: D1Database, groupId: string, userId: string): Promise<void> {
  await db.prepare("DELETE FROM group_co_leaders WHERE group_id = ? AND user_id = ?").bind(groupId, userId).run();
}

// Volle Lebensjahre am heutigen Tag - dieselbe Logik wie src/lib/age.ts im
// Frontend, hier serverseitig für die Altersprüfung beim Verschieben nötig.
function calculateAgeYears(birthDate: string, atDate: Date = new Date()): number {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = atDate.getFullYear() - year;
  const hadBirthdayThisYear =
    atDate.getMonth() + 1 > month || (atDate.getMonth() + 1 === month && atDate.getDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

// `maxAge` ist exklusiv zu verstehen, siehe src/lib/age.ts#groupForAge.
export function ageFitsGroup(birthDate: string, group: { min_age: number; max_age: number }): boolean {
  const age = calculateAgeYears(birthDate);
  return age >= group.min_age && age < group.max_age;
}

function rowToGroup(
  row: GroupRow,
  ctx: { userId: string; ownerName: string | null; isCoLeader?: boolean; isLeadership?: boolean }
): Group {
  return {
    id: row.id,
    name: row.name,
    minAge: row.min_age,
    maxAge: row.max_age,
    sortOrder: row.sort_order,
    maxChildren: row.max_children,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    ownerId: row.owner_id,
    ownerName: ctx.ownerName,
    clubId: row.club_id,
    // Die Jugendleitung darf Stammdaten jeder Vereinsgruppe bearbeiten/
    // löschen, nicht nur eigene - siehe PUT/DELETE /api/groups/:id.
    canEdit: canWriteGroup(row, ctx.userId) || Boolean(ctx.isCoLeader) || Boolean(ctx.isLeadership),
    editableAsLeadership: Boolean(ctx.isLeadership) && !canWriteGroup(row, ctx.userId) && !ctx.isCoLeader,
    color: row.color,
    createdAt: row.created_at,
  };
}

function rowToChild(row: ChildRow, canEdit: boolean): Child {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    groupId: row.group_id,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    familyId: row.family_id,
    status: row.status,
    archivedAt: row.archived_at,
    canEdit,
    createdAt: row.created_at,
  };
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    clubId: row.club_id,
    clubRole: row.club_role,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
  };
}

function rowToClub(row: ClubRow & { member_count: number | null }): Club {
  return {
    id: row.id,
    name: row.name,
    clubNumber: row.club_number,
    memberCount: row.member_count ?? 0,
    createdAt: row.created_at,
  };
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? rowToUser(row) : null;
}

// Volle Zeile inkl. password_hash/password_salt - für die "altes Passwort
// prüfen"-Logik beim Passwort-Ändern (siehe PUT /api/me/password).
export async function getUserRowById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function updateUserProfile(
  db: D1Database,
  id: string,
  input: { name: string | null; email: string }
): Promise<User | null> {
  await db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").bind(input.name, input.email, id).run();
  return getUserById(db, id);
}

// TOTP-MFA (Finding SEC-02). Setup läuft zweistufig: setPendingTotpSecret
// legt das Secret ab, OHNE totp_enabled zu setzen (erst nach erfolgreicher
// Code-Bestätigung aktiv, verhindert versehentliches Aussperren durch eine
// falsch gescannte/getippte Authenticator-Einrichtung).
export async function setPendingTotpSecret(db: D1Database, id: string, encryptedSecret: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_backup_codes = NULL WHERE id = ?").bind(encryptedSecret, id).run();
}

export async function enableTotp(db: D1Database, id: string, hashedBackupCodesJson: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_enabled = 1, totp_backup_codes = ? WHERE id = ?").bind(hashedBackupCodesJson, id).run();
}

export async function disableTotp(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = NULL WHERE id = ?").bind(id).run();
}

export async function consumeBackupCode(db: D1Database, id: string, remainingCodesJson: string): Promise<void> {
  await db.prepare("UPDATE users SET totp_backup_codes = ? WHERE id = ?").bind(remainingCodesJson, id).run();
}

export async function updateUserPassword(db: D1Database, id: string, input: { hash: string; salt: string }): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(input.hash, input.salt, id)
    .run();
}

// --- Vereine ---------------------------------------------------------------

export async function listClubs(db: D1Database): Promise<Club[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, COUNT(u.id) as member_count
       FROM clubs c
       LEFT JOIN users u ON u.club_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    )
    .all<ClubRow & { member_count: number }>();
  return results.map(rowToClub);
}

export async function getClubById(db: D1Database, id: string): Promise<Club | null> {
  const row = await db
    .prepare(
      `SELECT c.*, COUNT(u.id) as member_count
       FROM clubs c
       LEFT JOIN users u ON u.club_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`
    )
    .bind(id)
    .first<ClubRow & { member_count: number }>();
  return row ? rowToClub(row) : null;
}

export async function getClubByName(db: D1Database, name: string): Promise<ClubRow | null> {
  return db.prepare("SELECT * FROM clubs WHERE name = ?").bind(name).first<ClubRow>();
}

export async function createClub(db: D1Database, name: string): Promise<ClubRow> {
  const id = crypto.randomUUID();
  const row: ClubRow = { id, name, club_number: null, created_at: new Date().toISOString() };
  await db.prepare("INSERT INTO clubs (id, name) VALUES (?, ?)").bind(id, name).run();
  return row;
}

export async function setClubNumber(db: D1Database, clubId: string, clubNumber: string | null): Promise<void> {
  await db.prepare("UPDATE clubs SET club_number = ? WHERE id = ?").bind(clubNumber, clubId).run();
}

export async function renameClub(db: D1Database, clubId: string, name: string): Promise<void> {
  await db.prepare("UPDATE clubs SET name = ? WHERE id = ?").bind(name, clubId).run();
}

// Mitglieder/Gruppen werden per ON DELETE SET NULL nicht mitgelöscht,
// sondern vereinslos - siehe migrations/0002_clubs.sql.
export async function deleteClub(db: D1Database, clubId: string): Promise<void> {
  await db.prepare("DELETE FROM clubs WHERE id = ?").bind(clubId).run();
}

export async function setUserClub(
  db: D1Database,
  userId: string,
  clubId: string | null,
  role: ClubRole
): Promise<void> {
  await db.prepare("UPDATE users SET club_id = ?, club_role = ? WHERE id = ?").bind(clubId, role, userId).run();
}

export interface ClubMember {
  id: string;
  name: string | null;
  email: string;
  role: ClubRole;
  isAdmin: number;
  lastLoginAt: string | null;
}

export async function listClubMembers(db: D1Database, clubId: string): Promise<ClubMember[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, email, club_role as role, is_admin as isAdmin, last_login_at as lastLoginAt FROM users WHERE club_id = ?
       ORDER BY CASE club_role WHEN 'jugendleiter' THEN 0 ELSE 1 END, name ASC, email ASC`
    )
    .bind(clubId)
    .all<ClubMember>();
  return results;
}

// Zeitstempel der letzten erfolgreichen Anmeldung setzen - für die
// Jugendleitung im Verein sichtbar, ergänzend zum Audit-Log.
export async function touchLastLogin(db: D1Database, userId: string): Promise<void> {
  await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(userId).run();
}

// --- Serverseitige Sitzungen (Session-Management-Härtung) --------------------
// Löst das vorherige rein zustandslose JWT ab - siehe auth.ts. Jede Zeile
// hier ist eine aktive Sitzung, die eigenständig widerrufen werden kann.

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
  user_agent: string | null;
  ip: string | null;
}

export async function createSession(
  db: D1Database,
  input: { userId: string; absoluteExpiresAt: string; userAgent: string | null; ip: string | null }
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, absolute_expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, input.userId, input.absoluteExpiresAt, input.userAgent, input.ip)
    .run();
  return id;
}

export async function getSessionById(db: D1Database, id: string): Promise<SessionRow | null> {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
}

// Throttled aufgerufen (siehe ACTIVITY_UPDATE_THROTTLE_SECONDS in auth.ts) -
// nicht bei jedem einzelnen Request schreiben.
export async function touchSessionActivity(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE sessions SET last_activity_at = datetime('now') WHERE id = ?").bind(id).run();
}

export async function revokeSession(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(id).run();
}

// Für Passwort ändern/zurücksetzen, MFA deaktivieren, "alle Geräte
// abmelden" - widerruft alle Sitzungen eines Nutzers, optional außer der
// aktuell verwendeten (damit man sich nicht selbst mitten in der Aktion
// aussperrt).
export async function revokeAllUserSessions(db: D1Database, userId: string, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await db
      .prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
      .bind(userId, exceptSessionId)
      .run();
  } else {
    await db.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").bind(userId).run();
  }
}

export async function listActiveSessions(db: D1Database, userId: string): Promise<SessionRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND absolute_expires_at > datetime('now') ORDER BY last_activity_at DESC"
    )
    .bind(userId)
    .all<SessionRow>();
  return results;
}

// Einmaligkeit des Passwort-Reset-Tokens (s. auth.ts) - PRIMARY KEY auf jti
// sorgt dafür, dass ein zweiter Einlöseversuch mit demselben Token
// fehlschlägt. Gibt false zurück, wenn die jti bereits verwendet wurde.
export async function consumePasswordResetJti(db: D1Database, jti: string, expiresAtIso: string): Promise<boolean> {
  try {
    await db.prepare("INSERT INTO used_password_reset_tokens (jti, expires_at) VALUES (?, ?)").bind(jti, expiresAtIso).run();
    return true;
  } catch {
    return false; // schon verwendet
  }
}

// Rate Limiting/Brute-Force-Schutz für den Login (Finding SEC-01) und
// LOGIN/FAILED_LOGIN-Audit-Trail (Finding SEC-10).
export async function recordLoginAttempt(db: D1Database, email: string, success: boolean): Promise<void> {
  await db
    .prepare("INSERT INTO login_attempts (id, email, success) VALUES (?, ?, ?)")
    .bind(crypto.randomUUID(), email, success ? 1 : 0)
    .run();
}

// Fehlgeschlagene Versuche für diese E-Mail-Adresse in den letzten
// `windowMinutes` Minuten - unabhängig davon, ob die Adresse überhaupt
// einem Account gehört (verhindert auch, dass man per Timing/Statuscode
// erkennen kann, welche E-Mails registriert sind).
export async function countRecentFailedLogins(db: D1Database, email: string, windowMinutes: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as n FROM login_attempts
       WHERE email = ?1 AND success = 0 AND created_at >= datetime('now', ?2)`
    )
    .bind(email, `-${windowMinutes} minutes`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// Anzahl der Jugendleitungen im Verein, optional einen Nutzer ausschließend
// (z.B. um zu prüfen, ob nach einem Rollenwechsel noch jemand übrig bleibt).
export async function countClubLeaders(db: D1Database, clubId: string, excludeUserId?: string): Promise<number> {
  const row = excludeUserId
    ? await db
        .prepare("SELECT COUNT(*) as n FROM users WHERE club_id = ? AND club_role = 'jugendleiter' AND id != ?")
        .bind(clubId, excludeUserId)
        .first<{ n: number }>()
    : await db
        .prepare("SELECT COUNT(*) as n FROM users WHERE club_id = ? AND club_role = 'jugendleiter'")
        .bind(clubId)
        .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setClubRole(
  db: D1Database,
  userId: string,
  clubId: string,
  role: ClubRole
): Promise<boolean> {
  const result = await db
    .prepare("UPDATE users SET club_role = ? WHERE id = ? AND club_id = ?")
    .bind(role, userId, clubId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// --- Gruppen -----------------------------------------------------------

// Sichtbar sind: eigene Gruppen, Gruppen anderer Mitglieder desselben
// Vereins (lesend über canEdit=false erkennbar) sowie herrenlose Alt-Gruppen
// ohne Besitzer/Verein.
export async function listGroupsForUser(
  db: D1Database,
  userId: string,
  clubId: string | null,
  clubRole: ClubRole | null = null
): Promise<Group[]> {
  const [{ results }, coLeaderGroupIds] = await Promise.all([
    db
      .prepare(
        `SELECT g.*, u.name as owner_name, u.email as owner_email
         FROM groups g
         LEFT JOIN users u ON u.id = g.owner_id
         WHERE g.owner_id = ?1
            OR (g.club_id IS NOT NULL AND g.club_id = ?2)
            OR (g.owner_id IS NULL AND g.club_id IS NULL)
            OR g.id IN (SELECT group_id FROM group_co_leaders WHERE user_id = ?1)
         ORDER BY g.sort_order ASC, g.min_age ASC`
      )
      .bind(userId, clubId)
      .all<GroupRow & { owner_name: string | null; owner_email: string | null }>(),
    listCoLeaderGroupIdsForUser(db, userId),
  ]);
  const isLeadership = clubRole === "jugendleiter";
  return results.map((row) =>
    rowToGroup(row, {
      userId,
      ownerName: row.owner_name ?? row.owner_email ?? null,
      isCoLeader: coLeaderGroupIds.has(row.id),
      isLeadership: isLeadership && row.club_id !== null && row.club_id === clubId,
    })
  );
}

export async function getGroupRowById(db: D1Database, id: string): Promise<GroupRow | null> {
  return db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
}

export async function createGroup(
  db: D1Database,
  input: {
    name: string;
    minAge: number;
    maxAge: number;
    sortOrder: number;
    maxChildren: number | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    ownerId: string;
    ownerName: string | null;
    clubId: string | null;
    color: string | null;
  }
): Promise<Group> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO groups (id, name, min_age, max_age, sort_order, max_children, weekday, start_time, end_time, location, owner_id, club_id, color)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.name,
      input.minAge,
      input.maxAge,
      input.sortOrder,
      input.maxChildren,
      input.weekday,
      input.startTime,
      input.endTime,
      input.location,
      input.ownerId,
      input.clubId,
      input.color
    )
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return rowToGroup(row as GroupRow, { userId: input.ownerId, ownerName: input.ownerName });
}

export async function updateGroup(
  db: D1Database,
  id: string,
  input: {
    name: string;
    minAge: number;
    maxAge: number;
    sortOrder: number;
    maxChildren: number | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    color: string | null;
  },
  ctx: { userId: string; ownerName: string | null }
): Promise<Group | null> {
  await db
    .prepare(
      `UPDATE groups SET name = ?, min_age = ?, max_age = ?, sort_order = ?, max_children = ?,
              weekday = ?, start_time = ?, end_time = ?, location = ?, color = ? WHERE id = ?`
    )
    .bind(
      input.name,
      input.minAge,
      input.maxAge,
      input.sortOrder,
      input.maxChildren,
      input.weekday,
      input.startTime,
      input.endTime,
      input.location,
      input.color,
      id
    )
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  if (!row) return null;
  const isCoLeader = await db
    .prepare("SELECT 1 FROM group_co_leaders WHERE group_id = ? AND user_id = ?")
    .bind(id, ctx.userId)
    .first();
  return rowToGroup(row, { ...ctx, isCoLeader: Boolean(isCoLeader) });
}

export async function deleteGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM groups WHERE id = ?").bind(id).run();
}

// Eine herrenlose Alt-Gruppe (owner_id/club_id NULL) für sich beanspruchen
// und dem eigenen Verein zuordnen. Nur für Gruppen möglich, die noch
// niemandem gehören - bereits zugeordnete Gruppen bleiben unangetastet.
export async function claimGroup(
  db: D1Database,
  id: string,
  ctx: { ownerId: string; ownerName: string | null; clubId: string }
): Promise<Group | null> {
  await db
    .prepare("UPDATE groups SET owner_id = ?, club_id = ? WHERE id = ? AND owner_id IS NULL AND club_id IS NULL")
    .bind(ctx.ownerId, ctx.clubId, id)
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return row ? rowToGroup(row, { userId: ctx.ownerId, ownerName: ctx.ownerName }) : null;
}

// --- Kinder --------------------------------------------------------------

// Sichtbar sind: Kinder ohne Gruppe (Alt-Bestand, weiterhin für alle offen),
// Kinder in eigenen Gruppen sowie Kinder in Gruppen anderer Mitglieder
// desselben Vereins (lesend).
// `includeArchived` zeigt auch ausgetretene Kinder mit an (für die
// "Archiv"-Ansicht) - im Alltag (Anwesenheit, Gruppen-Listen etc.) sind nur
// aktive Kinder relevant.
export async function listChildrenForUser(
  db: D1Database,
  userId: string,
  clubId: string | null,
  includeArchived = false
): Promise<Child[]> {
  const [{ results }, coLeaderGroupIds] = await Promise.all([
    db
      .prepare(
        // Mandantengrenze ist children.club_id, NICHT mehr "hat keine
        // Gruppe" (P0-Fix, s. Migration 0036/PRIVACY_SECURITY_GAP_ANALYSIS.md).
        // Ein gruppenloses Kind (z.B. auf der Vereins-Warteliste) ist nur
        // innerhalb des eigenen Vereins sichtbar, nicht mehr für jede*n
        // authentifizierte*n Nutzer*in. Die letzten beiden OR-Zweige bleiben
        // als Kompatibilitäts-Öffnung für echte Alt-Bestand-Datensätze ohne
        // jede Vereinszuordnung bestehen (club_id UND group_id beide NULL,
        // bzw. eine Gruppe ganz ohne Besitzer/Verein) - im aktuellen
        // Datenbestand gibt es davon keine, das ist reine Absicherung.
        `SELECT c.*, g.owner_id as group_owner_id, g.club_id as group_club_id
         FROM children c
         LEFT JOIN groups g ON g.id = c.group_id
         WHERE ((c.club_id IS NOT NULL AND c.club_id = ?2)
            OR g.owner_id = ?1
            OR (c.club_id IS NULL AND c.group_id IS NULL)
            OR (c.group_id IS NOT NULL AND g.owner_id IS NULL AND g.club_id IS NULL))
           AND (?3 OR c.status = 'active')
         ORDER BY c.last_name ASC, c.first_name ASC`
      )
      .bind(userId, clubId, includeArchived ? 1 : 0)
      .all<ChildRow & { group_owner_id: string | null; group_club_id: string | null }>(),
    listCoLeaderGroupIdsForUser(db, userId),
  ]);
  return results.map((row) => {
    const canEdit =
      (row.group_id === null && row.club_id !== null && row.club_id === clubId) ||
      (row.group_id === null && row.club_id === null) ||
      canWriteGroup({ owner_id: row.group_owner_id, club_id: row.group_club_id }, userId) ||
      (row.group_id !== null && coLeaderGroupIds.has(row.group_id));
    return rowToChild(row, canEdit);
  });
}

export async function getChildRowById(db: D1Database, id: string): Promise<ChildRow | null> {
  return db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
}

// Alle Kind-Rohdatensätze (alle Vereine, inkl. archiviert) - nur für den
// einmaligen Verschlüsselungs-Backfill (Finding PRIV-02), sonst nirgends
// verwenden (keine Sichtbarkeits-/Vereinsfilterung).
export async function listAllChildRowsForBackfill(db: D1Database): Promise<ChildRow[]> {
  const { results } = await db.prepare("SELECT * FROM children").all<ChildRow>();
  return results;
}

export async function updateChildEncryptedFieldsRaw(
  db: D1Database,
  id: string,
  input: { emergencyContactName: string | null; emergencyContactPhone: string | null }
): Promise<void> {
  await db
    .prepare("UPDATE children SET emergency_contact_name = ?, emergency_contact_phone = ? WHERE id = ?")
    .bind(input.emergencyContactName, input.emergencyContactPhone, id)
    .run();
}

// Nur die Familien-Zuordnung ändern (Geschwister verknüpfen/trennen), ohne
// den restlichen Datensatz anzufassen.
export async function setChildFamily(db: D1Database, id: string, familyId: string | null): Promise<Child | null> {
  await db.prepare("UPDATE children SET family_id = ? WHERE id = ?").bind(familyId, id).run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return row ? rowToChild(row, true) : null;
}

// Anzahl der Kinder, die aktuell in einer Gruppe stehen - für die
// Kapazitätsprüfung beim Zuweisen. `excludeChildId` blendet ein Kind aus
// (z.B. das gerade bearbeitete, das ohnehin schon in der Gruppe steht).
export async function countChildrenInGroup(db: D1Database, groupId: string, excludeChildId?: string): Promise<number> {
  const row = excludeChildId
    ? await db
        .prepare("SELECT COUNT(*) as n FROM children WHERE group_id = ? AND status = 'active' AND id != ?")
        .bind(groupId, excludeChildId)
        .first<{ n: number }>()
    : await db
        .prepare("SELECT COUNT(*) as n FROM children WHERE group_id = ? AND status = 'active'")
        .bind(groupId)
        .first<{ n: number }>();
  return row?.n ?? 0;
}

// Austreten lassen statt löschen - Historie (Anwesenheit, Stundennachweis)
// bleibt erhalten, das Kind zählt aber nirgends mehr mit (Kapazität,
// Anwesenheitslisten, aktive Kinder-Zahl) und lässt sich reaktivieren.
export async function archiveChild(db: D1Database, id: string): Promise<Child | null> {
  await db
    .prepare("UPDATE children SET status = 'archived', archived_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return row ? rowToChild(row, true) : null;
}

export async function reactivateChild(db: D1Database, id: string): Promise<Child | null> {
  await db.prepare("UPDATE children SET status = 'active', archived_at = NULL WHERE id = ?").bind(id).run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return row ? rowToChild(row, true) : null;
}

export interface ChildInput {
  firstName: string;
  lastName: string;
  birthDate: string;
  groupId: string | null;
  // Primäre Mandantengrenze (P0-Fix, s. Migration 0036) - MUSS vom Aufrufer
  // gesetzt werden (aus der Zielgruppe oder dem Verein der anlegenden
  // Person), niemals implizit aus group_id abgeleitet hier in db.ts.
  clubId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  familyId: string | null;
}

export async function createChild(db: D1Database, input: ChildInput): Promise<Child> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO children
         (id, first_name, last_name, birth_date, group_id, club_id, emergency_contact_name, emergency_contact_phone, family_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.firstName,
      input.lastName,
      input.birthDate,
      input.groupId,
      input.clubId,
      input.emergencyContactName,
      input.emergencyContactPhone,
      input.familyId
    )
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return rowToChild(row as ChildRow, true);
}

export async function updateChild(db: D1Database, id: string, input: ChildInput): Promise<Child | null> {
  await db
    .prepare(
      `UPDATE children SET first_name = ?, last_name = ?, birth_date = ?, group_id = ?, club_id = ?,
              emergency_contact_name = ?, emergency_contact_phone = ?, family_id = ? WHERE id = ?`
    )
    .bind(
      input.firstName,
      input.lastName,
      input.birthDate,
      input.groupId,
      input.clubId,
      input.emergencyContactName,
      input.emergencyContactPhone,
      input.familyId,
      id
    )
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return row ? rowToChild(row, true) : null;
}

export async function deleteChild(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM children WHERE id = ?").bind(id).run();
}

export interface AttendanceSession {
  entries: AttendanceEntry[];
  ledBy: string | null;
  ledByName: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  note: string | null;
  cancelled: boolean;
  cancelReason: string | null;
}

const EMPTY_ATTENDANCE_SESSION: AttendanceSession = {
  entries: [],
  ledBy: null,
  ledByName: null,
  startTime: null,
  endTime: null,
  location: null,
  note: null,
  cancelled: false,
  cancelReason: null,
};

export async function getAttendance(db: D1Database, groupId: string, sessionDate: string): Promise<AttendanceSession> {
  const session = await db
    .prepare(
      `SELECT s.id as id, s.led_by as led_by, u.name as led_by_name, u.email as led_by_email,
              s.start_time as start_time, s.end_time as end_time, s.location as location, s.note as note,
              s.cancelled as cancelled, s.cancel_reason as cancel_reason
       FROM attendance_sessions s
       LEFT JOIN users u ON u.id = s.led_by
       WHERE s.group_id = ? AND s.session_date = ?`
    )
    .bind(groupId, sessionDate)
    .first<{
      id: string;
      led_by: string | null;
      led_by_name: string | null;
      led_by_email: string | null;
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      note: string | null;
      cancelled: number;
      cancel_reason: string | null;
    }>();
  if (!session) return EMPTY_ATTENDANCE_SESSION;
  const { results } = await db
    .prepare("SELECT child_id, present FROM attendance_entries WHERE session_id = ?")
    .bind(session.id)
    .all<AttendanceEntryRow>();
  return {
    entries: results.map((row) => ({ childId: row.child_id, present: row.present === 1 })),
    ledBy: session.led_by,
    ledByName: session.led_by_name ?? session.led_by_email,
    startTime: session.start_time,
    endTime: session.end_time,
    location: session.location,
    note: session.note,
    cancelled: session.cancelled === 1,
    cancelReason: session.cancel_reason,
  };
}

// Trainingsausfall setzen/aufheben - berührt weder Anwesenheits-Einträge
// noch Leitung/Termin-Überschreibung.
export async function setSessionCancelled(
  db: D1Database,
  groupId: string,
  sessionDate: string,
  cancelled: boolean,
  reason: string | null
): Promise<void> {
  const session = await db
    .prepare("SELECT id FROM attendance_sessions WHERE group_id = ? AND session_date = ?")
    .bind(groupId, sessionDate)
    .first<{ id: string }>();
  if (session) {
    await db
      .prepare("UPDATE attendance_sessions SET cancelled = ?, cancel_reason = ? WHERE id = ?")
      .bind(cancelled ? 1 : 0, cancelled ? reason : null, session.id)
      .run();
  } else if (cancelled) {
    await db
      .prepare("INSERT INTO attendance_sessions (id, group_id, session_date, cancelled, cancel_reason) VALUES (?, ?, ?, 1, ?)")
      .bind(crypto.randomUUID(), groupId, sessionDate, reason)
      .run();
  }
}

export async function getAttendanceRange(
  db: D1Database,
  groupId: string,
  from: string,
  to: string
): Promise<Record<string, AttendanceEntry[]>> {
  const { results } = await db
    .prepare(
      `SELECT s.session_date as session_date, e.child_id, e.present
       FROM attendance_sessions s
       JOIN attendance_entries e ON e.session_id = s.id
       WHERE s.group_id = ? AND s.session_date BETWEEN ? AND ?`
    )
    .bind(groupId, from, to)
    .all<{ session_date: string; child_id: string; present: number }>();

  const map: Record<string, AttendanceEntry[]> = {};
  for (const row of results) {
    (map[row.session_date] ??= []).push({ childId: row.child_id, present: row.present === 1 });
  }
  return map;
}

export interface SessionLeader {
  ledBy: string | null;
  ledByName: string | null;
  isSubstitute: boolean;
}

// Wer hat welchen Termin geleitet, für die "Vertretung"-Anzeige auf der
// Übersicht-Seite. `isSubstitute` = die leitende Person ist nicht die
// Gruppen-Inhaberin (also eine eingetragene Vertretung).
export async function getSessionLeaders(
  db: D1Database,
  groupId: string,
  from: string,
  to: string
): Promise<Record<string, SessionLeader>> {
  const { results } = await db
    .prepare(
      `SELECT s.session_date as session_date, s.led_by as led_by, u.name as led_by_name, u.email as led_by_email, g.owner_id as owner_id
       FROM attendance_sessions s
       JOIN groups g ON g.id = s.group_id
       LEFT JOIN users u ON u.id = s.led_by
       WHERE s.group_id = ? AND s.session_date BETWEEN ? AND ? AND s.led_by IS NOT NULL`
    )
    .bind(groupId, from, to)
    .all<{ session_date: string; led_by: string; led_by_name: string | null; led_by_email: string | null; owner_id: string | null }>();

  const map: Record<string, SessionLeader> = {};
  for (const row of results) {
    map[row.session_date] = {
      ledBy: row.led_by,
      ledByName: row.led_by_name ?? row.led_by_email,
      isSubstitute: row.led_by !== row.owner_id,
    };
  }
  return map;
}

// Abgesagte Trainingstermine im Zeitraum (Datum → Grund) - für die
// Markierung in der Übersicht.
export async function getCancelledSessions(
  db: D1Database,
  groupId: string,
  from: string,
  to: string
): Promise<Record<string, string | null>> {
  const { results } = await db
    .prepare(
      `SELECT session_date, cancel_reason FROM attendance_sessions
       WHERE group_id = ? AND session_date BETWEEN ? AND ? AND cancelled = 1`
    )
    .bind(groupId, from, to)
    .all<{ session_date: string; cancel_reason: string | null }>();
  const map: Record<string, string | null> = {};
  for (const row of results) map[row.session_date] = row.cancel_reason;
  return map;
}

export interface SessionOverrides {
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  note: string | null;
}

// Für die serverseitige BOLA-Prüfung beim Speichern der Anwesenheit
// (Finding aus der Production-Readiness-Prüfung 2026-08-27): der Client
// darf keine childId einer fremden Gruppe/eines fremden Vereins
// unterschieben können - vorher wurde jede syntaktisch gültige UUID
// ungeprüft in attendance_entries geschrieben.
export async function listChildIdsInGroup(db: D1Database, groupId: string): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT id FROM children WHERE group_id = ?").bind(groupId).all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

export async function saveAttendance(
  db: D1Database,
  groupId: string,
  sessionDate: string,
  entries: AttendanceEntry[],
  ledBy: string | null,
  // `null` = Termin-Überschreibung (Uhrzeit/Ort/Notiz) nicht anfassen - z.B.
  // wenn ein abweichender Termin erst noch von der Jugendleitung freigegeben
  // werden muss (siehe attendanceOverrideAccess() in index.ts), die
  // Anwesenheit selbst aber trotzdem sofort gespeichert werden soll.
  overrides: SessionOverrides | null
): Promise<void> {
  let session = await db
    .prepare("SELECT id FROM attendance_sessions WHERE group_id = ? AND session_date = ?")
    .bind(groupId, sessionDate)
    .first<{ id: string }>();

  const sessionId = session?.id ?? crypto.randomUUID();

  const statements: D1PreparedStatement[] = [];
  if (!session) {
    statements.push(
      db
        .prepare(
          "INSERT INTO attendance_sessions (id, group_id, session_date, led_by, start_time, end_time, location, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          sessionId,
          groupId,
          sessionDate,
          ledBy,
          overrides?.startTime ?? null,
          overrides?.endTime ?? null,
          overrides?.location ?? null,
          overrides?.note ?? null
        )
    );
  } else if (overrides) {
    statements.push(
      db
        .prepare(
          `UPDATE attendance_sessions SET
             led_by = COALESCE(?, led_by),
             start_time = ?, end_time = ?, location = ?, note = ?
           WHERE id = ?`
        )
        .bind(ledBy, overrides.startTime, overrides.endTime, overrides.location, overrides.note, sessionId)
    );
  } else {
    statements.push(
      db.prepare("UPDATE attendance_sessions SET led_by = COALESCE(?, led_by) WHERE id = ?").bind(ledBy, sessionId)
    );
  }
  statements.push(db.prepare("DELETE FROM attendance_entries WHERE session_id = ?").bind(sessionId));
  for (const entry of entries) {
    statements.push(
      db
        .prepare("INSERT INTO attendance_entries (session_id, child_id, present) VALUES (?, ?, ?)")
        .bind(sessionId, entry.childId, entry.present ? 1 : 0)
    );
  }
  await db.batch(statements);
}

export interface HourExportRow {
  sessionDate: string;
  groupName: string;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  note: string | null;
  ledByName: string | null;
  ledBy: string | null;
  presentCount: number;
}

// Geleistete Turnstunden im Zeitraum für die übergebenen Gruppen - Basis für
// den CSV-Export (Übungsleiterpauschale/Zuschussnachweis) und den amtlichen
// Stundennachweis. Uhrzeit/Ort können pro Termin von der Gruppen-Vorgabe
// abweichen (Sondertermine wie Turniere) - `s.*` hat Vorrang vor `g.*`.
// `ledByUserId` filtert optional auf eine bestimmte Person (für den
// persönlichen Stundennachweis); Termine ohne eingetragene Leitung werden
// dabei der/dem Gruppenbesitzer:in zugerechnet (Bestandsschutz für Termine
// aus der Zeit vor der Leitungs-Erfassung).
export async function listSessionsForExport(
  db: D1Database,
  groupIds: string[],
  from: string,
  to: string,
  ledByUserId?: string
): Promise<HourExportRow[]> {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map((_, i) => `?${i + 1}`).join(", ");
  const fromIdx = groupIds.length + 1;
  const toIdx = groupIds.length + 2;
  const ledByIdx = groupIds.length + 3;
  const ledByFilter = ledByUserId ? `AND (s.led_by = ?${ledByIdx} OR (s.led_by IS NULL AND g.owner_id = ?${ledByIdx}))` : "";
  const { results } = await db
    .prepare(
      `SELECT s.session_date as session_date,
              g.name as group_name, g.weekday as weekday,
              COALESCE(s.start_time, g.start_time) as start_time,
              COALESCE(s.end_time, g.end_time) as end_time,
              COALESCE(s.location, g.location) as location,
              s.note as note,
              u.name as led_by_name, u.email as led_by_email, s.led_by as led_by,
              (SELECT COUNT(*) FROM attendance_entries e WHERE e.session_id = s.id AND e.present = 1) as present_count
       FROM attendance_sessions s
       JOIN groups g ON g.id = s.group_id
       LEFT JOIN users u ON u.id = s.led_by
       WHERE s.group_id IN (${placeholders}) AND s.session_date BETWEEN ?${fromIdx} AND ?${toIdx} ${ledByFilter}
       ORDER BY s.session_date ASC, g.name ASC`
    )
    .bind(...groupIds, from, to, ...(ledByUserId ? [ledByUserId] : []))
    .all<{
      session_date: string;
      group_name: string;
      weekday: number | null;
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      note: string | null;
      led_by_name: string | null;
      led_by_email: string | null;
      led_by: string | null;
      present_count: number;
    }>();
  return results.map((row) => ({
    sessionDate: row.session_date,
    groupName: row.group_name,
    weekday: row.weekday,
    startTime: row.start_time,
    location: row.location,
    note: row.note,
    ledBy: row.led_by,
    endTime: row.end_time,
    ledByName: row.led_by_name ?? row.led_by_email,
    presentCount: row.present_count,
  }));
}

export interface LedSessionRow {
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  isSubstitute: boolean;
}

// Alle Termine, die eine Person jemals geleitet hat - gruppenübergreifend
// und ohne Zeitraum-Begrenzung. Basis für die Gesamtübersicht "wie viele
// Stunden habe ich insgesamt schon geleitet" (inkl. als Vertretung).
// Termine ohne eingetragene Leitung zählen für die/den Gruppenbesitzer:in
// (Bestandsschutz, wie bei listSessionsForExport).
export async function listAllLedSessionsForUser(db: D1Database, userId: string): Promise<LedSessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.session_date as session_date,
              COALESCE(s.start_time, g.start_time) as start_time,
              COALESCE(s.end_time, g.end_time) as end_time,
              g.owner_id as owner_id, s.led_by as led_by
       FROM attendance_sessions s
       JOIN groups g ON g.id = s.group_id
       WHERE s.led_by = ?1 OR (s.led_by IS NULL AND g.owner_id = ?1)
       ORDER BY s.session_date ASC`
    )
    .bind(userId)
    .all<{ session_date: string; start_time: string | null; end_time: string | null; owner_id: string | null; led_by: string | null }>();

  return results.map((row) => ({
    sessionDate: row.session_date,
    startTime: row.start_time,
    endTime: row.end_time,
    isSubstitute: row.led_by !== null && row.led_by !== row.owner_id,
  }));
}

// --- Gruppenwechsel / Verschiebe-Anfragen ---------------------------------

export async function moveChildToGroup(db: D1Database, childId: string, groupId: string): Promise<void> {
  // club_id muss mit umziehen (P0-Fix, s. Migration 0036) - sonst bliebe
  // ein Kind nach einem Gruppenwechsel in eine andere Vereinsgruppe mit dem
  // club_id des alten Vereins stehen, was die Mandantengrenze verletzt.
  const group = await db.prepare("SELECT club_id FROM groups WHERE id = ?").bind(groupId).first<{ club_id: string | null }>();
  await db
    .prepare("UPDATE children SET group_id = ?, club_id = ? WHERE id = ?")
    .bind(groupId, group?.club_id ?? null, childId)
    .run();
}

export async function getPendingMoveRequestForChild(db: D1Database, childId: string): Promise<MoveRequestRow | null> {
  return db
    .prepare("SELECT * FROM move_requests WHERE child_id = ? AND status = 'pending'")
    .bind(childId)
    .first<MoveRequestRow>();
}

export async function getMoveRequestRowById(db: D1Database, id: string): Promise<MoveRequestRow | null> {
  return db.prepare("SELECT * FROM move_requests WHERE id = ?").bind(id).first<MoveRequestRow>();
}

export async function createMoveRequest(
  db: D1Database,
  input: { childId: string; fromGroupId: string | null; toGroupId: string; requestedBy: string; reason: string }
): Promise<MoveRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO move_requests (id, child_id, from_group_id, to_group_id, requested_by, reason) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.childId, input.fromGroupId, input.toGroupId, input.requestedBy, input.reason)
    .run();
  const row = await db.prepare("SELECT * FROM move_requests WHERE id = ?").bind(id).first<MoveRequestRow>();
  return row as MoveRequestRow;
}

export async function setMoveRequestStatus(
  db: D1Database,
  id: string,
  status: MoveRequestStatus,
  reviewedBy: string | null,
  rejectReason?: string | null
): Promise<void> {
  await db
    .prepare(
      "UPDATE move_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), reject_reason = COALESCE(?, reject_reason) WHERE id = ?"
    )
    .bind(status, reviewedBy, rejectReason ?? null, id)
    .run();
}

type MoveRequestJoinRow = MoveRequestRow & {
  child_first_name: string;
  child_last_name: string;
  from_group_name: string | null;
  to_group_name: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
};

function rowToMoveRequestDetail(row: MoveRequestJoinRow): MoveRequestDetail {
  return {
    id: row.id,
    childId: row.child_id,
    childName: `${row.child_first_name} ${row.child_last_name}`,
    fromGroupId: row.from_group_id,
    fromGroupName: row.from_group_name,
    toGroupId: row.to_group_id,
    toGroupName: row.to_group_name,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by_email ?? null,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    reason: row.reason,
    rejectReason: row.reject_reason,
  };
}

const MOVE_REQUEST_DETAIL_SELECT = `
  SELECT mr.*,
         c.first_name as child_first_name, c.last_name as child_last_name,
         fg.name as from_group_name, tg.name as to_group_name,
         ru.name as requested_by_name, ru.email as requested_by_email
  FROM move_requests mr
  JOIN children c ON c.id = mr.child_id
  JOIN groups tg ON tg.id = mr.to_group_id
  LEFT JOIN groups fg ON fg.id = mr.from_group_id
  LEFT JOIN users ru ON ru.id = mr.requested_by
`;

// Offene Anfragen, die auf die Freigabe des aufrufenden Nutzers warten (er
// besitzt die Zielgruppe).
export async function listIncomingMoveRequests(db: D1Database, userId: string): Promise<MoveRequestDetail[]> {
  const { results } = await db
    .prepare(`${MOVE_REQUEST_DETAIL_SELECT} WHERE mr.status = 'pending' AND tg.owner_id = ?1 ORDER BY mr.created_at ASC`)
    .bind(userId)
    .all<MoveRequestJoinRow>();
  return results.map(rowToMoveRequestDetail);
}

// Vom aufrufenden Nutzer gestellte Anfragen (alle Status, neueste zuerst).
export async function listOutgoingMoveRequests(db: D1Database, userId: string): Promise<MoveRequestDetail[]> {
  const { results } = await db
    .prepare(`${MOVE_REQUEST_DETAIL_SELECT} WHERE mr.requested_by = ?1 ORDER BY mr.created_at DESC LIMIT 50`)
    .bind(userId)
    .all<MoveRequestJoinRow>();
  return results.map(rowToMoveRequestDetail);
}

// Seit `olderThanIso` offene Anfragen, für die noch keine Erinnerung
// verschickt wurde - für den täglichen Reminder-Cron (scheduled() in
// index.ts).
export async function listStaleMoveRequests(db: D1Database, olderThanIso: string): Promise<MoveRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${MOVE_REQUEST_DETAIL_SELECT} WHERE mr.status = 'pending' AND mr.reminded_at IS NULL AND mr.created_at < ?1 ORDER BY mr.created_at ASC`
    )
    .bind(olderThanIso)
    .all<MoveRequestJoinRow>();
  return results.map(rowToMoveRequestDetail);
}

export async function markMoveRequestReminded(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE move_requests SET reminded_at = datetime('now') WHERE id = ?").bind(id).run();
}

// --- Kapazitäts-Anfragen ---------------------------------------------------

export async function createCapacityRequest(
  db: D1Database,
  input: { groupId: string; action: CapacityRequestAction; childId: string | null; payload: unknown; requestedBy: string }
): Promise<CapacityRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO capacity_requests (id, group_id, action, child_id, payload, requested_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.groupId, input.action, input.childId, JSON.stringify(input.payload), input.requestedBy)
    .run();
  const row = await db.prepare("SELECT * FROM capacity_requests WHERE id = ?").bind(id).first<CapacityRequestRow>();
  return row as CapacityRequestRow;
}

export async function getCapacityRequestRowById(db: D1Database, id: string): Promise<CapacityRequestRow | null> {
  return db.prepare("SELECT * FROM capacity_requests WHERE id = ?").bind(id).first<CapacityRequestRow>();
}

export async function setCapacityRequestStatus(
  db: D1Database,
  id: string,
  status: MoveRequestStatus,
  reviewedBy: string | null
): Promise<void> {
  await db
    .prepare("UPDATE capacity_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
    .bind(status, reviewedBy, id)
    .run();
}

type CapacityRequestJoinRow = CapacityRequestRow & {
  group_name: string;
  child_first_name: string | null;
  child_last_name: string | null;
  requested_by_name: string | null;
  requested_by_email: string | null;
};

function rowToCapacityRequestDetail(row: CapacityRequestJoinRow): CapacityRequestDetail {
  let childName = row.child_first_name ? `${row.child_first_name} ${row.child_last_name}` : null;
  if (!childName) {
    try {
      const payload = JSON.parse(row.payload) as { firstName?: string; lastName?: string };
      if (payload.firstName) childName = `${payload.firstName} ${payload.lastName ?? ""}`.trim();
    } catch {
      // Payload sollte immer valides JSON sein - im Zweifel Platzhalter zeigen.
    }
  }
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    action: row.action,
    childId: row.child_id,
    childName: childName ?? "Unbekanntes Kind",
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by_email ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

const CAPACITY_REQUEST_DETAIL_SELECT = `
  SELECT cr.*,
         g.name as group_name,
         c.first_name as child_first_name, c.last_name as child_last_name,
         ru.name as requested_by_name, ru.email as requested_by_email
  FROM capacity_requests cr
  JOIN groups g ON g.id = cr.group_id
  LEFT JOIN children c ON c.id = cr.child_id
  LEFT JOIN users ru ON ru.id = cr.requested_by
`;

// Offene Kapazitäts-Anfragen für Gruppen im übergebenen Verein - für die
// Jugendleitung dieses Vereins.
export async function listIncomingCapacityRequests(db: D1Database, clubId: string): Promise<CapacityRequestDetail[]> {
  const { results } = await db
    .prepare(`${CAPACITY_REQUEST_DETAIL_SELECT} WHERE cr.status = 'pending' AND g.club_id = ?1 ORDER BY cr.created_at ASC`)
    .bind(clubId)
    .all<CapacityRequestJoinRow>();
  return results.map(rowToCapacityRequestDetail);
}

// Vom aufrufenden Nutzer gestellte Kapazitäts-Anfragen (alle Status, neueste zuerst).
export async function listOutgoingCapacityRequests(db: D1Database, userId: string): Promise<CapacityRequestDetail[]> {
  const { results } = await db
    .prepare(`${CAPACITY_REQUEST_DETAIL_SELECT} WHERE cr.requested_by = ?1 ORDER BY cr.created_at DESC LIMIT 50`)
    .bind(userId)
    .all<CapacityRequestJoinRow>();
  return results.map(rowToCapacityRequestDetail);
}

// Seit `olderThanIso` offene Kapazitäts-Anfragen ohne bisherige Erinnerung -
// für den täglichen Reminder-Cron (scheduled() in index.ts).
export async function listStaleCapacityRequests(db: D1Database, olderThanIso: string): Promise<CapacityRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${CAPACITY_REQUEST_DETAIL_SELECT} WHERE cr.status = 'pending' AND cr.reminded_at IS NULL AND cr.created_at < ?1 ORDER BY cr.created_at ASC`
    )
    .bind(olderThanIso)
    .all<CapacityRequestJoinRow>();
  return results.map(rowToCapacityRequestDetail);
}

export async function markCapacityRequestReminded(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE capacity_requests SET reminded_at = datetime('now') WHERE id = ?").bind(id).run();
}

// --- Warteliste --------------------------------------------------------------

export async function addToWaitlist(
  db: D1Database,
  input: { groupId: string; childId: string; requestedBy: string }
): Promise<WaitlistEntryRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO waitlist_entries (id, group_id, child_id, requested_by) VALUES (?, ?, ?, ?)")
    .bind(id, input.groupId, input.childId, input.requestedBy)
    .run();
  const row = await db.prepare("SELECT * FROM waitlist_entries WHERE id = ?").bind(id).first<WaitlistEntryRow>();
  return row as WaitlistEntryRow;
}

export async function getWaitlistEntryById(db: D1Database, id: string): Promise<WaitlistEntryRow | null> {
  return db.prepare("SELECT * FROM waitlist_entries WHERE id = ?").bind(id).first<WaitlistEntryRow>();
}

export async function setWaitlistEntryStatus(db: D1Database, id: string, status: WaitlistStatus): Promise<void> {
  await db
    .prepare("UPDATE waitlist_entries SET status = ?, resolved_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

type WaitlistJoinRow = WaitlistEntryRow & {
  group_name: string;
  child_first_name: string;
  child_last_name: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  position: number;
};

const WAITLIST_DETAIL_SELECT = `
  SELECT w.*,
         g.name as group_name,
         c.first_name as child_first_name, c.last_name as child_last_name,
         ru.name as requested_by_name, ru.email as requested_by_email,
         (SELECT COUNT(*) FROM waitlist_entries w2
          WHERE w2.group_id = w.group_id AND w2.status = 'waiting' AND w2.created_at <= w.created_at) as position
  FROM waitlist_entries w
  JOIN groups g ON g.id = w.group_id
  JOIN children c ON c.id = w.child_id
  LEFT JOIN users ru ON ru.id = w.requested_by
`;

function rowToWaitlistDetail(row: WaitlistJoinRow): WaitlistEntryDetail {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    childId: row.child_id,
    childName: `${row.child_first_name} ${row.child_last_name}`,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by_email ?? null,
    status: row.status,
    position: row.position,
    createdAt: row.created_at,
  };
}

// Warteliste einer Gruppe, wartende Einträge zuerst (nach Position sortiert).
export async function listWaitlistForGroup(db: D1Database, groupId: string): Promise<WaitlistEntryDetail[]> {
  const { results } = await db
    .prepare(`${WAITLIST_DETAIL_SELECT} WHERE w.group_id = ?1 AND w.status = 'waiting' ORDER BY w.created_at ASC`)
    .bind(groupId)
    .all<WaitlistJoinRow>();
  return results.map(rowToWaitlistDetail);
}

export async function listWaitlistForUser(db: D1Database, userId: string): Promise<WaitlistEntryDetail[]> {
  const { results } = await db
    .prepare(`${WAITLIST_DETAIL_SELECT} WHERE w.requested_by = ?1 AND w.status = 'waiting' ORDER BY w.created_at ASC`)
    .bind(userId)
    .all<WaitlistJoinRow>();
  return results.map(rowToWaitlistDetail);
}

// Rückt bei freiem Platz den nächsten wartenden Eintrag nach: verschiebt das
// Kind in die Gruppe und markiert den Eintrag als "promoted". Gibt den
// beförderten Eintrag zurück (für Benachrichtigungen) oder null, wenn die
// Warteliste leer ist.
export async function promoteNextWaitlistEntry(db: D1Database, groupId: string): Promise<WaitlistEntryDetail | null> {
  const { results } = await db
    .prepare(`${WAITLIST_DETAIL_SELECT} WHERE w.group_id = ?1 AND w.status = 'waiting' ORDER BY w.created_at ASC LIMIT 1`)
    .bind(groupId)
    .all<WaitlistJoinRow>();
  const next = results[0];
  if (!next) return null;

  await db.batch([
    db.prepare("UPDATE children SET group_id = ? WHERE id = ?").bind(groupId, next.child_id),
    db.prepare("UPDATE waitlist_entries SET status = 'promoted', resolved_at = datetime('now') WHERE id = ?").bind(next.id),
  ]);
  return rowToWaitlistDetail(next);
}

// --- Benachrichtigungen ------------------------------------------------------

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

export async function createNotification(
  db: D1Database,
  input: { userId: string; type: string; title: string; body: string; link: string | null; childId?: string | null }
): Promise<NotificationRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO notifications (id, user_id, type, title, body, link, child_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.userId, input.type, input.title, input.body, input.link, input.childId ?? null)
    .run();
  const row = await db.prepare("SELECT * FROM notifications WHERE id = ?").bind(id).first<NotificationRow>();
  return row as NotificationRow;
}

// Entfernt bei einer harten Kind-Löschung (DELETE /api/children/:id)
// verbliebene Freitext-Spuren aus audit_log/notifications, die den Namen
// bzw. Kontaktdaten/Gesundheitshinweise des Kindes enthalten könnten -
// sonst blieben die trotz Löschung des children-Datensatzes unbegrenzt
// bestehen (siehe PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-06).
// Der audit_log-Eintrag selbst bleibt (Nachvollziehbarkeit, dass etwas
// passiert ist), nur der Freitext wird anonymisiert.
// PRIV-05 (Retention/Speicherbegrenzung, Art. 5(1)(e) DSGVO): archivierte
// (ausgetretene) Kinder, die seit mindestens `retentionDays` archiviert
// sind. Die konkrete Frist ist eine Konfigurationsgröße (siehe
// ARCHIVED_CHILD_RETENTION_DAYS in wrangler.toml) und bewusst NICHT hier
// hartkodiert - **die tatsächlich zulässige Frist ist LEGAL/PRIVACY REVIEW
// REQUIRED**, s. PRIVACY_SECURITY_GAP_ANALYSIS.md.
export async function listArchivedChildrenOlderThan(db: D1Database, retentionDays: number): Promise<{ id: string; club_id: string | null }[]> {
  const threshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const { results } = await db
    .prepare(
      `SELECT c.id, g.club_id
         FROM children c
         LEFT JOIN groups g ON g.id = c.group_id
        WHERE c.status = 'archived' AND c.archived_at IS NOT NULL AND c.archived_at < ?`
    )
    .bind(threshold)
    .all<{ id: string; club_id: string | null }>();
  return results;
}

export async function redactChildTraces(db: D1Database, childId: string): Promise<void> {
  await db
    .prepare("UPDATE audit_log SET target_label = 'Gelöschtes Kind (Daten entfernt)' WHERE child_id = ?")
    .bind(childId)
    .run();
  await db.prepare("DELETE FROM notifications WHERE child_id = ?").bind(childId).run();
}

export async function listNotificationsForUser(db: D1Database, userId: string, limit = 50): Promise<Notification[]> {
  const { results } = await db
    .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(userId, limit)
    .all<NotificationRow>();
  return results.map(rowToNotification);
}

export async function markNotificationRead(db: D1Database, id: string, userId: string): Promise<void> {
  await db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL")
    .bind(id, userId)
    .run();
}

export async function markAllNotificationsRead(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL")
    .bind(userId)
    .run();
}

// --- Anwesenheits-Trends -------------------------------------------------------

// Letztes Anwesenheitsdatum je Kind - Basis für "seit X Wochen nicht da"
// Hinweise. Kinder ohne jeden Anwesenheitseintrag fehlen im Ergebnis
// (lastPresentDate bleibt für sie null).
export async function getLastPresentDates(db: D1Database, childIds: string[]): Promise<Record<string, string>> {
  if (childIds.length === 0) return {};
  const placeholders = childIds.map((_, i) => `?${i + 1}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT e.child_id as child_id, MAX(s.session_date) as last_date
       FROM attendance_entries e
       JOIN attendance_sessions s ON s.id = e.session_id
       WHERE e.present = 1 AND e.child_id IN (${placeholders})
       GROUP BY e.child_id`
    )
    .bind(...childIds)
    .all<{ child_id: string; last_date: string }>();
  const map: Record<string, string> = {};
  for (const row of results) map[row.child_id] = row.last_date;
  return map;
}

// --- Familien / Geschwister --------------------------------------------------

function rowToFamily(row: FamilyRow): Family {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    createdAt: row.created_at,
  };
}

export interface FamilyInput {
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

export async function createFamily(db: D1Database, input: FamilyInput, createdBy: string): Promise<Family> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO families (id, name, contact_name, contact_phone, contact_email, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.name, input.contactName, input.contactPhone, input.contactEmail, createdBy)
    .run();
  const row = await db.prepare("SELECT * FROM families WHERE id = ?").bind(id).first<FamilyRow>();
  return rowToFamily(row as FamilyRow);
}

export async function getFamilyRowById(db: D1Database, id: string): Promise<FamilyRow | null> {
  return db.prepare("SELECT * FROM families WHERE id = ?").bind(id).first<FamilyRow>();
}

// Familien für die Auswahl "vorhandene Familie/Geschwister zuordnen" im
// Kind-Formular. Vereinsweit sichtbar (nicht nur die eigenen), damit sich
// Geschwister auch gruppenübergreifend verknüpfen lassen - z.B. wenn ein
// Kind bei der eigenen Gruppe und sein Geschwisterkind bei einer anderen
// Übungsleitung im selben Verein trainiert. Ohne Verein (Alt-Konten) bleibt
// es bei den eigenen Familien.
export async function listFamiliesForUser(db: D1Database, userId: string, clubId: string | null): Promise<Family[]> {
  if (clubId) {
    const { results } = await db
      .prepare(
        `SELECT f.* FROM families f
         JOIN users u ON u.id = f.created_by
         WHERE u.club_id = ?
         ORDER BY f.name ASC`
      )
      .bind(clubId)
      .all<FamilyRow>();
    return results.map(rowToFamily);
  }
  const { results } = await db
    .prepare("SELECT * FROM families WHERE created_by = ? ORDER BY name ASC")
    .bind(userId)
    .all<FamilyRow>();
  return results.map(rowToFamily);
}

export async function updateFamily(db: D1Database, id: string, input: FamilyInput): Promise<Family | null> {
  await db
    .prepare("UPDATE families SET name = ?, contact_name = ?, contact_phone = ?, contact_email = ? WHERE id = ?")
    .bind(input.name, input.contactName, input.contactPhone, input.contactEmail, id)
    .run();
  const row = await db.prepare("SELECT * FROM families WHERE id = ?").bind(id).first<FamilyRow>();
  return row ? rowToFamily(row) : null;
}

// --- Audit-Log -----------------------------------------------------------------

export async function logAudit(
  db: D1Database,
  input: {
    clubId: string | null;
    // null nur für automatisierte/System-Aktionen ohne handelnden Nutzer
    // (z.B. Retention-Job) - actor_id hat eine FK-Referenz auf users(id).
    actorId: string | null;
    actorName: string | null;
    action: string;
    targetLabel: string;
    groupId?: string | null;
    // Optional: strukturierte Referenz aufs betroffene Kind, damit bei
    // einer harten Löschung (redactChildTraces) der Freitext-Bezug
    // gefunden und anonymisiert werden kann.
    childId?: string | null;
  }
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO audit_log (id, club_id, actor_id, actor_name, action, target_label, group_id, child_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.clubId, input.actorId, input.actorName, input.action, input.targetLabel, input.groupId ?? null, input.childId ?? null)
    .run();
}

export interface ChildLifecycleEvent {
  kind: "created" | "moved" | "left";
  groupId: string | null;
  createdAt: string;
}

// Rohdaten für die Zu-/Abgänge-Aufschlüsselung in der Mitgliederstatistik -
// die Sichtbarkeitsfilterung nach Gruppe übernimmt das Frontend, genau wie
// bei den Bestandszahlen (dieselben visibleGroups).
export async function listChildLifecycleEventsForClub(db: D1Database, clubId: string): Promise<ChildLifecycleEvent[]> {
  const { results } = await db
    .prepare(
      `SELECT action, group_id, created_at FROM audit_log
       WHERE club_id = ?1 AND action IN ('child.created', 'child.moved', 'move_request.approved', 'child.archived')
       ORDER BY created_at ASC`
    )
    .bind(clubId)
    .all<{ action: string; group_id: string | null; created_at: string }>();
  return results.map((row) => ({
    kind: row.action === "child.created" ? "created" : row.action === "child.archived" ? "left" : "moved",
    groupId: row.group_id,
    createdAt: row.created_at,
  }));
}

// Verlauf: die Jugendleitung sieht alles im Verein, normale Turnleiter*innen
// nur Einträge zu ihren eigenen Gruppen (Einträge ohne Gruppenbezug, z.B.
// Rollenwechsel, sind dann nicht sichtbar).
export async function listAuditLogForClub(
  db: D1Database,
  clubId: string,
  viewer: { userId: string; isJugendleiter: boolean },
  limit = 100
): Promise<AuditLogEntry[]> {
  const { results } = viewer.isJugendleiter
    ? await db
        .prepare("SELECT * FROM audit_log WHERE club_id = ?1 ORDER BY created_at DESC LIMIT ?2")
        .bind(clubId, limit)
        .all<AuditLogRow>()
    : await db
        .prepare("SELECT * FROM audit_log WHERE club_id = ?1 AND actor_id = ?2 ORDER BY created_at DESC LIMIT ?3")
        .bind(clubId, viewer.userId, limit)
        .all<AuditLogRow>();
  return results.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    action: row.action,
    targetLabel: row.target_label,
    createdAt: row.created_at,
  }));
}

// --- Vereinsübergreifende Administration ------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubName: string | null;
  clubRole: ClubRole;
  isAdmin: number;
  lastLoginAt: string | null;
}

export async function listAllUsersForAdmin(db: D1Database): Promise<AdminUserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.club_id as clubId, c.name as clubName, u.club_role as clubRole,
              u.is_admin as isAdmin, u.last_login_at as lastLoginAt
       FROM users u
       LEFT JOIN clubs c ON c.id = u.club_id
       ORDER BY c.name ASC, u.name ASC, u.email ASC`
    )
    .all<AdminUserRow>();
  return results;
}

export async function adminUpdateUser(
  db: D1Database,
  userId: string,
  input: { clubId?: string | null; clubRole?: ClubRole; isAdmin?: boolean }
): Promise<void> {
  if (input.clubId !== undefined) {
    await db.prepare("UPDATE users SET club_id = ? WHERE id = ?").bind(input.clubId, userId).run();
  }
  if (input.clubRole !== undefined) {
    await db.prepare("UPDATE users SET club_role = ? WHERE id = ?").bind(input.clubRole, userId).run();
  }
  if (input.isAdmin !== undefined) {
    await db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").bind(input.isAdmin ? 1 : 0, userId).run();
  }
}

export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

// Admin legt einen neuen Account direkt an (statt wie bisher nur per
// manuellem SQL-Insert über scripts/create-admin.mjs).
export async function createUserAdmin(
  db: D1Database,
  input: {
    email: string;
    name: string | null;
    hash: string;
    salt: string;
    clubId: string | null;
    clubRole: ClubRole;
    isAdmin: boolean;
  }
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, password_salt, club_id, club_role, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.email, input.name, input.hash, input.salt, input.clubId, input.clubRole, input.isAdmin ? 1 : 0)
    .run();
  return { id };
}

export interface SystemAuditLogEntry extends AuditLogEntry {
  clubName: string | null;
}

// Systemweiter Verlauf über alle Vereine hinweg - nur für die Admin-Rolle.
export async function listAuditLogSystemWide(db: D1Database, limit = 200): Promise<SystemAuditLogEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT al.id, al.actor_name, al.action, al.target_label, al.created_at, c.name as club_name
       FROM audit_log al
       LEFT JOIN clubs c ON c.id = al.club_id
       ORDER BY al.created_at DESC
       LIMIT ?1`
    )
    .bind(limit)
    .all<{ id: string; actor_name: string | null; action: string; target_label: string; created_at: string; club_name: string | null }>();
  return results.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    action: row.action,
    targetLabel: row.target_label,
    createdAt: row.created_at,
    clubName: row.club_name,
  }));
}

// --- Vertretungsbörse ----------------------------------------------------------

// Setzt die Leitung für einen Termin, ohne Anwesenheits-Einträge oder
// Uhrzeit/Ort-Überschreibungen anzurühren - für die Übernahme einer
// Vertretungs-Anfrage, bevor die eigentliche Anwesenheit erfasst wurde.
export async function setSessionLeader(db: D1Database, groupId: string, sessionDate: string, ledBy: string | null): Promise<void> {
  const session = await db
    .prepare("SELECT id FROM attendance_sessions WHERE group_id = ? AND session_date = ?")
    .bind(groupId, sessionDate)
    .first<{ id: string }>();
  if (session) {
    await db.prepare("UPDATE attendance_sessions SET led_by = ? WHERE id = ?").bind(ledBy, session.id).run();
  } else if (ledBy !== null) {
    // Kein leerer Datensatz nur zum Zurücksetzen einer Leitung, die es noch
    // nie gab (z.B. beim Zurückgeben einer Vertretung ohne je erfasste
    // Anwesenheit).
    await db
      .prepare("INSERT INTO attendance_sessions (id, group_id, session_date, led_by) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), groupId, sessionDate, ledBy)
      .run();
  }
}

// Nur die Termin-Überschreibung (Uhrzeit/Ort/Notiz) setzen, ohne Einträge
// oder Leitung anzurühren - für die Freigabe eines abweichenden Termins
// durch die Jugendleitung (siehe session_override_requests).
export async function applySessionOverride(
  db: D1Database,
  groupId: string,
  sessionDate: string,
  overrides: SessionOverrides
): Promise<void> {
  const session = await db
    .prepare("SELECT id FROM attendance_sessions WHERE group_id = ? AND session_date = ?")
    .bind(groupId, sessionDate)
    .first<{ id: string }>();
  if (session) {
    await db
      .prepare("UPDATE attendance_sessions SET start_time = ?, end_time = ?, location = ?, note = ? WHERE id = ?")
      .bind(overrides.startTime, overrides.endTime, overrides.location, overrides.note, session.id)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO attendance_sessions (id, group_id, session_date, start_time, end_time, location, note) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), groupId, sessionDate, overrides.startTime, overrides.endTime, overrides.location, overrides.note)
      .run();
  }
}

// --- Abweichende Termine (Freigabe der Jugendleitung) ---------------------------

export async function createSessionOverrideRequest(
  db: D1Database,
  input: {
    groupId: string;
    sessionDate: string;
    requestedBy: string;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    note: string | null;
  }
): Promise<SessionOverrideRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO session_override_requests
         (id, group_id, session_date, requested_by, start_time, end_time, location, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.groupId, input.sessionDate, input.requestedBy, input.startTime, input.endTime, input.location, input.note)
    .run();
  const row = await db
    .prepare("SELECT * FROM session_override_requests WHERE id = ?")
    .bind(id)
    .first<SessionOverrideRequestRow>();
  return row as SessionOverrideRequestRow;
}

export async function getSessionOverrideRequestById(db: D1Database, id: string): Promise<SessionOverrideRequestRow | null> {
  return db.prepare("SELECT * FROM session_override_requests WHERE id = ?").bind(id).first<SessionOverrideRequestRow>();
}

export async function setSessionOverrideRequestStatus(
  db: D1Database,
  id: string,
  status: SessionOverrideRequestStatus
): Promise<void> {
  await db
    .prepare("UPDATE session_override_requests SET status = ?, resolved_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

type SessionOverrideRequestJoinRow = SessionOverrideRequestRow & {
  group_name: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
};

const SESSION_OVERRIDE_REQUEST_DETAIL_SELECT = `
  SELECT r.*, g.name as group_name, u.name as requested_by_name, u.email as requested_by_email
  FROM session_override_requests r
  JOIN groups g ON g.id = r.group_id
  LEFT JOIN users u ON u.id = r.requested_by
`;

function rowToSessionOverrideRequestDetail(row: SessionOverrideRequestJoinRow): SessionOverrideRequestDetail {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    sessionDate: row.session_date,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by_email ?? null,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  };
}

// Offene Anfragen für Gruppen im übergebenen Verein - für die Freigabe durch
// die Jugendleitung.
export async function listPendingSessionOverrideRequestsForClub(db: D1Database, clubId: string): Promise<SessionOverrideRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${SESSION_OVERRIDE_REQUEST_DETAIL_SELECT} WHERE r.status = 'pending' AND g.club_id = ?1 ORDER BY r.created_at ASC`
    )
    .bind(clubId)
    .all<SessionOverrideRequestJoinRow>();
  return results.map(rowToSessionOverrideRequestDetail);
}

// Eigene Anfragen (gestellt), neueste zuerst.
export async function listMySessionOverrideRequests(db: D1Database, userId: string): Promise<SessionOverrideRequestDetail[]> {
  const { results } = await db
    .prepare(`${SESSION_OVERRIDE_REQUEST_DETAIL_SELECT} WHERE r.requested_by = ?1 ORDER BY r.created_at DESC LIMIT 50`)
    .bind(userId)
    .all<SessionOverrideRequestJoinRow>();
  return results.map(rowToSessionOverrideRequestDetail);
}

// Aktive Übernahme einer Vertretung für genau diesen Termin, falls vorhanden
// - bestimmt, wer aktuell schreiben darf: solange eine Anfrage "claimed"
// ist, darf nur die vertretende Person die Anwesenheit erfassen, nicht mehr
// die ursprüngliche Gruppenleitung (siehe attendanceAccess() in index.ts).
export async function getActiveClaimedSubstitute(
  db: D1Database,
  groupId: string,
  sessionDate: string
): Promise<SubstituteRequestRow | null> {
  return db
    .prepare("SELECT * FROM substitute_requests WHERE group_id = ? AND session_date = ? AND status = 'claimed'")
    .bind(groupId, sessionDate)
    .first<SubstituteRequestRow>();
}

// Alle Termine, die eine Person aktuell als Vertretung übernommen hat - für
// die Gruppen-Auswahl und die Datums-Einschränkung auf der Anwesenheit-Seite
// (dort dürfen zusätzlich zum normalen Trainingstag genau diese Termine
// gewählt werden, auch in fremden Gruppen).
export async function listClaimedSubstituteDatesForUser(
  db: D1Database,
  userId: string
): Promise<{ groupId: string; sessionDate: string }[]> {
  const { results } = await db
    .prepare("SELECT group_id, session_date FROM substitute_requests WHERE claimed_by = ? AND status = 'claimed'")
    .bind(userId)
    .all<{ group_id: string; session_date: string }>();
  return results.map((r) => ({ groupId: r.group_id, sessionDate: r.session_date }));
}

// Eine übernommene Vertretung wieder zurückgeben - entweder durch die
// Vertretung selbst oder durch die ursprüngliche Gruppenleitung, die die
// Stunde kurzfristig doch wieder selbst übernehmen will. Setzt die Leitung
// des Termins zurück auf "niemand explizit eingetragen" (fällt im
// Stundennachweis automatisch wieder auf die Gruppenleitung zurück).
export async function returnSubstituteRequest(db: D1Database, id: string, groupId: string, sessionDate: string): Promise<void> {
  await db.prepare("UPDATE substitute_requests SET status = 'returned' WHERE id = ?").bind(id).run();
  await setSessionLeader(db, groupId, sessionDate, null);
}

export async function createSubstituteRequest(
  db: D1Database,
  input: { groupId: string; sessionDate: string; note: string | null; requestedBy: string }
): Promise<SubstituteRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO substitute_requests (id, group_id, session_date, note, requested_by) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.groupId, input.sessionDate, input.note, input.requestedBy)
    .run();
  const row = await db.prepare("SELECT * FROM substitute_requests WHERE id = ?").bind(id).first<SubstituteRequestRow>();
  return row as SubstituteRequestRow;
}

export async function getSubstituteRequestRowById(db: D1Database, id: string): Promise<SubstituteRequestRow | null> {
  return db.prepare("SELECT * FROM substitute_requests WHERE id = ?").bind(id).first<SubstituteRequestRow>();
}

export async function claimSubstituteRequest(db: D1Database, id: string, claimedBy: string): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE substitute_requests SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now') WHERE id = ? AND status = 'open'"
    )
    .bind(claimedBy, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setSubstituteRequestStatus(
  db: D1Database,
  id: string,
  status: SubstituteRequestStatus
): Promise<void> {
  await db.prepare("UPDATE substitute_requests SET status = ? WHERE id = ?").bind(status, id).run();
}

type SubstituteRequestJoinRow = SubstituteRequestRow & {
  group_name: string;
  requested_by_name: string | null;
  requested_by_email: string | null;
  claimed_by_name: string | null;
  claimed_by_email: string | null;
};

function rowToSubstituteRequestDetail(row: SubstituteRequestJoinRow): SubstituteRequestDetail {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name,
    sessionDate: row.session_date,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? row.requested_by_email ?? null,
    note: row.note,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedByName: row.claimed_by_name ?? row.claimed_by_email ?? null,
    createdAt: row.created_at,
  };
}

const SUBSTITUTE_REQUEST_DETAIL_SELECT = `
  SELECT sr.*,
         g.name as group_name,
         ru.name as requested_by_name, ru.email as requested_by_email,
         cu.name as claimed_by_name, cu.email as claimed_by_email
  FROM substitute_requests sr
  JOIN groups g ON g.id = sr.group_id
  LEFT JOIN users ru ON ru.id = sr.requested_by
  LEFT JOIN users cu ON cu.id = sr.claimed_by
`;

// Offene Anfragen für Gruppen im übergebenen Verein - der "Marktplatz".
export async function listOpenSubstituteRequestsForClub(db: D1Database, clubId: string): Promise<SubstituteRequestDetail[]> {
  const { results } = await db
    .prepare(`${SUBSTITUTE_REQUEST_DETAIL_SELECT} WHERE sr.status = 'open' AND g.club_id = ?1 ORDER BY sr.session_date ASC`)
    .bind(clubId)
    .all<SubstituteRequestJoinRow>();
  return results.map(rowToSubstituteRequestDetail);
}

// Anstehende, bereits übernommene Vertretungen im ganzen Verein (heute oder
// später) - für den Vertretungs-Kalender, damit alle sehen, wer an welchem
// Tag für wen einspringt, nicht nur die beiden Beteiligten selbst.
export async function listUpcomingClaimedSubstituteRequestsForClub(
  db: D1Database,
  clubId: string,
  fromDate: string
): Promise<SubstituteRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${SUBSTITUTE_REQUEST_DETAIL_SELECT} WHERE sr.status = 'claimed' AND sr.session_date >= ?2 AND g.club_id = ?1 ORDER BY sr.session_date ASC`
    )
    .bind(clubId, fromDate)
    .all<SubstituteRequestJoinRow>();
  return results.map(rowToSubstituteRequestDetail);
}

// Alle Vertretungs-Anfragen im Verein (jeder Status), neueste zuerst - für
// den vereinsweiten Verlauf, den nur die Jugendleitung sieht (siehe
// GET /api/substitute-requests/club).
export async function listSubstituteRequestsForClub(db: D1Database, clubId: string): Promise<SubstituteRequestDetail[]> {
  const { results } = await db
    .prepare(`${SUBSTITUTE_REQUEST_DETAIL_SELECT} WHERE g.club_id = ?1 ORDER BY sr.created_at DESC LIMIT 100`)
    .bind(clubId)
    .all<SubstituteRequestJoinRow>();
  return results.map(rowToSubstituteRequestDetail);
}

// Eigene Anfragen (gestellt oder übernommen), neueste zuerst.
export async function listMySubstituteRequests(db: D1Database, userId: string): Promise<SubstituteRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${SUBSTITUTE_REQUEST_DETAIL_SELECT} WHERE sr.requested_by = ?1 OR sr.claimed_by = ?1 ORDER BY sr.created_at DESC LIMIT 50`
    )
    .bind(userId)
    .all<SubstituteRequestJoinRow>();
  return results.map(rowToSubstituteRequestDetail);
}

// --- Vereinswarteliste / Platzvorschläge ----------------------------------------

export async function addToClubWaitlist(
  db: D1Database,
  input: { clubId: string; childId: string; note: string | null; addedBy: string }
): Promise<ClubWaitlistRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO club_waitlist_entries (id, club_id, child_id, note, added_by) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.clubId, input.childId, input.note, input.addedBy)
    .run();
  const row = await db.prepare("SELECT * FROM club_waitlist_entries WHERE id = ?").bind(id).first<ClubWaitlistRow>();
  return row as ClubWaitlistRow;
}

export async function getClubWaitlistEntryById(db: D1Database, id: string): Promise<ClubWaitlistRow | null> {
  return db.prepare("SELECT * FROM club_waitlist_entries WHERE id = ?").bind(id).first<ClubWaitlistRow>();
}

export async function setClubWaitlistStatus(db: D1Database, id: string, status: ClubWaitlistStatus): Promise<void> {
  await db
    .prepare("UPDATE club_waitlist_entries SET status = ?, resolved_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

type ClubWaitlistJoinRow = ClubWaitlistRow & {
  child_first_name: string;
  child_last_name: string;
  added_by_name: string | null;
  added_by_email: string | null;
  proposal_id: string | null;
  proposal_group_id: string | null;
  proposal_group_name: string | null;
  proposal_by_name: string | null;
  proposal_by_email: string | null;
  proposal_created_at: string | null;
  proposal_initiated_by_owner: number | null;
};

const CLUB_WAITLIST_DETAIL_SELECT = `
  SELECT w.*,
         c.first_name as child_first_name, c.last_name as child_last_name,
         au.name as added_by_name, au.email as added_by_email,
         pr.id as proposal_id, pr.group_id as proposal_group_id, pg.name as proposal_group_name,
         pu.name as proposal_by_name, pu.email as proposal_by_email, pr.created_at as proposal_created_at,
         pr.initiated_by_owner as proposal_initiated_by_owner
  FROM club_waitlist_entries w
  JOIN children c ON c.id = w.child_id
  LEFT JOIN users au ON au.id = w.added_by
  LEFT JOIN placement_requests pr ON pr.waitlist_entry_id = w.id AND pr.status = 'pending'
  LEFT JOIN groups pg ON pg.id = pr.group_id
  LEFT JOIN users pu ON pu.id = pr.proposed_by
`;

function rowToClubWaitlistDetail(row: ClubWaitlistJoinRow): ClubWaitlistEntryDetail {
  return {
    id: row.id,
    childId: row.child_id,
    childName: `${row.child_first_name} ${row.child_last_name}`,
    note: row.note,
    addedBy: row.added_by,
    addedByName: row.added_by_name ?? row.added_by_email ?? null,
    status: row.status,
    createdAt: row.created_at,
    pendingProposal: row.proposal_id
      ? {
          id: row.proposal_id,
          groupId: row.proposal_group_id as string,
          groupName: row.proposal_group_name as string,
          proposedByName: row.proposal_by_name ?? row.proposal_by_email ?? null,
          createdAt: row.proposal_created_at as string,
          initiatedByOwner: row.proposal_initiated_by_owner === 1,
        }
      : null,
  };
}

export interface ClubWaitlistCandidate {
  entryId: string;
  childId: string;
  childName: string;
  birthDate: string;
}

// Wartende Kinder eines Vereins ohne offenen Platzvorschlag, deren Alter zur
// übergebenen Gruppe passt - Basis für den proaktiven Hinweis "hier wird
// gerade ein Platz frei, folgende Kinder von der Warteliste passen".
export async function listClubWaitlistMatchesForGroup(
  db: D1Database,
  clubId: string,
  group: { min_age: number; max_age: number }
): Promise<ClubWaitlistCandidate[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id as entry_id, c.id as child_id, c.first_name, c.last_name, c.birth_date
       FROM club_waitlist_entries w
       JOIN children c ON c.id = w.child_id
       LEFT JOIN placement_requests pr ON pr.waitlist_entry_id = w.id AND pr.status = 'pending'
       WHERE w.club_id = ?1 AND w.status = 'waiting' AND pr.id IS NULL`
    )
    .bind(clubId)
    .all<{ entry_id: string; child_id: string; first_name: string; last_name: string; birth_date: string }>();
  return results
    .filter((row) => ageFitsGroup(row.birth_date, group))
    .map((row) => ({
      entryId: row.entry_id,
      childId: row.child_id,
      childName: `${row.first_name} ${row.last_name}`,
      birthDate: row.birth_date,
    }));
}

// Jugendleitung eines Vereins - Adressaten für vereinsweite Hinweise wie den
// proaktiven Warteliste-Rückruf.
export async function listClubLeaders(db: D1Database, clubId: string): Promise<{ id: string; name: string | null; email: string }[]> {
  const { results } = await db
    .prepare("SELECT id, name, email FROM users WHERE club_id = ? AND club_role = 'jugendleiter'")
    .bind(clubId)
    .all<{ id: string; name: string | null; email: string }>();
  return results;
}

// Wartende Kinder eines Vereins, jeweils mit offenem Platzvorschlag (falls
// vorhanden) - älteste Einträge zuerst.
export async function listClubWaitlist(db: D1Database, clubId: string): Promise<ClubWaitlistEntryDetail[]> {
  const { results } = await db
    .prepare(`${CLUB_WAITLIST_DETAIL_SELECT} WHERE w.club_id = ?1 AND w.status = 'waiting' ORDER BY w.created_at ASC`)
    .bind(clubId)
    .all<ClubWaitlistJoinRow>();
  return results.map(rowToClubWaitlistDetail);
}

export async function createPlacementRequest(
  db: D1Database,
  input: { waitlistEntryId: string; groupId: string; proposedBy: string; reason?: string | null; initiatedByOwner?: boolean }
): Promise<PlacementRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO placement_requests (id, waitlist_entry_id, group_id, proposed_by, reason, initiated_by_owner) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.waitlistEntryId, input.groupId, input.proposedBy, input.reason ?? null, input.initiatedByOwner ? 1 : 0)
    .run();
  const row = await db.prepare("SELECT * FROM placement_requests WHERE id = ?").bind(id).first<PlacementRequestRow>();
  return row as PlacementRequestRow;
}

export async function getPlacementRequestById(db: D1Database, id: string): Promise<PlacementRequestRow | null> {
  return db.prepare("SELECT * FROM placement_requests WHERE id = ?").bind(id).first<PlacementRequestRow>();
}

export async function setPlacementRequestStatus(
  db: D1Database,
  id: string,
  status: PlacementRequestStatus,
  declineReason?: string | null
): Promise<void> {
  await db
    .prepare(
      "UPDATE placement_requests SET status = ?, resolved_at = datetime('now'), decline_reason = COALESCE(?, decline_reason) WHERE id = ?"
    )
    .bind(status, declineReason ?? null, id)
    .run();
}

type PlacementRequestJoinRow = PlacementRequestRow & {
  child_id: string;
  child_first_name: string;
  child_last_name: string;
  group_name: string;
  proposed_by_name: string | null;
  proposed_by_email: string | null;
};

const PLACEMENT_REQUEST_DETAIL_SELECT = `
  SELECT pr.*,
         w.child_id as child_id,
         c.first_name as child_first_name, c.last_name as child_last_name,
         g.name as group_name,
         pu.name as proposed_by_name, pu.email as proposed_by_email
  FROM placement_requests pr
  JOIN club_waitlist_entries w ON w.id = pr.waitlist_entry_id
  JOIN children c ON c.id = w.child_id
  JOIN groups g ON g.id = pr.group_id
  LEFT JOIN users pu ON pu.id = pr.proposed_by
`;

function rowToPlacementRequestDetail(row: PlacementRequestJoinRow): PlacementRequestDetail {
  return {
    id: row.id,
    waitlistEntryId: row.waitlist_entry_id,
    childId: row.child_id,
    childName: `${row.child_first_name} ${row.child_last_name}`,
    groupId: row.group_id,
    groupName: row.group_name,
    proposedBy: row.proposed_by,
    proposedByName: row.proposed_by_name ?? row.proposed_by_email ?? null,
    status: row.status,
    createdAt: row.created_at,
    initiatedByOwner: row.initiated_by_owner === 1,
    reason: row.reason,
    declineReason: row.decline_reason,
  };
}

// Offene Platzvorschläge der Jugendleitung für Gruppen, die der Nutzer selbst
// leitet - das muss die Gruppenleitung aktiv bestätigen oder ablehnen.
// initiated_by_owner = 0 grenzt das von den eigenen Übernahme-Anfragen ab
// (die bestätigt nicht die Gruppenleitung selbst, sondern die Jugendleitung,
// siehe listPendingPlacementRequestsForClub).
export async function listPendingPlacementRequestsForOwner(db: D1Database, userId: string): Promise<PlacementRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${PLACEMENT_REQUEST_DETAIL_SELECT} WHERE pr.status = 'pending' AND pr.initiated_by_owner = 0 AND g.owner_id = ?1 ORDER BY pr.created_at ASC`
    )
    .bind(userId)
    .all<PlacementRequestJoinRow>();
  return results.map(rowToPlacementRequestDetail);
}

// Offene Übernahme-Anfragen von Gruppenleitungen (initiated_by_owner = 1)
// für Gruppen im übergebenen Verein - das muss die Jugendleitung
// bestätigen oder ablehnen, unabhängig von freier Kapazität.
export async function listPendingPlacementRequestsForClub(db: D1Database, clubId: string): Promise<PlacementRequestDetail[]> {
  const { results } = await db
    .prepare(
      `${PLACEMENT_REQUEST_DETAIL_SELECT} WHERE pr.status = 'pending' AND pr.initiated_by_owner = 1 AND g.club_id = ?1 ORDER BY pr.created_at ASC`
    )
    .bind(clubId)
    .all<PlacementRequestJoinRow>();
  return results.map(rowToPlacementRequestDetail);
}

// --- Vereinsbeitritt -------------------------------------------------------------

export async function createClubJoinRequest(db: D1Database, input: { clubId: string; userId: string }): Promise<ClubJoinRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO club_join_requests (id, club_id, user_id) VALUES (?, ?, ?)")
    .bind(id, input.clubId, input.userId)
    .run();
  const row = await db.prepare("SELECT * FROM club_join_requests WHERE id = ?").bind(id).first<ClubJoinRequestRow>();
  return row as ClubJoinRequestRow;
}

export async function getClubJoinRequestById(db: D1Database, id: string): Promise<ClubJoinRequestRow | null> {
  return db.prepare("SELECT * FROM club_join_requests WHERE id = ?").bind(id).first<ClubJoinRequestRow>();
}

export async function setClubJoinRequestStatus(db: D1Database, id: string, status: ClubJoinRequestStatus): Promise<void> {
  await db
    .prepare("UPDATE club_join_requests SET status = ?, resolved_at = datetime('now') WHERE id = ?")
    .bind(status, id)
    .run();
}

type ClubJoinRequestJoinRow = ClubJoinRequestRow & {
  club_name: string;
  user_name: string | null;
  user_email: string;
};

const CLUB_JOIN_REQUEST_DETAIL_SELECT = `
  SELECT r.*, c.name as club_name, u.name as user_name, u.email as user_email
  FROM club_join_requests r
  JOIN clubs c ON c.id = r.club_id
  JOIN users u ON u.id = r.user_id
`;

function rowToClubJoinRequestDetail(row: ClubJoinRequestJoinRow): ClubJoinRequestDetail {
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name,
    userId: row.user_id,
    userName: row.user_name ?? row.user_email,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listPendingClubJoinRequestsForClub(db: D1Database, clubId: string): Promise<ClubJoinRequestDetail[]> {
  const { results } = await db
    .prepare(`${CLUB_JOIN_REQUEST_DETAIL_SELECT} WHERE r.club_id = ?1 AND r.status = 'pending' ORDER BY r.created_at ASC`)
    .bind(clubId)
    .all<ClubJoinRequestJoinRow>();
  return results.map(rowToClubJoinRequestDetail);
}

export async function getPendingClubJoinRequestForUser(db: D1Database, userId: string): Promise<ClubJoinRequestDetail | null> {
  const row = await db
    .prepare(`${CLUB_JOIN_REQUEST_DETAIL_SELECT} WHERE r.user_id = ?1 AND r.status = 'pending'`)
    .bind(userId)
    .first<ClubJoinRequestJoinRow>();
  return row ? rowToClubJoinRequestDetail(row) : null;
}

// --- Ferien/Feiertage (vereinsspezifisch, zusätzlich zu den fest im
// Frontend hinterlegten RLP-Schulferien) ------------------------------------

function rowToHoliday(row: HolidayRow): Holiday {
  return { id: row.id, label: row.label, start: row.start_date, end: row.end_date };
}

export async function listHolidaysForClub(db: D1Database, clubId: string): Promise<Holiday[]> {
  const { results } = await db
    .prepare("SELECT * FROM holidays WHERE club_id = ?1 ORDER BY start_date ASC")
    .bind(clubId)
    .all<HolidayRow>();
  return results.map(rowToHoliday);
}

export async function createHoliday(
  db: D1Database,
  input: { clubId: string; label: string; start: string; end: string }
): Promise<Holiday> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO holidays (id, club_id, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.clubId, input.label, input.start, input.end)
    .run();
  return { id, label: input.label, start: input.start, end: input.end };
}

// Für den ICS/CSV-Import (siehe POST /api/holidays/import) - fügt mehrere
// Zeiträume in einem Batch ein, statt pro Eintrag einen einzelnen Roundtrip.
export async function createHolidaysBulk(
  db: D1Database,
  clubId: string,
  entries: { label: string; start: string; end: string }[]
): Promise<Holiday[]> {
  const rows = entries.map((entry) => ({ id: crypto.randomUUID(), ...entry }));
  const statements = rows.map((row) =>
    db
      .prepare("INSERT INTO holidays (id, club_id, label, start_date, end_date) VALUES (?, ?, ?, ?, ?)")
      .bind(row.id, clubId, row.label, row.start, row.end)
  );
  if (statements.length > 0) await db.batch(statements);
  return rows.map((row) => ({ id: row.id, label: row.label, start: row.start, end: row.end }));
}

export async function getHolidayRowById(db: D1Database, id: string): Promise<HolidayRow | null> {
  return db.prepare("SELECT * FROM holidays WHERE id = ?").bind(id).first<HolidayRow>();
}

export async function deleteHoliday(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM holidays WHERE id = ?").bind(id).run();
}
