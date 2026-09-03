export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  // AES-256-GCM-Schlüssel (32 Byte Hex) für die Verschlüsselung von
  // Notfallkontakten - siehe worker/src/crypto.ts und
  // PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-02.
  ENCRYPTION_KEY: string;
  FRONTEND_URL: string;
  // Resend-Schlüssel ausschließlich als Cloudflare Worker Secret setzen.
  // Optional, damit lokale Tests/Entwicklung ohne echten Mailversand laufen.
  RESEND_API_KEY?: string;
  // Signing Secret des Resend-Webhooks (whsec_...), ebenfalls ausschließlich
  // als Worker Secret. Ohne Secret lehnt der Endpoint jedes Event ab.
  RESEND_WEBHOOK_SECRET?: string;
  EMAIL_FROM_ADDRESS?: string;
  // Speicherbegrenzung (Finding PRIV-05, Art. 5(1)(e) DSGVO): Anzahl Tage,
  // die ein archiviertes (ausgetretenes) Kind noch aufbewahrt wird, bevor
  // der tägliche Cron-Job es endgültig löscht/anonymisiert. Bewusst als
  // Konfigurationswert statt Code-Konstante. Auf explizite Nutzerentscheidung
  // (2026-08-27) produktiv auf 1095 Tage (3 Jahre) gesetzt, siehe
  // wrangler.toml. Optional, da bestehende Deployments diese Variable ggf.
  // noch nicht gesetzt haben - dann läuft KEINE automatische Löschung
  // (sicherer Default als "sofort löschen").
  ARCHIVED_CHILD_RETENTION_DAYS?: string;
  // Aufbewahrungsdauer für Security-Tabellen (sessions, login_attempts,
  // used_password_reset_tokens) - täglicher Cron-Job löscht Einträge, die
  // älter als diese Anzahl Tage sind. Wert per Nutzerentscheidung
  // (2026-08-27) auf 90 Tage. Optional, gleiche Logik wie oben: ohne
  // gesetzten Wert läuft kein Cleanup.
  SECURITY_LOG_RETENTION_DAYS?: string;
  // Allgemeine Aufbewahrungsdauer für gelesene und ungelesene In-App-
  // Benachrichtigungen. Ohne gültigen positiven Wert löscht der tägliche
  // Cron sicherheitshalber keine Meldungen.
  NOTIFICATION_RETENTION_DAYS?: string;
  // Objekt-Storage (R2) für eingereichte Stundennachweis-PDFs. Optional, damit
  // lokale Tests ohne Bucket laufen - die Einreichen-Endpunkte antworten dann
  // mit 503.
  HOURS_REPORTS?: R2Bucket;
  // Firebase-Service-Account als JSON-String (Worker Secret) für Push über
  // FCM HTTP v1 (Android nativ + iOS via APNs-Bridge in Firebase). Ohne Wert
  // ist Push ein stiller No-op - genau wie E-Mail ohne RESEND_API_KEY.
  FCM_SERVICE_ACCOUNT_JSON?: string;
}

// --- Vereinsveranstaltungen -------------------------------------------------

export interface EventHelper {
  id: string;
  eventId: string;
  userId: string;
  userName: string | null;
  userEmail: string;
  assignedBy: string | null;
  assignedByName: string | null;
  assignedTask: string | null;
  createdAt: string;
}

export interface ClubEvent {
  id: string;
  clubId: string;
  title: string;
  description: string | null;
  eventDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  requiredTrainers: number;
  tasks: string | null;
  materials: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  helpers: EventHelper[];
  isRegistered: boolean;
}

// --- Material, Pinnwand und Turnplaner --------------------------------------

