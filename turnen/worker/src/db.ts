import type {
  AttendanceEntry,
  AttendanceEntryRow,
  Child,
  ChildRow,
  Group,
  GroupRow,
  User,
  UserRow,
} from "./types";

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    minAge: row.min_age,
    maxAge: row.max_age,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function rowToChild(row: ChildRow): Child {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    groupId: row.group_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function rowToUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function listGroups(db: D1Database): Promise<Group[]> {
  const { results } = await db
    .prepare("SELECT * FROM groups ORDER BY sort_order ASC, min_age ASC")
    .all<GroupRow>();
  return results.map(rowToGroup);
}

export async function createGroup(
  db: D1Database,
  input: { name: string; minAge: number; maxAge: number; sortOrder: number }
): Promise<Group> {
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO groups (id, name, min_age, max_age, sort_order) VALUES (?, ?, ?, ?, ?)")
    .bind(id, input.name, input.minAge, input.maxAge, input.sortOrder)
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return rowToGroup(row as GroupRow);
}

export async function updateGroup(
  db: D1Database,
  id: string,
  input: { name: string; minAge: number; maxAge: number; sortOrder: number }
): Promise<Group | null> {
  await db
    .prepare("UPDATE groups SET name = ?, min_age = ?, max_age = ?, sort_order = ? WHERE id = ?")
    .bind(input.name, input.minAge, input.maxAge, input.sortOrder, id)
    .run();
  const row = await db.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<GroupRow>();
  return row ? rowToGroup(row) : null;
}

export async function deleteGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM groups WHERE id = ?").bind(id).run();
}

export async function listChildren(db: D1Database): Promise<Child[]> {
  const { results } = await db
    .prepare("SELECT * FROM children ORDER BY last_name ASC, first_name ASC")
    .all<ChildRow>();
  return results.map(rowToChild);
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
  return rowToChild(row as ChildRow);
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
  return row ? rowToChild(row) : null;
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
