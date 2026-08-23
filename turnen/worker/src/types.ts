export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  EMAIL?: SendEmail;
  EMAIL_FROM_ADDRESS?: string;
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
  clubNumber: string | null;
  memberCount: number;
  createdAt: string;
}

export interface ClubRow {
  id: string;
  name: string;
  club_number: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  maxChildren: number | null;
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
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
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
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
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  healthNotes: string | null;
  familyId: string | null;
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
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  health_notes: string | null;
  family_id: string | null;
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

// --- Warteliste ------------------------------------------------------------

export type WaitlistStatus = "waiting" | "promoted" | "cancelled";

export interface WaitlistEntryRow {
  id: string;
  group_id: string;
  child_id: string;
  requested_by: string | null;
  status: WaitlistStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface WaitlistEntryDetail {
  id: string;
  groupId: string;
  groupName: string;
  childId: string;
  childName: string;
  requestedBy: string | null;
  requestedByName: string | null;
  status: WaitlistStatus;
  position: number;
  createdAt: string;
}

// --- Benachrichtigungen ------------------------------------------------------

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// --- Anwesenheits-Trends -----------------------------------------------------

export interface AttendanceSummary {
  childId: string;
  lastPresentDate: string | null;
  weeksSinceLastPresent: number | null;
}

// --- Familien / Geschwister --------------------------------------------------

export interface FamilyRow {
  id: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Family {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
}

// --- Audit-Log ---------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  club_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_label: string;
  created_at: string;
  group_id: string | null;
}

export interface AuditLogEntry {
  id: string;
  actorName: string | null;
  action: string;
  targetLabel: string;
  createdAt: string;
}

// --- Stundennachweis ---------------------------------------------------------

export interface HourReportSession {
  date: string; // ISO
  groupName: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  note: string | null;
  hours: number | null; // null, falls Uhrzeit fehlt und keine Dauer berechenbar ist
}

// --- Vertretungsbörse ----------------------------------------------------------

export type SubstituteRequestStatus = "open" | "claimed" | "cancelled" | "returned";

export interface SubstituteRequestRow {
  id: string;
  group_id: string;
  session_date: string;
  requested_by: string | null;
  note: string | null;
  status: SubstituteRequestStatus;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
}

export interface SubstituteRequestDetail {
  id: string;
  groupId: string;
  groupName: string;
  sessionDate: string;
  requestedBy: string | null;
  requestedByName: string | null;
  note: string | null;
  status: SubstituteRequestStatus;
  claimedBy: string | null;
  claimedByName: string | null;
  createdAt: string;
}

// --- Vereinswarteliste / Platzvorschläge ----------------------------------------

export type ClubWaitlistStatus = "waiting" | "placed" | "cancelled";
export type PlacementRequestStatus = "pending" | "confirmed" | "declined" | "cancelled";

export interface ClubWaitlistRow {
  id: string;
  club_id: string;
  child_id: string;
  note: string | null;
  added_by: string | null;
  status: ClubWaitlistStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface PlacementRequestRow {
  id: string;
  waitlist_entry_id: string;
  group_id: string;
  proposed_by: string | null;
  status: PlacementRequestStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface ClubWaitlistEntryDetail {
  id: string;
  childId: string;
  childName: string;
  note: string | null;
  addedBy: string | null;
  addedByName: string | null;
  status: ClubWaitlistStatus;
  createdAt: string;
  pendingProposal: {
    id: string;
    groupId: string;
    groupName: string;
    proposedByName: string | null;
    createdAt: string;
  } | null;
}

export interface PlacementRequestDetail {
  id: string;
  waitlistEntryId: string;
  childId: string;
  childName: string;
  groupId: string;
  groupName: string;
  proposedBy: string | null;
  proposedByName: string | null;
  status: PlacementRequestStatus;
  createdAt: string;
}

// --- Vereinsbeitritt -------------------------------------------------------------

export type ClubJoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ClubJoinRequestRow {
  id: string;
  club_id: string;
  user_id: string;
  status: ClubJoinRequestStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface ClubJoinRequestDetail {
  id: string;
  clubId: string;
  clubName: string;
  userId: string;
  userName: string | null;
  status: ClubJoinRequestStatus;
  createdAt: string;
}