export interface EquipmentReport {
  id: string;
  clubId: string;
  title: string;
  location: string | null;
  severity: "low" | "medium" | "high";
  status: "open" | "in_progress" | "resolved";
  description: string | null;
  reportedBy: string;
  reportedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulletinPost {
  id: string;
  clubId: string;
  title: string;
  content: string;
  category: "general" | "hall" | "training" | "event" | "urgent";
  authorId: string;
  authorName: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingPlanCanvasData {
  equipment: Array<{
    id: string;
    type: string;
    label: string;
    x: number;
    y: number;
    rotation: number;
    notes?: string;
  }>;
  generalNotes?: string;
  hallLayout?: "full" | "half_left" | "half_right";
}

export interface TrainingPlan {
  id: string;
  clubId: string;
  title: string;
  description: string | null;
  groupId: string | null;
  groupName: string | null;
  canvasData: TrainingPlanCanvasData;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// Springer:in und Kassenwart:in sind KEINE club_role-Werte, sondern additive
// Flags users.is_springer / users.is_kassenwart (Migrationen 0052/0053) -
// beliebig mit der Rolle kombinierbar. So bleibt club_role bei zwei Werten und
// braucht keinen (auf D1 gefährlichen) Tabellen-Rebuild.
export type ClubRole = "member" | "jugendleiter";

export type HoursSubmissionStatus = "submitted" | "settled";

export interface HoursReportSubmissionRow {
  id: string;
  club_id: string;
  user_id: string;
  year: number;
  quarter: number;
  status: HoursSubmissionStatus;
  total_hours: number;
  storage_key: string;
  signed_by_name: string | null;
  submitted_at: string;
  updated_at: string;
  settled_at: string | null;
  settled_by: string | null;
  settled_amount_cents: number | null;
  settled_rate_cents: number | null;
  settled_note: string | null;
}

export interface HoursReportSubmission {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  year: number;
  quarter: number;
  status: HoursSubmissionStatus;
  totalHours: number;
  signedByName: string | null;
  submittedAt: string;
  updatedAt: string;
  settledAt: string | null;
  settledByName: string | null;
  settledAmountCents: number | null;
  settledRateCents: number | null;
  settledNote: string | null;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubRole: ClubRole;
  isSpringer: boolean;
  isKassenwart: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  password_salt: string;
  // Pro Nutzer statt global (Migration 0038, Passwort-Hashing-Härtung) -
  // bestehende Hashes bleiben mit ihrer ursprünglichen Iterationszahl
  // gültig, verifyPassword() braucht sie deshalb explizit statt sich auf
  // eine feste Konstante zu verlassen.
  password_iterations: number;
  club_id: string | null;
  club_role: ClubRole;
  is_springer: number;
  is_kassenwart: number;
  is_admin: number;
  created_at: string;
  // TOTP-MFA (Finding SEC-02) - totp_secret AES-256-GCM-verschlüsselt
  // (crypto.ts), totp_backup_codes JSON-Array von PBKDF2-Hashes.
  totp_secret: string | null;
  totp_enabled: number;
  totp_backup_codes: string | null;
  // Separates Feld für ein neu generiertes, noch nicht bestätigtes Secret
  // (Migration 0041) - ein Setup-/Rotations-Aufruf darf niemals die aktive
  // totp_secret/totp_enabled direkt überschreiben, sonst würde ein einzelner
  // authentifizierter Aufruf ohne weitere Bestätigung eine bestehende,
  // funktionierende MFA deaktivieren.
  pending_totp_secret: string | null;
  // Erzwungener Passwortwechsel (Migration 0040) - true, wenn eine andere
  // Person (Admin oder das Bootstrap-Skript) ein initiales Passwort vergeben
  // hat, das noch nie durch ein selbst gewähltes ersetzt wurde.
  must_change_password: number;
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
  editableAsLeadership: boolean;
  color: string | null;
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
  color: string | null;
  created_at: string;
}

export type ChildStatus = "active" | "archived";

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  groupId: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  familyId: string | null;
  status: ChildStatus;
  archivedAt: string | null;
  canEdit: boolean;
  createdAt: string;
}

export interface ChildRow {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  group_id: string | null;
  // Primäre Mandantengrenze (Finding aus der Production-Readiness-Prüfung,
  // P0) - group_id allein reicht nicht, weil ein Kind vorübergehend ohne
  // Gruppe existieren kann (z.B. Vereins-Warteliste vor Gruppenzuteilung).
  // Nicht Teil des öffentlichen Child-Typs (rein interne Tenant-Prüfung).
  club_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  family_id: string | null;
  status: ChildStatus;
  archived_at: string | null;
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
  reminded_at: string | null;
  reason: string | null;
  reject_reason: string | null;
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
  reason: string | null;
  rejectReason: string | null;
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
  reminded_at: string | null;
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
  // Mandantengrenze, fest beim Anlegen gesetzt (Migration 0039) - siehe
  // dortiger Kommentar. Kann bei sehr alten, nicht rekonstruierbaren
  // Alt-Datensätzen NULL sein.
  club_id: string | null;
}

export interface Family {
  id: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
  clubId: string | null;
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
  // 0 = Jugendleitung schlägt der Gruppenleitung ein Kind vor (die
  // Gruppenleitung bestätigt/lehnt ab); 1 = die Gruppenleitung fragt selbst
  // an, das Kind zu übernehmen (die Jugendleitung bestätigt/lehnt ab).
  initiated_by_owner: number;
  reason: string | null;
  decline_reason: string | null;
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
    initiatedByOwner: boolean;
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
  initiatedByOwner: boolean;
  reason: string | null;
  declineReason: string | null;
}

// --- Abweichende Termine (Freigabe der Jugendleitung) ---------------------------

export type SessionOverrideRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface SessionOverrideRequestRow {
  id: string;
  group_id: string;
  session_date: string;
  requested_by: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  note: string | null;
  status: SessionOverrideRequestStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface SessionOverrideRequestDetail {
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

export interface HolidayRow {
  id: string;
  club_id: string;
  label: string;
  start_date: string;
  end_date: string;
  created_at: string;
}

export interface Holiday {
  id: string;
  label: string;
  start: string;
  end: string;
}
