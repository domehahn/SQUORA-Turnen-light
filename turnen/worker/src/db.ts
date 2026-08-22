import type {
  AttendanceEntry,
  AttendanceEntryRow,
  Child,
  ChildRow,
  Club,
  ClubRow,
  Group,
  GroupRow,
  MoveRequestDetail,
  MoveRequestRow,
  MoveRequestStatus,
  User,
  UserRow,
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
    canEdit,
    createdAt: row.created_at,
  };
}

function rowToUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, clubId: row.club_id, createdAt: row.created_at };
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

export async function setUserClub(db: D1Database, userId: string, clubId: string | null): Promise<void> {
  await db.prepare("UPDATE users SET club_id = ? WHERE id = ?").bind(clubId, userId).run();
}

export async function listClubMembers(
  db: D1Database,
  clubId: string
): Promise<{ id: string; name: string | null; email: string }[]> {
  const { results } = await db
    .prepare("SELECT id, name, email FROM users WHERE club_id = ? ORDER BY name ASC, email ASC")
    .bind(clubId)
    .all<{ id: string; name: string | null; email: string }>();
  return results;
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
    ownerId: string;
    ownerName: string | null;
    clubId: string | null;
  }
): Promise<Group> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO groups (id, name, min_age, max_age, sort_order, max_children, owner_id, club_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.name, input.minAge, input.maxAge, input.sortOrder, input.maxChildren, input.ownerId, input.clubId)
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return rowToGroup(row as GroupRow, { userId: input.ownerId, ownerName: input.ownerName });
}

export async function updateGroup(
  db: D1Database,
  id: string,
  input: { name: string; minAge: number; maxAge: number; sortOrder: number; maxChildren: number | null },
  ctx: { userId: string; ownerName: string | null }
): Promise<Group | null> {
  await db
    .prepare(
      "UPDATE groups SET name = ?, min_age = ?, max_age = ?, sort_order = ?, max_children = ? WHERE id = ?"
    )
    .bind(input.name, input.minAge, input.maxAge, input.sortOrder, input.maxChildren, id)
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return row ? rowToGroup(row, ctx) : null;
}

export async function deleteGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM groups WHERE id = ?").bind(id).run();
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

export async function createChild(
  db: D1Database,
  input: { firstName: string; lastName: string; birthDate: string; groupId: string | null; notes: string | null }
): Promise<Child> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO children (id, first_name, last_name, birth_date, group_id, notes) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, input.firstName, input.lastName, input.birthDate, input.groupId, input.notes)
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return rowToChild(row as ChildRow, true);
}

export async function updateChild(
  db: D1Database,
  id: string,
  input: { firstName: string; lastName: string; birthDate: string; groupId: string | null; notes: string | null }
): Promise<Child | null> {
  await db
    .prepare(
      "UPDATE children SET first_name = ?, last_name = ?, birth_date = ?, group_id = ?, notes = ? WHERE id = ?"
    )
    .bind(input.firstName, input.lastName, input.birthDate, input.groupId, input.notes, id)
    .run();
  const row = await db.prepare("SELECT * FROM children WHERE id = ?").bind(id).first<ChildRow>();
  return row ? rowToChild(row, true) : null;
}

export async function deleteChild(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM children WHERE id = ?").bind(id).run();
}

export async function getAttendance(
  db: D1Database,
  groupId: string,
  sessionDate: string
): Promise<AttendanceEntry[]> {
  const session = await db
    .prepare("SELECT id FROM attendance_sessions WHERE group_id = ? AND session_date = ?")
    .bind(groupId, sessionDate)
    .first<{ id: string }>();
  if (!session) return [];
  const { results } = await db
    .prepare("SELECT child_id, present FROM attendance_entries WHERE session_id = ?")
    .bind(session.id)
    .all<AttendanceEntryRow>();
  return results.map((row) => ({ childId: row.child_id, present: row.present === 1 }));
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
  entries: AttendanceEntry[]
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
        .prepare("INSERT INTO attendance_sessions (id, group_id, session_date) VALUES (?, ?, ?)")
        .bind(sessionId, groupId, sessionDate)
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
