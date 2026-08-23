export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  FRONTEND_URL: string;
}

export type ClubRole = "member" | "jugendleiter";

export interface User {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubRole: ClubRole;
  createdAt: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  password_salt: string;
  club_id: string | null;
  club_role: ClubRole;
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

export type MoveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface MoveRequestRow {
  id: string;
  child_id: string;
  from_group_id: string | null;
  to_group_id: string;
  requested_by: string | null;
  status: MoveRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface MoveRequestDetail {
  id: string;
  childId: string;
  childName: string;
  fromGroupId: string | null;
  fromGroupName: string | null;
  toGroupId: string;
  toGroupName: string;
  requestedBy: string | null;
  requestedByName: string | null;
  status: MoveRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type CapacityRequestAction = "create_child" | "update_child" | "move_child" | "approve_move_request";

export interface CapacityRequestRow {
  id: string;
  group_id: string;
  action: CapacityRequestAction;
  child_id: string | null;
  payload: string;
  requested_by: string | null;
  status: MoveRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface CapacityRequestDetail {
  id: string;
  groupId: string;
  groupName: string;
  action: CapacityRequestAction;
  childId: string | null;
  childName: string;
  requestedBy: string | null;
  requestedByName: string | null;
  status: MoveRequestStatus;
  createdAt: string;
}
