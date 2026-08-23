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
  MoveRequestDetail,
  MoveRequestRow,
  MoveRequestStatus,
  Notification,
  NotificationRow,
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
export function canWriteGroup(group: GroupOwnership, userId: string): boolean {
  return group.owner_id === userId || (group.owner_id === null && group.club_id === null);
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

function rowToGroup(row: GroupRow, ctx: { userId: string; ownerName: string | null }): Group {
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
    canEdit: canWriteGroup(row, ctx.userId),
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
    notes: row.notes,
    emergencyContactName: row.emergency_contact_name,
    emergencyContactPhone: row.emergency_contact_phone,
    healthNotes: row.health_notes,
    familyId: row.family_id,
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
    createdAt: row.created_at,
  };
}

function rowToClub(row: ClubRow & { member_count: number | null }): Club {
  return { id: row.id, name: row.name, memberCount: row.member_count ?? 0, createdAt: row.created_at };
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? rowToUser(row) : null;
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
  const row = { id, name, created_at: new Date().toISOString() };
  await db.prepare("INSERT INTO clubs (id, name) VALUES (?, ?)").bind(id, name).run();
  return row;
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
}

export async function listClubMembers(db: D1Database, clubId: string): Promise<ClubMember[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, email, club_role as role FROM users WHERE club_id = ?
       ORDER BY CASE club_role WHEN 'jugendleiter' THEN 0 ELSE 1 END, name ASC, email ASC`
    )
    .bind(clubId)
    .all<ClubMember>();
  return results;
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
export async function listGroupsForUser(db: D1Database, userId: string, clubId: string | null): Promise<Group[]> {
  const { results } = await db
    .prepare(
      `SELECT g.*, u.name as owner_name, u.email as owner_email
       FROM groups g
       LEFT JOIN users u ON u.id = g.owner_id
       WHERE g.owner_id = ?1
          OR (g.club_id IS NOT NULL AND g.club_id = ?2)
          OR (g.owner_id IS NULL AND g.club_id IS NULL)
       ORDER BY g.sort_order ASC, g.min_age ASC`
    )
    .bind(userId, clubId)
    .all<GroupRow & { owner_name: string | null; owner_email: string | null }>();
  return results.map((row) =>
    rowToGroup(row, { userId, ownerName: row.owner_name ?? row.owner_email ?? null })
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
  }
): Promise<Group> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO groups (id, name, min_age, max_age, sort_order, max_children, weekday, start_time, end_time, location, owner_id, club_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      input.clubId
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
  },
  ctx: { userId: string; ownerName: string | null }
): Promise<Group | null> {
  await db
    .prepare(
      `UPDATE groups SET name = ?, min_age = ?, max_age = ?, sort_order = ?, max_children = ?,
              weekday = ?, start_time = ?, end_time = ?, location = ? WHERE id = ?`
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
      id
    )
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return row ? rowToGroup(row, ctx) : null;
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
export async function listChildrenForUser(db: D1Database, userId: string, clubId: string | null): Promise<Child[]> {
  const { results } = await db
    .prepare(
      `SELECT c.*, g.owner_id as group_owner_id, g.club_id as group_club_id
       FROM children c
       LEFT JOIN groups g ON g.id = c.group_id
       WHERE c.group_id IS NULL
          OR g.owner_id = ?1
          OR (g.club_id IS NOT NULL AND g.club_id = ?2)
          OR (g.owner_id IS NULL AND g.club_id IS NULL)
       ORDER BY c.last_name ASC, c.first_name ASC`
    )
    .bind(userId, clubId)
    .all<ChildRow & { group_owner_id: string | null; group_club_id: string | null }>();
  return results.map((row) => {
    const canEdit = row.group_id === null || canWriteGroup({ owner_id: row.group_owner_id, club_id: row.group_club_id }, userId);
    return rowToChild(row, canEdit);
  });
}

export async function getChildRowById(db: D1Database, id: string): Promise<ChildRow | null> {
  return db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
}

// Anzahl der Kinder, die aktuell in einer Gruppe stehen - für die
// Kapazitätsprüfung beim Zuweisen. `excludeChildId` blendet ein Kind aus
// (z.B. das gerade bearbeitete, das ohnehin schon in der Gruppe steht).
export async function countChildrenInGroup(db: D1Database, groupId: string, excludeChildId?: string): Promise<number> {
  const row = excludeChildId
    ? await db
        .prepare("SELECT COUNT(*) as n FROM children WHERE group_id = ? AND id != ?")
        .bind(groupId, excludeChildId)
        .first<{ n: number }>()
    : await db.prepare("SELECT COUNT(*) as n FROM children WHERE group_id = ?").bind(groupId).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface ChildInput {
  firstName: string;
  lastName: string;
  birthDate: string;
  groupId: string | null;
  notes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  healthNotes: string | null;
  familyId: string | null;
}

export async function createChild(db: D1Database, input: ChildInput): Promise<Child> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO children
         (id, first_name, last_name, birth_date, group_id, notes, emergency_contact_name, emergency_contact_phone, health_notes, family_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.firstName,
      input.lastName,
      input.birthDate,
      input.groupId,
      input.notes,
      input.emergencyContactName,
      input.emergencyContactPhone,
      input.healthNotes,
      input.familyId
    )
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return rowToChild(row as ChildRow, true);
}

export async function updateChild(db: D1Database, id: string, input: ChildInput): Promise<Child | null> {
  await db
    .prepare(
      `UPDATE children SET first_name = ?, last_name = ?, birth_date = ?, group_id = ?, notes = ?,
              emergency_contact_name = ?, emergency_contact_phone = ?, health_notes = ?, family_id = ? WHERE id = ?`
    )
    .bind(
      input.firstName,
      input.lastName,
      input.birthDate,
      input.groupId,
      input.notes,
      input.emergencyContactName,
      input.emergencyContactPhone,
      input.healthNotes,
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
}

export async function getAttendance(db: D1Database, groupId: string, sessionDate: string): Promise<AttendanceSession> {
  const session = await db
    .prepare(
      `SELECT s.id as id, s.led_by as led_by, u.name as led_by_name, u.email as led_by_email
       FROM attendance_sessions s
       LEFT JOIN users u ON u.id = s.led_by
       WHERE s.group_id = ? AND s.session_date = ?`
    )
    .bind(groupId, sessionDate)
    .first<{ id: string; led_by: string | null; led_by_name: string | null; led_by_email: string | null }>();
  if (!session) return { entries: [], ledBy: null, ledByName: null };
  const { results } = await db
    .prepare("SELECT child_id, present FROM attendance_entries WHERE session_id = ?")
    .bind(session.id)
    .all<AttendanceEntryRow>();
  return {
    entries: results.map((row) => ({ childId: row.child_id, present: row.present === 1 })),
    ledBy: session.led_by,
    ledByName: session.led_by_name ?? session.led_by_email,
  };
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

export async function saveAttendance(
  db: D1Database,
  groupId: string,
  sessionDate: string,
  entries: AttendanceEntry[],
  ledBy: string | null
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
        .prepare("INSERT INTO attendance_sessions (id, group_id, session_date, led_by) VALUES (?, ?, ?, ?)")
        .bind(sessionId, groupId, sessionDate, ledBy)
    );
  } else if (ledBy !== null) {
    // Nachträglich korrigierbar, z.B. wenn eine Vertretung geleitet hat.
    statements.push(db.prepare("UPDATE attendance_sessions SET led_by = ? WHERE id = ?").bind(ledBy, sessionId));
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
  ledByName: string | null;
  presentCount: number;
}

// Geleistete Turnstunden im Zeitraum für die übergebenen Gruppen - Basis für
// den CSV-Export (Übungsleiterpauschale/Zuschussnachweis).
export async function listSessionsForExport(
  db: D1Database,
  groupIds: string[],
  from: string,
  to: string
): Promise<HourExportRow[]> {
  if (groupIds.length === 0) return [];
  const placeholders = groupIds.map((_, i) => `?${i + 1}`).join(", ");
  const fromIdx = groupIds.length + 1;
  const toIdx = groupIds.length + 2;
  const { results } = await db
    .prepare(
      `SELECT s.session_date as session_date,
              g.name as group_name, g.weekday as weekday, g.start_time as start_time, g.end_time as end_time,
              u.name as led_by_name, u.email as led_by_email,
              (SELECT COUNT(*) FROM attendance_entries e WHERE e.session_id = s.id AND e.present = 1) as present_count
       FROM attendance_sessions s
       JOIN groups g ON g.id = s.group_id
       LEFT JOIN users u ON u.id = s.led_by
       WHERE s.group_id IN (${placeholders}) AND s.session_date BETWEEN ?${fromIdx} AND ?${toIdx}
       ORDER BY s.session_date ASC, g.name ASC`
    )
    .bind(...groupIds, from, to)
    .all<{
      session_date: string;
      group_name: string;
      weekday: number | null;
      start_time: string | null;
      end_time: string | null;
      led_by_name: string | null;
      led_by_email: string | null;
      present_count: number;
    }>();
  return results.map((row) => ({
    sessionDate: row.session_date,
    groupName: row.group_name,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    ledByName: row.led_by_name ?? row.led_by_email,
    presentCount: row.present_count,
  }));
}

// --- Gruppenwechsel / Verschiebe-Anfragen ---------------------------------

export async function moveChildToGroup(db: D1Database, childId: string, groupId: string): Promise<void> {
  await db.prepare("UPDATE children SET group_id = ? WHERE id = ?").bind(groupId, childId).run();
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
  input: { childId: string; fromGroupId: string | null; toGroupId: string; requestedBy: string }
): Promise<MoveRequestRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO move_requests (id, child_id, from_group_id, to_group_id, requested_by) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(id, input.childId, input.fromGroupId, input.toGroupId, input.requestedBy)
    .run();
  const row = await db.prepare("SELECT * FROM move_requests WHERE id = ?").bind(id).first<MoveRequestRow>();
  return row as MoveRequestRow;
}

export async function setMoveRequestStatus(
  db: D1Database,
  id: string,
  status: MoveRequestStatus,
  reviewedBy: string | null
): Promise<void> {
  await db
    .prepare("UPDATE move_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
    .bind(status, reviewedBy, id)
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
  input: { userId: string; type: string; title: string; body: string; link: string | null }
): Promise<NotificationRow> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.userId, input.type, input.title, input.body, input.link)
    .run();
  const row = await db.prepare("SELECT * FROM notifications WHERE id = ?").bind(id).first<NotificationRow>();
  return row as NotificationRow;
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

// Familien, die der Nutzer selbst angelegt hat - für die Auswahl "vorhandene
// Familie/Geschwister zuordnen" im Kind-Formular.
export async function listFamiliesForUser(db: D1Database, userId: string): Promise<Family[]> {
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
  input: { clubId: string | null; actorId: string; actorName: string | null; action: string; targetLabel: string }
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO audit_log (id, club_id, actor_id, actor_name, action, target_label) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.clubId, input.actorId, input.actorName, input.action, input.targetLabel)
    .run();
}

export async function listAuditLogForClub(db: D1Database, clubId: string, limit = 100): Promise<AuditLogEntry[]> {
  const { results } = await db
    .prepare("SELECT * FROM audit_log WHERE club_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(clubId, limit)
    .all<AuditLogRow>();
  return results.map((row) => ({
    id: row.id,
    actorName: row.actor_name,
    action: row.action,
    targetLabel: row.target_label,
    createdAt: row.created_at,
  }));
}
