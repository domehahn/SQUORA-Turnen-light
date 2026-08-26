export interface Group {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  maxChildren: number | null;
  weekday: number | null; // 0 = Sonntag ... 6 = Samstag
  startTime: string | null; // "HH:MM"
  endTime: string | null; // "HH:MM"
  location: string | null;
  ownerId: string | null;
  ownerName: string | null;
  clubId: string | null;
  canEdit: boolean;
  // true, wenn canEdit ausschließlich daher kommt, dass der/die Nutzer*in
  // Jugendleitung des Vereins ist (nicht Besitzer:in oder Mit-Trainer*in) -
  // fürs Frontend-Label, um das von "echter" Mit-Trainerschaft zu unterscheiden.
  editableAsLeadership: boolean;
  color: string | null;
  createdAt: string;
}

export type ChildStatus = "active" | "archived";

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string; // ISO yyyy-mm-dd
  groupId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  familyId: string | null;
  status: ChildStatus;
  archivedAt: string | null;
  canEdit: boolean;
  createdAt: string;
}

export interface AttendanceEntry {
  childId: string;
  present: boolean;
}

export interface Club {
  id: string;
  name: string;
  clubNumber: string | null;
  memberCount: number;
  createdAt: string;
}

export type ClubRole = "member" | "jugendleiter";

export interface ClubMember {
  id: string;
  name: string | null;
  email: string;
  role: ClubRole;
  isAdmin: number;
  lastLoginAt: string | null;
}

export type MoveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface MoveRequest {
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

export interface MoveChildResponse {
  status: "moved" | "pending";
  groupId?: string;
  requestId?: string;
}

export interface CapacityWarning {
  error: string;
  code: "capacity_exceeded";
  groupName: string;
  currentCount: number;
  maxChildren: number;
}

// Antwort, wenn eine Kapazitätsüberschreitung nicht per Selbstbestätigung
// gelöst werden kann, weil der Verein der Zielgruppe eine (fremde)
// Jugendleitung hat - die Aktion wurde NICHT ausgeführt, sondern als
// Anfrage hinterlegt.
export interface PendingCapacityApproval {
  status: "pending_capacity_approval";
  requestId: string;
  groupName: string;
}

export type CapacityRequestAction = "create_child" | "update_child" | "move_child" | "approve_move_request";

export interface CapacityRequest {
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

export type WaitlistStatus = "waiting" | "promoted" | "cancelled";

export interface WaitlistEntry {
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

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface AttendanceSummary {
  childId: string;
  lastPresentDate: string | null;
  weeksSinceLastPresent: number | null;
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

export interface GroupCoLeader {
  id: string;
  name: string | null;
  email: string;
}

export interface Family {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorName: string | null;
  action: string;
  targetLabel: string;
  createdAt: string;
}

export interface MemberEvent {
  kind: "created" | "moved" | "left";
  groupId: string | null;
  createdAt: string;
}

export interface HoursReportSession {
  day: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  hours: number | null;
  location: string;
}

export interface HoursReportMonth {
  month: number;
  monthName: string;
  sessions: HoursReportSession[];
  totalHours: number;
}

export interface HoursReport {
  year: number;
  quarter: number;
  clubName: string | null;
  clubNumber: string | null;
  userName: string | null;
  months: HoursReportMonth[];
}

export type SubstituteRequestStatus = "open" | "claimed" | "cancelled" | "returned";

export interface SubstituteRequest {
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

export interface HoursSummaryYear {
  year: number;
  ownHours: number;
  substituteHours: number;
  totalHours: number;
  sessionCount: number;
}

export interface HoursSummary {
  ownHours: number;
  substituteHours: number;
  totalHours: number;
  sessionCount: number;
  byYear: HoursSummaryYear[];
}

export type SessionOverrideRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface SessionOverrideRequest {
  id: string;
  groupId: string;
  groupName: string;
  sessionDate: string;
  requestedBy: string | null;
  requestedByName: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  note: string | null;
  status: SessionOverrideRequestStatus;
  createdAt: string;
}

export type ClubJoinRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ClubJoinRequest {
  id: string;
  clubId: string;
  clubName: string;
  userId: string;
  userName: string | null;
  status: ClubJoinRequestStatus;
  createdAt: string;
}

export type ClubWaitlistStatus = "waiting" | "placed" | "cancelled";
export type PlacementRequestStatus = "pending" | "confirmed" | "declined" | "cancelled";

export interface ClubWaitlistEntry {
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
    initiatedByOwner: boolean;
  } | null;
}

export interface PlacementRequest {
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
  initiatedByOwner: boolean;
  reason: string | null;
  declineReason: string | null;
}

export interface SessionLeader {
  ledBy: string | null;
  ledByName: string | null;
  isSubstitute: boolean;
}

export interface Holiday {
  id: string;
  label: string;
  start: string;
  end: string;
}
