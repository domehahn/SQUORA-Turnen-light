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

export interface ClubMember {
  id: string;
  name: string | null;
  email: string;
}
