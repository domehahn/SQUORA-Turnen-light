export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  createdAt: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  password_salt: string;
  club_id: string | null;
  created_at: string;
}

export interface Club {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface ClubRow {
  id: string;
  name: string;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  maxChildren: number | null;
  ownerId: string | null;
  ownerName: string | null;
  clubId: string | null;
  canEdit: boolean;
  createdAt: string;
}

export interface GroupRow {
  id: string;
  name: string;
  min_age: number;
  max_age: number;
  sort_order: number;
  max_children: number | null;
  owner_id: string | null;
  club_id: string | null;
  created_at: string;
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  groupId: string | null;
  notes: string | null;
  canEdit: boolean;
  createdAt: string;
}

export interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface AttendanceEntry {
  childId: string;
  present: boolean;
}

export interface AttendanceEntryRow {
  child_id: string;
  present: number;
}
