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

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string; // ISO yyyy-mm-dd
  groupId: string | null;
  notes: string | null;
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
  memberCount: number;
  createdAt: string;
}

export type ClubRole = "member" | "jugendleiter";

export interface ClubMember {
  id: string;
  name: string | null;
  email: string;
  role: ClubRole;
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
