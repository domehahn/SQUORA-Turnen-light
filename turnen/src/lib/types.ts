export interface Group {
  id: string;
  name: string;
  minAge: number;
  maxAge: number;
  sortOrder: number;
  createdAt: string;
}

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string; // ISO yyyy-mm-dd
  groupId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AttendanceEntry {
  childId: string;
  present: boolean;
}
