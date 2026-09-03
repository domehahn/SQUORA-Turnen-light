import { Hono } from "hono";
import { Webhook } from "svix";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import * as db from "./db";
import {
  ABSOLUTE_SESSION_SECONDS,
  ACTIVITY_UPDATE_THROTTLE_SECONDS,
  APP_ABSOLUTE_SESSION_SECONDS,
  APP_IDLE_TIMEOUT_SECONDS,
  BACKUP_CODE_ITERATIONS,
  CURRENT_PBKDF2_ITERATIONS,
  IDLE_TIMEOUT_SECONDS,
  hashPassword,
  isPasswordPwned,
  signAccountSetupToken,
  signMfaPendingToken,
  signPasswordResetToken,
  signSessionJwt,
  verifyAccountSetupToken,
  verifyMfaPendingToken,
  verifyPassword,
  verifyPasswordResetToken,
  verifySessionJwt,
} from "./auth";
import { notifyUser, retryFailedEmails, sendEmailOnly } from "./notifications";
import { calendarFeedForToken, createCalendarToken, hashCalendarToken } from "./calendar-feed";
import {
  applyEmailWebhook,
  cleanupExpiredNotifications,
  cleanupOperationalData,
  finishCron,
  getNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  operationsSummary,
  recordOperationalEvent,
  setNotificationPreferences,
  startCron,
} from "./operations";
import { encryptField, decryptField } from "./crypto";
import { base32Decode, base32Encode, generateBackupCodes, generateTotpSecret, totpAuthUri, verifyTotp } from "./totp";
import { redactError } from "./log-redaction";
import {
  normalizedEmail,
  optionalId,
  optionalText,
  requiredText,
  validAgeRange,
  validBool,
  validDate,
  validGroupColor,
  validId,
  validOptionalCount,
  validPassword,
  validSortOrder,
  validTime,
  validWeekday,
} from "./validation";
import type { CapacityRequestRow, Child, ChildRow, ClubRole, Env, Family, GroupRow } from "./types";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

type Variables = {
  userId: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubRole: ClubRole;
  isSpringer: boolean;
  isKassenwart: boolean;
  isAdmin: boolean;
  sessionId: string;
};

type AppEnv = { Bindings: Env; Variables: Variables };

const app = new Hono<AppEnv>();

// Session-Cookie statt Bearer-JWT im localStorage (Session-Management-
// Härtung, externe Production-Readiness-Prüfung 2026-08-27). HttpOnly
// verhindert JS-Zugriff (auch bei einem künftigen XSS), Path-Scope wird
// bewusst auf "/" statt "/turnen-light" gelassen, damit lokale Entwicklung
// (Vite-Proxy auf 127.0.0.1:8787, ohne Präfix) funktioniert - die
// eigentliche Isolation kommt ohnehin vom exakten Host (kein Domain-
// Attribut gesetzt), nicht vom Pfad.
const SESSION_COOKIE_NAME = "turnen_session";

function isLocalRequest(c: { req: { url: string } }): boolean {
  const hostname = new URL(c.req.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function toSqliteDatetime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function parseSqliteDatetime(value: string): number {
  return new Date(`${value.replace(" ", "T")}Z`).getTime();
}

// "app" wird gesetzt, wenn der Login-Request vom nativen Client kommt
// (Header X-Client: turnen-app) - dann längere Timeouts und Token im Body.
const APP_CLIENT_HEADER = "turnen-app";
function requestClient(c: { req: { header: (name: string) => string | undefined } }): "web" | "app" {
  return c.req.header("X-Client") === APP_CLIENT_HEADER ? "app" : "web";
}
// Session-Token aus Authorization: Bearer (native App) ODER Cookie (Browser).
function readSessionToken(c: Context<AppEnv>): { token: string | null; via: "bearer" | "cookie" } {
  const auth = c.req.header("Authorization");
  if (auth && /^Bearer\s+/i.test(auth)) return { token: auth.replace(/^Bearer\s+/i, "").trim(), via: "bearer" };
  return { token: getCookie(c, SESSION_COOKIE_NAME) ?? null, via: "cookie" };
}

async function issueSession(
  c: { req: { url: string; header: (name: string) => string | undefined }; env: Env },
  userId: string,
  client: "web" | "app" = "web"
) {
  const absoluteSeconds = client === "app" ? APP_ABSOLUTE_SESSION_SECONDS : ABSOLUTE_SESSION_SECONDS;
  const absoluteExpiresAt = toSqliteDatetime(new Date(Date.now() + absoluteSeconds * 1000));
  const sessionId = await db.createSession(c.env.DB, {
    userId,
    absoluteExpiresAt,
    userAgent: c.req.header("User-Agent") ?? null,
    ip: c.req.header("CF-Connecting-IP") ?? null,
    client,
  });
  const jwt = await signSessionJwt(userId, sessionId, c.env.JWT_SECRET);
  return { sessionId, jwt };
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], jwt: string): void {
  setCookie(c, SESSION_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: !isLocalRequest(c),
    sameSite: "Strict",
    path: "/",
    maxAge: ABSOLUTE_SESSION_SECONDS,
  });
}

function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

// Origins der nativen Capacitor-App (iOS: capacitor://localhost, Android:
// https://localhost). Der native Client authentisiert sich per Bearer-Token,
// nicht per Cookie - CSRF-Vektor entfällt (s. /api/*-Middleware).
const NATIVE_APP_ORIGINS = new Set(["capacitor://localhost", "https://localhost", "http://localhost"]);

app.use("*", async (c, next) =>
  cors({
    origin: (origin, context) => {
      if (!origin) return null;
      if (origin === new URL(context.env.FRONTEND_URL).origin) return origin;
      if (NATIVE_APP_ORIGINS.has(origin)) return origin;
      const apiHostname = new URL(context.req.url).hostname;
      const isLocalApi = apiHostname === "localhost" || apiHostname === "127.0.0.1";
      const isLocalFrontend = /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
      return isLocalApi && isLocalFrontend ? origin : null;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Client"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next)
);

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});

// CSRF Defense-in-Depth (externe Production-Readiness-Prüfung 2026-08-27,
// CSRF-11-Härtung im zweiten Durchgang 2026-08-27): SameSite=Strict auf dem
// Session-Cookie verhindert bereits, dass ein fremder Origin das Cookie bei
// einem Cross-Site-Request mitschickt - laut OWASP soll das aber nicht die
// einzige Schutzschicht sein (ältere Browser, künftige SameSite-Änderungen,
// Subdomain-Sonderfälle). Zusätzliche serverseitige Prüfung für alle
// zustandsändernden Methoden: Origin (bzw. ersatzweise Sec-Fetch-Site für
// Browser, die bei manchen Requests keinen Origin-Header senden) muss auf
// den eigenen Frontend-Origin bzw. "same-origin" zeigen. GET/HEAD/OPTIONS
// sind lesend und bleiben unangetastet.
//
// Fail-closed bei FEHLENDEN Headern (CSRF-11): früher galt "weder Origin
// noch Sec-Fetch-Site gesetzt -> erlaubt" (Begründung: nicht-browserbasierte
// Clients wie curl). Das ist ein unnötiger Fail-open-Pfad: jeder moderne,
// evergreen Browser sendet bei einem zustandsändernden fetch/XHR/Formular-
// Request IMMER mindestens einen der beiden Header, ob same-origin oder
// cross-origin (seit mehreren Jahren Standardverhalten). Ein Request ganz
// ohne beide Header ist damit so gut wie nie echter, durch eine Person
// ausgelöster Browser-Traffic - sondern typischerweise ein direkter
// HTTP-Client (curl/Postman/Skript). Diese App hat KEINEN legitimen
// nicht-browserbasierten Aufrufer für zustandsändernde Routen (der
// scheduled()-Handler ruft interne Funktionen direkt auf, nie per HTTP
// gegen sich selbst - s. `export default { scheduled }` unten) - der
// Fail-open-Pfad hätte also nur Angriffsfläche ohne echten Nutzen bewahrt.
// Jetzt: fehlen beide Header, wird der Request abgelehnt.
const CSRF_UNSAFE_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function isSameOriginRequest(c: { req: { url: string; header: (name: string) => string | undefined } }, env: Env): boolean {
  const secFetchSite = c.req.header("Sec-Fetch-Site");
  if (secFetchSite) return secFetchSite === "same-origin" || secFetchSite === "none";

  const origin = c.req.header("Origin");
  if (!origin) return false; // weder Origin noch Sec-Fetch-Site gesetzt: kein bekannter legitimer Aufrufer (s.o.)

  if (origin === new URL(env.FRONTEND_URL).origin) return true;
  const apiHostname = new URL(c.req.url).hostname;
  const isLocalApi = apiHostname === "localhost" || apiHostname === "127.0.0.1";
  return isLocalApi && /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
}

app.use("/api/*", async (c, next) => {
  const isVerifiedExternalWebhook = c.req.path === "/api/webhooks/resend";
  // Bearer-Token (native App): kann durch einen Browser nicht cross-site
  // automatisch mitgeschickt werden -> kein CSRF-Vektor, Origin-Prüfung entfällt.
  const hasBearer = /^Bearer\s+/i.test(c.req.header("Authorization") ?? "");
  if (
    CSRF_UNSAFE_METHODS.has(c.req.method) &&
    !isVerifiedExternalWebhook &&
    !hasBearer &&
    !isSameOriginRequest(c, c.env)
  ) {
    return c.json({ error: "Anfrage von fremder Herkunft abgelehnt" }, 403);
  }
  await next();
});

// Öffentlicher Provider-Callback: keine Session, daher eigene kryptografische
// Authentisierung. Der rohe Body muss unverändert in die Svix-Prüfung gehen.
app.post("/api/webhooks/resend", async (c) => {
  if (!c.env.RESEND_WEBHOOK_SECRET) return c.json({ error: "Webhook nicht konfiguriert" }, 503);
  const eventId = c.req.header("svix-id");
  const timestamp = c.req.header("svix-timestamp");
  const signature = c.req.header("svix-signature");
  if (!eventId || !timestamp || !signature) return c.json({ error: "Ungültiger Webhook" }, 400);
  try {
    const payload = await c.req.text();
    const event = new Webhook(c.env.RESEND_WEBHOOK_SECRET).verify(payload, {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    }) as { type?: string; created_at?: string; data?: { email_id?: string } };
    if (!event.type || !event.created_at || !event.data?.email_id) return c.json({ ok: true });
    await applyEmailWebhook(c.env.DB, {
      eventId,
      providerId: event.data.email_id,
      type: event.type,
      createdAt: event.created_at,
    });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Ungültiger Webhook" }, 400);
  }
});

app.get("/api/calendar/feed/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[a-f0-9]{64}$/.test(token)) return c.text("Kalender nicht gefunden", 404);
  const feed = await calendarFeedForToken(c.env.DB, token);
  if (!feed) return c.text("Kalender nicht gefunden", 404);
  return new Response(feed, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=turnen.ics",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Serverseitiges Session-Management (s.o.): das JWT trägt nur eine
// Sitzungs-ID, Gültigkeit/Widerruf/Idle-Timeout leben in der `sessions`-
// Tabelle - eine Sitzung kann damit aktiv beendet werden (Passwort ändern/
// zurücksetzen, MFA deaktivieren, "alle Geräte abmelden"), nicht nur
// passiv ablaufen. 5 Minuten Inaktivität ODER 8 Stunden absolute
// Sitzungsdauer -> Logout, beides serverseitig geprüft, nicht nur im
// Client-Timer.
// Passiver Hintergrund-Traffic, der NICHT als Benutzeraktivität für den
// Idle-Timeout zählen darf (externe Production-Readiness-Prüfung
// 2026-08-27, Finding "5-Minuten-Idle-Timeout funktioniert real nicht"):
// die Benachrichtigungsglocke pollt alle 60 Sekunden GET /api/notifications
// im Hintergrund, solange der Tab offen ist - das hätte jede Session
// unbegrenzt am Leben gehalten, selbst wenn die Person längst nicht mehr
// am Gerät sitzt. Bewusst nur GET (reines Auslesen) exemptiert, nicht die
// POST-Routen zum Als-gelesen-Markieren - das ist eine echte Interaktion.
const IDLE_EXEMPT_GET_PATHS = new Set(["/api/notifications"]);

function isIdleExempt(c: { req: { method: string; path: string } }): boolean {
  return c.req.method === "GET" && IDLE_EXEMPT_GET_PATHS.has(c.req.path);
}

// API-seitige MFA-Durchsetzung für die Platform-Admin-Rolle (is_admin) -
// Nutzerentscheidung 2026-08-27, zweiter Durchgang: MFA war zwischenzeitlich
// für Admin UND Jugendleitung verpflichtend, wurde komplett zurückgenommen,
// jetzt explizit erneut angefordert, aber bewusst nur für is_admin (nicht
// Jugendleitung) - Platform-Admin hat potentiell vereinsübergreifenden
// Zugriff, das ist die höchste Risikostufe. Positivliste (nicht "alles außer
// X"), damit neue Routen standardmäßig gesperrt sind, bis sie hier bewusst
// freigegeben werden - alles, was zum Herausfinden des eigenen Status,
// Abmelden und zur MFA-Einrichtung selbst nötig ist.
const ADMIN_WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Schreib-Pfade, die einem reinen Plattform-Admin (is_admin ohne Jugendleitung)
// trotz Nur-Lese-Regel erlaubt bleiben: das eigene Konto und die
// Plattform-Verwaltung.
const ADMIN_SELF_SERVICE_WRITE_PREFIXES = [
  "/api/admin/",
  "/api/logout",
  "/api/me/password",
  "/api/me/mfa",
  "/api/me/sessions",
  "/api/me/notification-preferences",
  "/api/me/device-tokens",
];
function isAdminSelfServiceWrite(pathname: string): boolean {
  if (pathname === "/api/me") return true;
  return ADMIN_SELF_SERVICE_WRITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

const MFA_ENFORCEMENT_EXEMPT_PATHS = new Set([
  "/api/me",
  "/api/logout",
  "/api/me/mfa",
  "/api/me/mfa/setup",
  "/api/me/mfa/confirm",
  "/api/me/mfa/disable",
  "/api/me/sessions",
  "/api/me/sessions/revoke-all",
  "/api/me/password",
]);

// Erzwungener Passwortwechsel (Nutzeranfrage 2026-08-27): wer mit einem von
// einer anderen Person vergebenen initialen Passwort einloggt (Admin-
// Nutzerverwaltung oder scripts/create-admin.mjs), muss es zuerst über
// PUT /api/me/password ändern, bevor irgendetwas anderes nutzbar ist -
// serverseitig durchgesetzt, nicht nur eine Frontend-Empfehlung.
const PASSWORD_CHANGE_EXEMPT_PATHS = new Set(["/api/me", "/api/logout", "/api/me/password"]);

const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { token, via } = readSessionToken(c);
  // clearSessionCookie nur sinnvoll, wenn die Sitzung per Cookie kam.
  const dropCookie = () => {
    if (via === "cookie") clearSessionCookie(c);
  };
  if (!token) return c.json({ error: "Nicht angemeldet" }, 401);
  try {
    const payload = await verifySessionJwt(token, c.env.JWT_SECRET);
    const session = await db.getSessionById(c.env.DB, payload.sid);
    if (!session || session.revoked_at || session.user_id !== payload.sub) {
      dropCookie();
      return c.json({ error: "Nicht angemeldet" }, 401);
    }
    const now = Date.now();
    if (parseSqliteDatetime(session.absolute_expires_at) < now) {
      await db.revokeSession(c.env.DB, session.id);
      dropCookie();
      return c.json({ error: "Sitzung abgelaufen, bitte erneut anmelden" }, 401);
    }
    const idleTimeout = session.client === "app" ? APP_IDLE_TIMEOUT_SECONDS : IDLE_TIMEOUT_SECONDS;
    const lastActivityMs = parseSqliteDatetime(session.last_activity_at);
    if (now - lastActivityMs > idleTimeout * 1000) {
      await db.revokeSession(c.env.DB, session.id);
      dropCookie();
      return c.json({ error: "Sitzung wegen Inaktivität beendet, bitte erneut anmelden" }, 401);
    }
    // getUserRowById statt getUserById: liefert totp_enabled direkt mit,
    // ohne eine zweite Query nur für die MFA-Durchsetzung unten zu brauchen.
    const user = await db.getUserRowById(c.env.DB, session.user_id);
    if (!user) {
      dropCookie();
      return c.json({ error: "Nicht angemeldet" }, 401);
    }
    c.set("userId", user.id);
    c.set("email", user.email);
    c.set("name", user.name);
    c.set("clubId", user.club_id);
    c.set("clubRole", user.club_role);
    c.set("isSpringer", Boolean(user.is_springer));
    c.set("isKassenwart", Boolean(user.is_kassenwart));
    c.set("isAdmin", Boolean(user.is_admin));
    c.set("sessionId", session.id);

    if (!isIdleExempt(c) && now - lastActivityMs > ACTIVITY_UPDATE_THROTTLE_SECONDS * 1000) {
      await db.touchSessionActivity(c.env.DB, session.id);
    }

    const pathname = new URL(c.req.url).pathname;

    // Erzwungener Passwortwechsel zuerst prüfen (vor MFA) - ein von jemand
    // anderem vergebenes Passwort sollte nicht erst zur MFA-Einrichtung
    // verwendet werden, bevor es überhaupt ersetzt wurde.
    if (user.must_change_password && !PASSWORD_CHANGE_EXEMPT_PATHS.has(pathname)) {
      return c.json(
        { error: "Das Passwort muss vor der weiteren Nutzung geändert werden.", passwordChangeRequired: true },
        403
      );
    }

    // API-seitige MFA-Durchsetzung für Platform-Admin (s. Kommentar oben bei
    // MFA_ENFORCEMENT_EXEMPT_PATHS) - serverseitig, nicht nur im Frontend-
    // Overlay, sonst könnte ein direkter API-Client das umgehen.
    if (user.is_admin && !user.totp_enabled && !MFA_ENFORCEMENT_EXEMPT_PATHS.has(pathname)) {
      return c.json(
        { error: "Zwei-Faktor-Authentifizierung ist für Admin-Accounts erforderlich. Bitte zuerst einrichten.", mfaSetupRequired: true },
        403
      );
    }

    // Plattform-Admin (is_admin) ohne zusätzliche Jugendleitungs-Rolle hat auf
    // Vereinsdaten bewusst NUR Lesezugriff (Nutzerentscheidung 2026-09-01):
    // alles sehen wie die Jugendleitung, aber nichts bearbeiten. Erlaubt
    // bleiben Plattform-Verwaltung (/api/admin/*), die eigene Konto-/MFA-/
    // Session-Pflege und An-/Abmeldung. Positivliste, fail-closed.
    if (
      user.is_admin &&
      user.club_role !== "jugendleiter" &&
      ADMIN_WRITE_METHODS.has(c.req.method) &&
      !isAdminSelfServiceWrite(pathname)
    ) {
      return c.json({ error: "Als Plattform-Admin hast du auf Vereinsdaten nur Lesezugriff." }, 403);
    }
  } catch {
    return c.json({ error: "Nicht angemeldet" }, 401);
  }
  await next();
};

// Vereinsübergreifende Admin-Rolle (users.is_admin) - unabhängig von
// club_role/club_id, für /api/admin/*-Routen. Immer nach requireAuth.
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("isAdmin")) return c.json({ error: "Keine Berechtigung" }, 403);
  await next();
};

// Ein Kind ist bearbeitbar, wenn die zugehörige Gruppe für den Nutzer
// beschreibbar ist (Besitz/Mit-Trainerschaft), der Nutzer Jugendleitung des
// Vereins ist, dem die Gruppe gehört, oder - bei einem noch gruppenlosen
// Kind (z.B. Vereins-Warteliste vor Gruppenzuteilung) - der Nutzer im
// selben Verein ist wie das Kind (child.club_id, s. Migration 0036).
//
// WICHTIG (P0-Fix, externe Production-Readiness-Prüfung 2026-08-27): vorher
// galt "keine Gruppe -> für jede*n authentifizierte*n Nutzer*in bearbeitbar,
// vereinsübergreifend" - ein echter Cross-Tenant-Fehler, sobald mehr als
// ein Verein existiert.
//
// Fail-closed statt Fail-open (P1 "AUTHORIZATION MUSS FAIL CLOSED SEIN",
// externe Production-Readiness-Prüfung 2026-08-27): frühere Fassung hatte
// ZWEI "return true"-Ausnahmen für unbekannte/kaputte Mandantenbeziehungen -
// ein Kind ganz ohne Vereinszuordnung (club_id UND group_id beide NULL) UND
// ein Kind mit einer group_id, die auf keine (mehr) existierende Gruppe
// zeigt. Beides galt als "für alle bearbeitbar". Verifiziert (2026-08-27):
// im produktiven Datenbestand hat JEDES Kind eine club_id und JEDE
// group_id zeigt auf eine existierende Gruppe - beide Ausnahmen waren
// bereits tote Kompatibilitäts-Öffnungen ohne echten Nutzen, aber mit
// echtem Risiko. Eine unbekannte/kaputte Beziehung ist jetzt ein Deny plus
// Security-Event (kein personenbezogener Inhalt im Log).
async function isChildWritable(
  dbEnv: D1Database,
  child: { group_id: string | null; club_id: string | null },
  userId: string,
  ctx?: { clubId: string | null; clubRole: string | null }
): Promise<boolean> {
  if (!child.group_id) {
    if (child.club_id === null) {
      await logSecurityEvent(dbEnv, { actorId: userId, clubId: ctx?.clubId ?? null, action: "security.unknown_tenant_relation_denied" });
      return false;
    }
    return Boolean(ctx?.clubId && ctx.clubId === child.club_id);
  }
  const group = await db.getGroupRowById(dbEnv, child.group_id);
  if (!group) {
    await logSecurityEvent(dbEnv, { actorId: userId, clubId: ctx?.clubId ?? null, action: "security.dangling_group_reference_denied" });
    return false;
  }
  if (ctx && ctx.clubRole === "jugendleiter" && group.club_id && group.club_id === ctx.clubId) return true;
  return db.canWriteGroupAsync(dbEnv, group, userId);
}

// Security-Event-Log für Fail-closed-Deny-Fälle bei unbekannten/kaputten
// Mandantenbeziehungen (s.o.) - bewusst ohne personenbezogenen Inhalt
// (kein Name, keine ID des betroffenen Kindes/der Familie im Klartext-
// Label), nur Aktion + Akteur + Verein.
async function logSecurityEvent(
  dbEnv: D1Database,
  input: { actorId: string | null; clubId: string | null; action: string }
): Promise<void> {
  await db.logAudit(dbEnv, {
    clubId: input.clubId,
    actorId: input.actorId,
    actorName: null,
    action: input.action,
    targetLabel: "Zugriff verweigert (unbekannte Mandantenbeziehung)",
  });
}

// Wer darf die Anwesenheit für genau diesen Termin lesen/erfassen? Normal
// die Gruppenleitung (canWriteGroup) - sobald aber jemand eine
// Vertretungs-Anfrage für exakt diesen Termin übernommen ("claimed") hat,
// wandert das Recht ausschließlich zur vertretenden Person: die
// ursprüngliche Leitung kann sich die Stunde dann nicht mehr selbst
// anrechnen, bis sie per /return zurückgegeben wird.
async function attendanceAccess(
  dbEnv: D1Database,
  group: { owner_id: string | null; club_id: string | null; id: string },
  userId: string,
  sessionDate: string
): Promise<{ allowed: boolean; isSubstituteDate: boolean }> {
  const claim = await db.getActiveClaimedSubstitute(dbEnv, group.id, sessionDate);
  if (claim) {
    return { allowed: claim.claimed_by === userId, isSubstituteDate: true };
  }
  return { allowed: await db.canWriteGroupAsync(dbEnv, group, userId), isSubstituteDate: false };
}

interface CapacityWarning {
  error: string;
  code: "capacity_exceeded";
  groupName: string;
  currentCount: number;
  maxChildren: number;
}

// Prüft, ob das Hinzufügen eines weiteren Kindes die maximale Gruppengröße
// überschreiten würde.
async function capacityWarning(
  dbEnv: D1Database,
  group: { id: string; name: string; max_children: number | null },
  excludeChildId: string | undefined
): Promise<CapacityWarning | null> {
  if (group.max_children === null) return null;
  const count = await db.countChildrenInGroup(dbEnv, group.id, excludeChildId);
  if (count < group.max_children) return null;
  return {
    error: `Kapazität von „${group.name}“ würde überschritten (${count + 1} / ${group.max_children} Kinder).`,
    code: "capacity_exceeded",
    groupName: group.name,
    currentCount: count,
    maxChildren: group.max_children,
  };
}

type CapacityGate =
  | { mode: "ok" }
  // Keine Jugendleitung im Verein (oder Gruppe ohne Verein) bzw. die
  // anfragende Person IST selbst Jugendleitung dieses Vereins: einfache
  // Selbstbestätigung reicht, genau wie bisher.
  | { mode: "self_confirm"; warning: CapacityWarning }
  // Es gibt eine (fremde) Jugendleitung im Verein der Zielgruppe - die
  // Aktion wird nicht sofort ausgeführt, sondern muss dort freigegeben
  // werden.
  | { mode: "leadership_approval"; warning: CapacityWarning };

async function capacityGate(
  dbEnv: D1Database,
  group: { id: string; name: string; max_children: number | null; club_id: string | null },
  excludeChildId: string | undefined,
  requester: { userId: string; clubId: string | null; clubRole: ClubRole }
): Promise<CapacityGate> {
  const warning = await capacityWarning(dbEnv, group, excludeChildId);
  if (!warning) return { mode: "ok" };

  const requesterLeadsThisClub =
    group.club_id !== null && group.club_id === requester.clubId && requester.clubRole === "jugendleiter";
  if (requesterLeadsThisClub) return { mode: "self_confirm", warning };

  const hasLeadership = group.club_id ? (await db.countClubLeaders(dbEnv, group.club_id)) > 0 : false;
  return { mode: hasLeadership ? "leadership_approval" : "self_confirm", warning };
}

interface PendingCapacityApproval {
  status: "pending_capacity_approval";
  requestId: string;
  groupName: string;
}

async function fileCapacityRequest(
  dbEnv: D1Database,
  input: {
    groupId: string;
    groupName: string;
    action: "create_child" | "update_child" | "move_child" | "approve_move_request";
    childId: string | null;
    payload: unknown;
    requestedBy: string;
  }
): Promise<PendingCapacityApproval> {
  const request = await db.createCapacityRequest(dbEnv, {
    groupId: input.groupId,
    action: input.action,
    childId: input.childId,
    payload: input.payload,
    requestedBy: input.requestedBy,
  });
  return { status: "pending_capacity_approval", requestId: request.id, groupName: input.groupName };
}

interface ClubNotificationInput {
  type: string;
  title: string;
  body: string;
  link: string;
  childId?: string | null;
  excludeUserIds?: (string | null | undefined)[];
}

// Vereinsweite Ereignisse landen ausschließlich im In-App-Postfach. So
// bekommen alle Mitglieder denselben Vereinskontext, ohne dass jede
// administrative Kind-Aktion eine Rundmail an den ganzen Verein auslöst.
async function notifyClubInApp(env: Env, clubId: string | null, input: ClubNotificationInput): Promise<void> {
  if (!clubId) return;
  const excluded = new Set(input.excludeUserIds?.filter((id): id is string => Boolean(id)) ?? []);
  const members = await db.listClubMembers(env.DB, clubId);
  for (const member of members) {
    if (excluded.has(member.id)) continue;
    await db.createNotification(env.DB, {
      userId: member.id,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      childId: input.childId,
    });
  }
}

function groupLabel(group: Pick<GroupRow, "name"> | null): string {
  return group ? `„${group.name}“` : "„Ohne Gruppe“";
}

function childMovedBody(childName: string, fromGroup: Pick<GroupRow, "name"> | null, toGroup: Pick<GroupRow, "name"> | null): string {
  return `${childName} wurde von ${groupLabel(fromGroup)} nach ${groupLabel(toGroup)} verschoben.`;
}

function sessionChangedBody(
  group: Pick<GroupRow, "name" | "start_time" | "end_time" | "location">,
  date: string,
  overrides: { startTime: string | null; endTime: string | null; location: string | null }
): string {
  const details: string[] = [];
  if (overrides.startTime !== null || overrides.endTime !== null) {
    const start = overrides.startTime ?? group.start_time;
    const end = overrides.endTime ?? group.end_time;
    if (start || end) details.push(`Uhrzeit: ${start ?? "?"}–${end ?? "?"}`);
  }
  if (overrides.location !== null) details.push(`Ort: ${overrides.location}`);
  return `Der Termin am ${date} in „${group.name}“ wurde geändert${details.length ? ` (${details.join(", ")})` : ""}.`;
}

// Führt die ursprünglich geplante Aktion einer freigegebenen
// Kapazitäts-Anfrage nachträglich aus.
async function applyCapacityRequest(env: Env, request: CapacityRequestRow, approvedBy: string): Promise<void> {
  const dbEnv = env.DB;
  const payload = JSON.parse(request.payload);
  const group = await db.getGroupRowById(dbEnv, request.group_id);
  const actor = await db.getUserById(dbEnv, approvedBy);
  switch (request.action) {
    case "create_child": {
      const child = await db.createChild(dbEnv, payload);
      await db.logAudit(dbEnv, {
        clubId: group?.club_id ?? null,
        actorId: approvedBy,
        actorName: actor?.name ?? null,
        action: "child.created",
        targetLabel: `${child.firstName} ${child.lastName}`,
        groupId: request.group_id,
        childId: child.id,
      });
      await notifyClubInApp(env, group?.club_id ?? null, {
        type: "club_child_created",
        title: "Kind neu hinzugefügt",
        body: `${child.firstName} ${child.lastName} wurde ${group ? `der Gruppe „${group.name}“` : "dem Bereich „Ohne Gruppe“"} hinzugefügt.`,
        link: "/kinder",
        childId: child.id,
      });
      break;
    }
    case "update_child":
      if (request.child_id) {
        const previousChild = await db.getChildRowById(dbEnv, request.child_id);
        const previousGroup = previousChild?.group_id ? await db.getGroupRowById(dbEnv, previousChild.group_id) : null;
        const child = await db.updateChild(dbEnv, request.child_id, payload);
        if (child) {
          await db.logAudit(dbEnv, {
            clubId: group?.club_id ?? null,
            actorId: approvedBy,
            actorName: actor?.name ?? null,
            action: "child.updated",
            targetLabel: `${child.firstName} ${child.lastName}`,
            groupId: request.group_id,
            childId: request.child_id,
          });
          if (previousChild?.group_id !== child.groupId) {
            await notifyClubInApp(env, group?.club_id ?? previousChild?.club_id ?? null, {
              type: "club_child_moved",
              title: "Kind verschoben",
              body: childMovedBody(`${child.firstName} ${child.lastName}`, previousGroup, group),
              link: "/kinder",
              childId: child.id,
            });
          }
        }
      }
      break;
    case "move_child":
      if (request.child_id) {
        const child = await db.getChildRowById(dbEnv, request.child_id);
        const previousGroup = child?.group_id ? await db.getGroupRowById(dbEnv, child.group_id) : null;
        await db.moveChildToGroup(dbEnv, request.child_id, payload.toGroupId);
        await db.logAudit(dbEnv, {
          clubId: group?.club_id ?? null,
          actorId: approvedBy,
          actorName: actor?.name ?? null,
          action: "child.moved",
          targetLabel: `${child?.first_name ?? "?"} ${child?.last_name ?? ""} → ${group?.name ?? "?"}`,
          groupId: request.group_id,
          childId: request.child_id,
        });
        if (child) {
          await notifyClubInApp(env, group?.club_id ?? child.club_id, {
            type: "club_child_moved",
            title: "Kind verschoben",
            body: childMovedBody(`${child.first_name} ${child.last_name}`, previousGroup, group),
            link: "/kinder",
            childId: request.child_id,
          });
        }
      }
      break;
    case "approve_move_request": {
      const moveRequest = await db.getMoveRequestRowById(dbEnv, payload.moveRequestId);
      if (moveRequest && moveRequest.status === "pending") {
        const child = await db.getChildRowById(dbEnv, moveRequest.child_id);
        const previousGroup = child?.group_id ? await db.getGroupRowById(dbEnv, child.group_id) : null;
        await db.moveChildToGroup(dbEnv, moveRequest.child_id, moveRequest.to_group_id);
        await db.setMoveRequestStatus(dbEnv, moveRequest.id, "approved", approvedBy);
        await db.logAudit(dbEnv, {
          clubId: group?.club_id ?? null,
          actorId: approvedBy,
          actorName: actor?.name ?? null,
          action: "child.moved",
          targetLabel: `${child?.first_name ?? "?"} ${child?.last_name ?? ""} → ${group?.name ?? "?"}`,
          groupId: moveRequest.to_group_id,
          childId: moveRequest.child_id,
        });
        if (child) {
          await notifyClubInApp(env, group?.club_id ?? child.club_id, {
            type: "club_child_moved",
            title: "Kind verschoben",
            body: childMovedBody(`${child.first_name} ${child.last_name}`, previousGroup, group),
            link: "/kinder",
            childId: moveRequest.child_id,
          });
        }
      }
      break;
    }
  }
}

// Rückt bei freiem Platz Wartelisten-Einträge nach, solange noch Kapazität
// und Warteliste vorhanden sind. Best effort: Fehler beim Benachrichtigen
// dürfen die eigentliche Aktion (z.B. Kind löschen) nie zum Scheitern
// bringen.
async function promoteWaitlistIfPossible(c: { env: Env }, groupId: string): Promise<void> {
  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group || group.max_children === null) return;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const count = await db.countChildrenInGroup(c.env.DB, groupId);
    if (count >= group.max_children) return;
    const promoted = await db.promoteNextWaitlistEntry(c.env.DB, groupId);
    if (!promoted) return;
    if (promoted.requestedBy) {
      const requester = await db.getUserById(c.env.DB, promoted.requestedBy);
      if (requester) {
        await notifyUser(c.env, {
          userId: requester.id,
          userEmail: requester.email,
          userName: requester.name,
          type: "waitlist_promoted",
          title: `Platz frei in „${group.name}“`,
          body: `${promoted.childName} wurde von der Warteliste in „${group.name}“ nachgerückt.`,
          link: "/gruppen",
          childId: promoted.childId,
        });
      }
    }
    await notifyClubInApp(c.env, group.club_id, {
      type: "club_child_moved",
      title: "Kind verschoben",
      body: `${promoted.childName} ist von der Warteliste in „${group.name}“ nachgerückt.`,
      link: "/kinder",
      childId: promoted.childId,
      excludeUserIds: [promoted.requestedBy],
    });
  }
}

// Proaktiver Hinweis an die Jugendleitung: wird in einer Gruppe Kapazität
// frei, prüfen wir die vereinsweite Warteliste (club_waitlist_entries) auf
// Kinder, die vom Alter her passen würden und noch keinen offenen
// Platzvorschlag haben - ersetzt keine manuelle Prüfung/Freigabe, ist reine
// Erinnerung, damit ein frei gewordener Platz nicht übersehen wird.
async function notifyClubWaitlistOnFreedCapacity(c: { env: Env }, groupId: string): Promise<void> {
  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group || group.max_children === null || !group.club_id) return;

  const count = await db.countChildrenInGroup(c.env.DB, groupId);
  if (count >= group.max_children) return;

  const matches = await db.listClubWaitlistMatchesForGroup(c.env.DB, group.club_id, group);
  if (matches.length === 0) return;

  const freeSlots = group.max_children - count;
  const names = matches.map((m) => m.childName).join(", ");
  const leaders = await db.listClubLeaders(c.env.DB, group.club_id);
  for (const leader of leaders) {
    await notifyUser(c.env, {
      userId: leader.id,
      userEmail: leader.email,
      userName: leader.name,
      type: "waitlist_capacity_freed",
      title: `Platz frei in „${group.name}“ – Warteliste prüfen`,
      body: `In „${group.name}“ ${freeSlots === 1 ? "ist wieder 1 Platz" : `sind wieder ${freeSlots} Plätze`} frei. Von der Warteliste passt vom Alter her: ${names}.`,
      link: "/warteliste",
    });
  }
}

// Rate Limiting/Brute-Force-Schutz: max. LOGIN_MAX_FAILED_ATTEMPTS
// fehlgeschlagene Versuche je E-Mail-Adresse innerhalb von
// LOGIN_WINDOW_MINUTES, danach wird die Adresse unabhängig vom Passwort
// gesperrt, bis das Zeitfenster abläuft (Finding SEC-01). Bewusst pro
// E-Mail statt NUR pro IP, da Cloudflare-Worker-Requests IPs teilen können
// (NAT/Vereins-WLAN/Firmennetz) und eine E-Mail-basierte Sperre robuster
// gegen verteilte Versuche gegen EIN Konto ist.
//
// CI-17-Härtung (zweiter Production-Readiness-Durchgang 2026-08-27):
// zusätzliches, unabhängiges IP-basiertes Limit (deutlich höher als das
// Konto-Limit) schließt die verbleibende Lücke - reines E-Mail-Limit
// schützt NICHT gegen Credential Stuffing/Password Spraying von einer IP
// über VIELE verschiedene Konten, solange jedes einzelne Konto unter
// seinem eigenen Limit bleibt. LOGIN_IP_MAX_FAILED_ATTEMPTS bewusst 3x so
// hoch wie das Konto-Limit, damit ein geteiltes Netz (mehrere Personen,
// mehrere echte Fehlversuche) nicht vorschnell komplett gesperrt wird.
const LOGIN_MAX_FAILED_ATTEMPTS = 10;
const LOGIN_IP_MAX_FAILED_ATTEMPTS = 30;
const LOGIN_WINDOW_MINUTES = 15;

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizedEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!email || !password) return c.json({ error: "E-Mail oder Passwort fehlt" }, 400);

  const ip = c.req.header("CF-Connecting-IP") ?? null;
  const [recentFailures, recentFailuresByIp] = await Promise.all([
    db.countRecentFailedLogins(c.env.DB, email, LOGIN_WINDOW_MINUTES),
    db.countRecentFailedLoginsByIp(c.env.DB, ip, LOGIN_WINDOW_MINUTES),
  ]);
  if (recentFailures >= LOGIN_MAX_FAILED_ATTEMPTS || recentFailuresByIp >= LOGIN_IP_MAX_FAILED_ATTEMPTS) {
    return c.json(
      { error: `Zu viele fehlgeschlagene Anmeldeversuche. Bitte in ${LOGIN_WINDOW_MINUTES} Minuten erneut versuchen.` },
      429
    );
  }

  const userRow = await db.getUserByEmail(c.env.DB, email);
  const valid = userRow
    ? await verifyPassword(password, userRow.password_hash, userRow.password_salt, userRow.password_iterations)
    : false;
  if (!userRow || !valid) {
    await db.recordLoginAttempt(c.env.DB, email, false, ip);
    return c.json({ error: "E-Mail oder Passwort ungültig" }, 401);
  }

  // Transparentes Rehashing (Passwort-Hashing-Härtung): ein erfolgreicher
  // Login mit einem noch auf der alten, niedrigeren Iterationszahl
  // gehashten Passwort hebt den Hash automatisch auf die aktuelle Stufe -
  // niemand muss dafür das Passwort erneut eingeben oder zurücksetzen.
  if (userRow.password_iterations < CURRENT_PBKDF2_ITERATIONS) {
    const rehashed = await hashPassword(password);
    await db.updateUserPassword(c.env.DB, userRow.id, rehashed);
  }

  // Zweiter Faktor (Finding SEC-02): Passwort war korrekt, aber statt der
  // vollen Sitzung gibt es nur ein kurzlebiges Zwischen-Token für
  // POST /api/login/mfa. Kein login_attempts-Erfolgseintrag, bevor der
  // zweite Faktor bestätigt ist.
  if (userRow.totp_enabled) {
    const mfaToken = await signMfaPendingToken(userRow.id, c.env.JWT_SECRET);
    return c.json({ mfaRequired: true, mfaToken });
  }

  const client = requestClient(c);
  const { jwt } = await issueSession(c, userRow.id, client);
  setSessionCookie(c, jwt);
  await db.recordLoginAttempt(c.env.DB, email, true, ip);
  await db.touchLastLogin(c.env.DB, userRow.id);
  return c.json({
    user: { id: userRow.id, email: userRow.email, name: userRow.name },
    // Nur der native Client bekommt das Token zusätzlich im Body (kein Cookie-
    // Zugriff über die WebView-Origin). Der Browser ignoriert dieses Feld.
    ...(client === "app" ? { token: jwt } : {}),
  });
});

app.post("/api/login/mfa", async (c) => {
  const body = await c.req.json().catch(() => null);
  const mfaToken = typeof body?.mfaToken === "string" ? body.mfaToken : null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!mfaToken || !code) return c.json({ error: "MFA-Token oder Code fehlt" }, 400);

  let userId: string;
  try {
    userId = await verifyMfaPendingToken(mfaToken, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: "MFA-Anmeldung abgelaufen, bitte erneut einloggen" }, 401);
  }

  const userRow = await db.getUserRowById(c.env.DB, userId);
  if (!userRow || !userRow.totp_enabled || !userRow.totp_secret) {
    return c.json({ error: "MFA-Anmeldung abgelaufen, bitte erneut einloggen" }, 401);
  }

  const ip = c.req.header("CF-Connecting-IP") ?? null;
  const [recentFailures, recentFailuresByIp] = await Promise.all([
    db.countRecentFailedLogins(c.env.DB, userRow.email, LOGIN_WINDOW_MINUTES),
    db.countRecentFailedLoginsByIp(c.env.DB, ip, LOGIN_WINDOW_MINUTES),
  ]);
  if (recentFailures >= LOGIN_MAX_FAILED_ATTEMPTS || recentFailuresByIp >= LOGIN_IP_MAX_FAILED_ATTEMPTS) {
    return c.json(
      { error: `Zu viele fehlgeschlagene Anmeldeversuche. Bitte in ${LOGIN_WINDOW_MINUTES} Minuten erneut versuchen.` },
      429
    );
  }

  const secretBase32 = await decryptField(userRow.totp_secret, c.env.ENCRYPTION_KEY);
  if (!secretBase32) return c.json({ error: "MFA-Konfiguration beschädigt, bitte neu einrichten" }, 500);
  const secretBytes = base32Decode(secretBase32);
  let ok = await verifyTotp(secretBytes, code);

  // Fallback: Backup-Code statt TOTP-Code (z.B. Authenticator-Gerät
  // verloren) - einmal verwendbar (AUTH-12/AUTH-13). Verbrauch erfolgt über
  // db.tryConsumeBackupCode(): ein atomares `UPDATE ... WHERE used_at IS
  // NULL`, das nur greift, wenn der Code JETZT noch unverbraucht ist. Bei
  // zwei gleichzeitigen Login-Versuchen mit demselben Code gewinnt genau
  // einer - der andere bekommt hier `false` zurück und der Login schlägt
  // fehl, unabhängig davon, dass der Hash-Vergleich zuvor erfolgreich war.
  if (!ok) {
    const activeCodes = await db.listActiveBackupCodes(c.env.DB, userRow.id);
    const normalizedCode = code.toUpperCase().replace(/\s/g, "");
    for (const hc of activeCodes) {
      if (await verifyPassword(normalizedCode, hc.code_hash, hc.code_salt, BACKUP_CODE_ITERATIONS)) {
        const consumed = await db.tryConsumeBackupCode(c.env.DB, hc.id);
        if (!consumed) break; // Race verloren - Code wurde parallel bereits verbraucht.
        ok = true;
        await db.logAudit(c.env.DB, {
          clubId: userRow.club_id,
          actorId: userRow.id,
          actorName: userRow.name,
          action: "mfa.backup_code_used",
          targetLabel: `${activeCodes.length - 1} Backup-Codes verbleibend`,
        });
        break;
      }
    }
  }

  if (!ok) {
    await db.recordLoginAttempt(c.env.DB, userRow.email, false, ip);
    return c.json({ error: "Code ungültig" }, 401);
  }

  const client = requestClient(c);
  const { jwt } = await issueSession(c, userRow.id, client);
  setSessionCookie(c, jwt);
  await db.recordLoginAttempt(c.env.DB, userRow.email, true, ip);
  await db.touchLastLogin(c.env.DB, userRow.id);
  return c.json({
    user: { id: userRow.id, email: userRow.email, name: userRow.name },
    ...(client === "app" ? { token: jwt } : {}),
  });
});

app.post("/api/logout", async (c) => {
  const { token } = readSessionToken(c);
  if (token) {
    try {
      const payload = await verifySessionJwt(token, c.env.JWT_SECRET);
      await db.revokeSession(c.env.DB, payload.sid);
    } catch {
      // Token ungültig/abgelaufen - Cookie trotzdem löschen, kein Fehler nötig.
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/me/mfa", requireAuth, async (c) => {
  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  return c.json({ enabled: Boolean(userRow?.totp_enabled) });
});

// Verifiziert einen TOTP- oder Backup-Code gegen die AKTIVE (bereits
// bestätigte) MFA einer Person - Hilfsfunktion für die Re-Authentifizierung
// bei einer MFA-Rotation (s. POST /api/me/mfa/setup unten). Ein verwendeter
// Backup-Code wird dabei immer atomar verbraucht (tryConsumeBackupCode) und ist
// danach ungültig (P1 Security Hardening).
async function verifyActiveMfaCode(
  db_: D1Database,
  userRow: { id: string; totp_secret: string | null },
  code: string,
  encryptionKey: string
): Promise<boolean> {
  if (!userRow.totp_secret) return false;
  const secretBase32 = await decryptField(userRow.totp_secret, encryptionKey);
  if (secretBase32 && (await verifyTotp(base32Decode(secretBase32), code))) return true;
  const activeCodes = await db.listActiveBackupCodes(db_, userRow.id);
  const normalizedCode = code.toUpperCase().replace(/\s/g, "");
  for (const hc of activeCodes) {
    if (await verifyPassword(normalizedCode, hc.code_hash, hc.code_salt, BACKUP_CODE_ITERATIONS)) {
      const consumed = await db.tryConsumeBackupCode(db_, hc.id);
      if (consumed) return true;
    }
  }
  return false;
}

// MFA-Rotation gehärtet (externe Production-Readiness-Prüfung 2026-08-27,
// P1 "MFA SETUP / ROTATION ABSICHERN"): dieser Aufruf schreibt nur noch
// pending_totp_secret (s. db.setPendingTotpSecret) - eine bereits aktive,
// funktionierende MFA bleibt bis zur erfolgreichen Bestätigung des NEUEN
// Codes vollständig unangetastet. Zusätzlich jetzt immer Passwort-
// Re-Authentifizierung nötig; ist bereits eine MFA aktiv, zusätzlich der
// AKTUELLE zweite Faktor (TOTP oder Backup-Code) - sonst könnte eine
// gekaperte Sitzung allein (ohne Passwort/TOTP-Kenntnis) eine Rotation
// anstoßen und mit einem eigenen QR-Code fortsetzen.
app.post("/api/me/mfa/setup", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const currentCode = typeof body?.currentCode === "string" ? body.currentCode.trim() : "";

  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  if (!userRow) return c.json({ error: "Nicht angemeldet" }, 401);
  if (!(await verifyPassword(password, userRow.password_hash, userRow.password_salt, userRow.password_iterations))) {
    return c.json({ error: "Passwort falsch" }, 403);
  }
  if (userRow.totp_enabled) {
    if (!currentCode) return c.json({ error: "Aktueller MFA-Code erforderlich, um die MFA neu einzurichten" }, 400);
    if (!(await verifyActiveMfaCode(c.env.DB, userRow, currentCode, c.env.ENCRYPTION_KEY))) {
      return c.json({ error: "Aktueller MFA-Code ungültig" }, 403);
    }
  }

  const secret = generateTotpSecret();
  const encrypted = await encryptField(base32Encode(secret), c.env.ENCRYPTION_KEY);
  if (encrypted === null) return c.json({ error: "Verschlüsselung fehlgeschlagen" }, 500);
  await db.setPendingTotpSecret(c.env.DB, c.get("userId"), encrypted);
  return c.json({
    secret: base32Encode(secret),
    otpauthUri: totpAuthUri(secret, c.get("email") ?? ""),
  });
});

app.post("/api/me/mfa/confirm", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!code) return c.json({ error: "Code fehlt" }, 400);

  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  if (!userRow?.pending_totp_secret) return c.json({ error: "Keine MFA-Einrichtung gestartet" }, 400);

  const secretBase32 = await decryptField(userRow.pending_totp_secret, c.env.ENCRYPTION_KEY);
  if (!secretBase32) return c.json({ error: "MFA-Konfiguration beschädigt, bitte neu einrichten" }, 500);
  const ok = await verifyTotp(base32Decode(secretBase32), code);
  // Falscher Code bei einer Rotation: pending_totp_secret bleibt zwar
  // bestehen (nächster Versuch möglich), die AKTIVE, bereits eingerichtete
  // MFA bleibt aber unverändert funktionsfähig - kein Zustand, in dem
  // jemand ohne funktionierende MFA dasteht.
  if (!ok) return c.json({ error: "Code ungültig" }, 400);

  const wasRotation = Boolean(userRow.totp_enabled);
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = await Promise.all(
    backupCodes.map(async (bc) => {
      const { hash, salt } = await hashPassword(bc, BACKUP_CODE_ITERATIONS);
      return { hash, salt };
    })
  );
  // Atomar (db.batch() in db.enableTotp): totp_secret <- pending,
  // totp_enabled <- 1, alte Backup-Code-Zeilen gelöscht, neue eingefügt,
  // pending_totp_secret geleert - kein Zwischenzustand, in dem beide oder
  // keine Fassung aktiv wäre, und keine Rotation, die alte UND neue Codes
  // gleichzeitig gültig lässt.
  await db.enableTotp(c.env.DB, c.get("userId"), hashedBackupCodes);
  if (wasRotation) {
    // Rotation ist ein Security-Recovery-Vorgang (z.B. Verdacht auf
    // kompromittierten zweiten Faktor) - andere Sitzungen widerrufen, analog
    // zu MFA-Disable und Passwortänderung.
    await db.revokeAllUserSessions(c.env.DB, c.get("userId"), c.get("sessionId"));
  }
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: wasRotation ? "mfa.rotated" : "mfa.enabled",
    targetLabel: c.get("email") ?? c.get("userId"),
  });
  return c.json({ backupCodes });
});

app.post("/api/me/mfa/disable", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  if (!userRow) return c.json({ error: "Nicht angemeldet" }, 401);
  if (!(await verifyPassword(password, userRow.password_hash, userRow.password_salt, userRow.password_iterations))) {
    return c.json({ error: "Passwort falsch" }, 403);
  }
  await db.disableTotp(c.env.DB, c.get("userId"));
  // Defense in depth: falls ein Angreifer bereits eine (kompromittierte)
  // Sitzung auf einem anderen Gerät hat, soll das Deaktivieren von MFA sie
  // nicht behalten dürfen.
  await db.revokeAllUserSessions(c.env.DB, c.get("userId"), c.get("sessionId"));
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "mfa.disabled",
    targetLabel: c.get("email") ?? c.get("userId"),
  });
  return c.json({ ok: true });
});

// Aktivitäts-Ping (P0 "SERVER-/CLIENT-IDLE SYNCHRONISIEREN", zweiter
// Production-Readiness-Härtungsdurchgang 2026-08-27): schließt eine echte
// Lücke zwischen dem clientseitigen Idle-Lock (IdleLockOverlay.tsx, rein
// lokal) und dem serverseitigen 5-Minuten-Idle-Timeout (requireAuth). Wer
// minutenlang ein Formular ausfüllt, ohne dass dabei irgendeine API-Anfrage
// läuft (kein Zwischenspeichern, keine Navigation), erzeugte bisher keine
// einzige Aktivitäts-Aktualisierung auf dem Server - der Client zeigte die
// Person als aktiv, der Server hielt sie für inaktiv, und ein späteres
// "Speichern" scheiterte mit 401 trotz durchgehender echter Aktivität.
//
// Absichtlich ohne eigene Nutzlast/Antwortdaten (nur `{ok:true}`) - der
// eigentliche Effekt ist bereits die throttled last_activity_at-
// Aktualisierung, die requireAuth für JEDE authentifizierte Anfrage ohnehin
// durchführt (ACTIVITY_UPDATE_THROTTLE_SECONDS = 30s, s.o.). Das Frontend
// ruft diese Route ausschließlich nach echter Nutzerinteraktion auf
// (pointerdown/keydown/touchstart, s. IdleLockOverlay.tsx), selbst
// zusätzlich auf ca. 45s gedrosselt - NIE durch einen reinen Timer,
// Hintergrund-Fetch oder Notification-Polling. Verlängert bewusst nur den
// Idle-Zustand, nie die absolute Sitzungsdauer (die hängt an
// `sessions.absolute_expires_at`, das hier unverändert bleibt).
app.post("/api/session/activity", requireAuth, async (c) => {
  return c.json({ ok: true });
});

// "Alle anderen Geräte abmelden" - Selbstauskunft/Selbsthilfe, unabhängig
// von einer konkreten Sicherheitsaktion (Passwort/MFA). Widerruft alle
// Sitzungen außer der gerade verwendeten.
app.post("/api/me/sessions/revoke-all", requireAuth, async (c) => {
  await db.revokeAllUserSessions(c.env.DB, c.get("userId"), c.get("sessionId"));
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "profile.sessions_revoked",
    targetLabel: c.get("email") ?? c.get("userId"),
  });
  return c.json({ ok: true });
});

app.get("/api/me/sessions", requireAuth, async (c) => {
  const sessions = await db.listActiveSessions(c.env.DB, c.get("userId"));
  return c.json(
    sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastActivityAt: s.last_activity_at,
      current: s.id === c.get("sessionId"),
    }))
  );
});

app.get("/api/me", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  const club = clubId ? await db.getClubById(c.env.DB, clubId) : null;
  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  const mfaEnabled = Boolean(userRow?.totp_enabled);
  return c.json({
    id: c.get("userId"),
    email: c.get("email"),
    name: c.get("name"),
    clubId,
    clubName: club?.name ?? null,
    clubRole: c.get("clubRole"),
    isSpringer: c.get("isSpringer"),
    isKassenwart: c.get("isKassenwart"),
    isAdmin: c.get("isAdmin"),
    // MFA ist für normale Rollen (member/jugendleiter) weiterhin reines
    // Opt-in. Für Platform-Admin (is_admin) erneut verpflichtend
    // (Nutzerentscheidung 2026-08-27, zweiter Durchgang) - höchste
    // Zugriffsstufe, vereinsübergreifend.
    mfaEnabled,
    mfaSetupRequired: c.get("isAdmin") && !mfaEnabled,
    // Erzwungener Passwortwechsel (Nutzeranfrage 2026-08-27): true, solange
    // ein von jemand anderem vergebenes initiales Passwort noch nicht durch
    // ein selbst gewähltes ersetzt wurde.
    passwordChangeRequired: Boolean(userRow?.must_change_password),
  });
});

app.get("/api/me/notification-preferences", requireAuth, async (c) => {
  return c.json(await getNotificationPreferences(c.env.DB, c.get("userId")));
});

app.put("/api/me/notification-preferences", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "Ungültige Einstellungen" }, 400);
  const preferences: Record<string, boolean> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    const value = (body as Record<string, unknown>)[category];
    if (value !== undefined && typeof value !== "boolean") return c.json({ error: "Ungültige Einstellungen" }, 400);
    if (typeof value === "boolean") preferences[category] = value;
  }
  await setNotificationPreferences(c.env.DB, c.get("userId"), preferences);
  return c.json(await getNotificationPreferences(c.env.DB, c.get("userId")));
});

// Push-Geräte-Token der nativen App registrieren / entfernen.
app.post("/api/me/device-tokens", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const platform = body?.platform === "ios" || body?.platform === "android" ? body.platform : null;
  if (!token || token.length > 4096 || !platform) return c.json({ error: "Ungültiger Token" }, 400);
  await db.registerDeviceToken(c.env.DB, c.get("userId"), token, platform);
  return c.json({ ok: true });
});

app.delete("/api/me/device-tokens", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return c.json({ error: "Token fehlt" }, 400);
  await db.removeDeviceToken(c.env.DB, c.get("userId"), token);
  return c.json({ ok: true });
});

app.get("/api/me/calendar", requireAuth, async (c) => {
  const active = await c.env.DB.prepare(
    "SELECT created_at as createdAt FROM calendar_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1"
  ).bind(c.get("userId")).first<{ createdAt: string }>();
  return c.json({ active: Boolean(active), createdAt: active?.createdAt ?? null });
});

app.post("/api/me/calendar", requireAuth, async (c) => {
  const token = createCalendarToken();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE calendar_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").bind(c.get("userId")),
    c.env.DB.prepare("INSERT INTO calendar_tokens (id, user_id, token_hash) VALUES (?, ?, ?)")
      .bind(crypto.randomUUID(), c.get("userId"), await hashCalendarToken(token)),
  ]);
  return c.json({ url: `${c.env.FRONTEND_URL}/api/calendar/feed/${token}` }, 201);
});

app.delete("/api/me/calendar", requireAuth, async (c) => {
  await c.env.DB.prepare("UPDATE calendar_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
    .bind(c.get("userId")).run();
  return c.body(null, 204);
});

// --- Vereinsübergreifende Administration -----------------------------------

// Alle Vereine mit Mitgliederzahl - Übersicht für die Admin-Rolle, um zu
// entscheiden, in welchen Verein gewechselt werden soll.
app.get("/api/admin/clubs", requireAuth, requireAdmin, async (c) => {
  return c.json(await db.listClubs(c.env.DB));
});

// Wechselt den eigenen Account in einen anderen Verein, als dessen
// Jugendleitung - danach funktioniert die komplette bestehende App
// unverändert für diesen Verein, ohne eigene Admin-Seiten für jede Ansicht
// nachbauen zu müssen. Der bisherige Verein geht dabei verloren, lässt sich
// aber genauso zurückwechseln.
app.post("/api/admin/switch-club", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const clubId = validId(body?.clubId);
  if (!clubId) return c.json({ error: "Ungültige Vereins-ID" }, 400);
  const club = await db.getClubById(c.env.DB, clubId);
  if (!club) return c.json({ error: "Verein nicht gefunden" }, 404);

  // Plattform-Admin bekommt beim Vereinswechsel bewusst NUR die Rolle
  // "member" - die Aufsicht/Sichtbarkeit läuft über is_admin (requireAdmin,
  // Lese-Freigaben unten). Ein Admin soll nicht zusätzlich als Jugendleitung
  // im Verein geführt werden (Nutzerentscheidung 2026-09-01).
  await db.setUserClub(c.env.DB, c.get("userId"), clubId, "member");
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.club_switch",
    targetLabel: club.name,
  });
  return c.json({ clubId, clubName: club.name });
});

app.post("/api/admin/clubs", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (await db.getClubByName(c.env.DB, name)) return c.json({ error: "Verein mit diesem Namen existiert bereits" }, 409);
  const club = await db.createClub(c.env.DB, name);
  await db.logAudit(c.env.DB, {
    clubId: club.id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.club_created",
    targetLabel: club.name,
  });
  return c.json(club, 201);
});

app.put("/api/admin/clubs/:id", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  const club = await db.getClubById(c.env.DB, id);
  if (!club) return c.json({ error: "Verein nicht gefunden" }, 404);
  await db.renameClub(c.env.DB, id, name);
  await db.logAudit(c.env.DB, {
    clubId: id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.club_renamed",
    targetLabel: `${club.name} → ${name}`,
  });
  return c.json({ ...club, name });
});

// Mitglieder/Gruppen des Vereins werden nicht mitgelöscht, sondern
// vereinslos (ON DELETE SET NULL) - siehe migrations/0002_clubs.sql.
app.delete("/api/admin/clubs/:id", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const club = await db.getClubById(c.env.DB, id);
  // Sicherheitsnetz: ein Verein mit noch zugeordneten Nutzer*innen wird
  // nicht gelöscht (auch wenn die DB das per ON DELETE SET NULL technisch
  // zulassen würde) - erst müssen alle Accounts über die Nutzerverwaltung
  // vom Verein gelöst werden, damit niemand "versehentlich" vereinslos wird.
  const members = await db.listClubMembers(c.env.DB, id);
  if (members.length > 0) {
    return c.json(
      {
        error: `Verein hat noch ${members.length} zugeordnete Nutzer*in(nen) - bitte erst über die Nutzerverwaltung vom Verein lösen.`,
      },
      409
    );
  }
  await db.deleteClub(c.env.DB, id);
  // clubId hier bewusst null: der Verein existiert nach dem Löschen nicht
  // mehr (FK würde sonst ins Leere zeigen) - der Eintrag bleibt trotzdem im
  // systemweiten Verlauf (/api/admin/audit-log) sichtbar.
  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.club_deleted",
    targetLabel: club?.name ?? id,
  });
  return c.body(null, 204);
});

// TEMPORÄR (Nutzeranfrage 2026-08-27): schickt zu jedem E-Mail-Typ, den die
// App verschickt, eine Testmail mit synthetischen Beispieldaten an eine feste
// Adresse - zum visuellen Review des neuen E-Mail-Designs. Admin-only, wird
// nach einmaliger Nutzung wieder entfernt (nicht Teil des dauerhaften
// Funktionsumfangs).
app.post("/api/admin/_debug/send-all-sample-emails", requireAuth, requireAdmin, async (c) => {
  const TEST_TO = "aboutdevops@gmail.com";
  const F = c.env.FRONTEND_URL;
  const samples: { id: string; subject: string; text: string; link?: string; linkLabel?: string }[] = [
    { id: "waitlist_promoted", subject: `Platz frei in „Minis“`, text: `Anna Beispiel wurde von der Warteliste in „Minis“ nachgerückt.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "waitlist_capacity_freed", subject: `Platz frei in „Minis“ – Warteliste prüfen`, text: `In „Minis“ sind wieder 2 Plätze frei. Von der Warteliste passt vom Alter her: Anna Beispiel, Ben Muster.`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "welcome_new_user", subject: "Dein Zugang für Turnen", text: `Für dich wurde ein Zugang für Turnen angelegt.\n\nE-Mail: max.mustermann@example.com\nEinmal-Passwort: Beispiel-Passwort-Nicht-Echt\n\nBitte melde dich damit an und vergib beim ersten Login sofort ein eigenes Passwort - das ist erforderlich, bevor du die App weiter nutzen kannst.`, link: `${F}/login`, linkLabel: "Jetzt anmelden" },
    { id: "password_reset", subject: "Passwort zurücksetzen", text: `Für dein Konto wurde ein Zurücksetzen des Passworts angefordert. Falls du das warst, kannst du dir über den folgenden Link ein neues Passwort vergeben.\n\nDer Link ist 30 Minuten gültig. Falls du das nicht angefordert hast, ignoriere diese E-Mail - es ändert sich nichts an deinem Passwort.`, link: `${F}/passwort-zuruecksetzen?token=beispiel-token-nicht-echt`, linkLabel: "Neues Passwort festlegen" },
    { id: "club_join_requested", subject: `Beitrittsanfrage für „TSV Musterstadt“`, text: `Max Mustermann möchte „TSV Musterstadt“ beitreten - bitte freigeben oder ablehnen.`, link: `${F}/verein`, linkLabel: "In der App ansehen" },
    { id: "club_join_approved", subject: `Beitritt zu „TSV Musterstadt“ freigegeben`, text: `Erika Beispiel hat deine Beitrittsanfrage für „TSV Musterstadt“ freigegeben.`, link: `${F}/verein`, linkLabel: "In der App ansehen" },
    { id: "club_join_rejected", subject: `Beitritt zu „TSV Musterstadt“ abgelehnt`, text: `Erika Beispiel hat deine Beitrittsanfrage für „TSV Musterstadt“ abgelehnt.`, link: `${F}/verein`, linkLabel: "In der App ansehen" },
    { id: "group_co_leader_added", subject: `Mit-Trainer*in für „Große Turner“`, text: `Erika Beispiel hat dich als Mit-Trainer*in für „Große Turner“ eingetragen - du hast jetzt dieselben Rechte wie die Gruppenleitung.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "capacity_request", subject: `Kapazitäts-Anfrage für „Minis“`, text: `Anna Beispiel soll in die volle Gruppe „Minis“ - bitte freigeben oder ablehnen.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "substitute_request", subject: `Vertretung gesucht für „Große Turner“`, text: `Erika Beispiel sucht für den Termin am 2026-09-03 in „Große Turner“ eine Vertretung. (Beispiel-Notiz)`, link: `${F}/vertretungen`, linkLabel: "In der App ansehen" },
    { id: "substitute_claimed", subject: `Vertretung übernommen für „Große Turner“`, text: `Max Mustermann übernimmt den Termin am 2026-09-03 in „Große Turner“.`, link: `${F}/vertretungen`, linkLabel: "In der App ansehen" },
    { id: "substitute_returned", subject: `Vertretung zurückgegeben für „Große Turner“`, text: `Max Mustermann kann den Termin am 2026-09-03 in „Große Turner“ doch nicht übernehmen - die Stunde liegt wieder bei dir.`, link: `${F}/vertretungen`, linkLabel: "In der App ansehen" },
    { id: "move_request", subject: `Verschiebe-Anfrage für „Große Turner“`, text: `Anna Beispiel möchte in deine Gruppe „Große Turner“ wechseln - bitte freigeben oder ablehnen.\n\nBegründung: Beispiel-Begründung für den Wechsel.\n\nDetails (Notfallkontakt) siehst du nach dem Anmelden in der App.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "move_request_approved_owner", subject: `Verschiebe-Anfrage genehmigt: „Große Turner“`, text: `Anna Beispiel wurde von „Minis“ in „Große Turner“ verschoben.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "move_request_approved_requester", subject: `Deine Verschiebe-Anfrage wurde genehmigt`, text: `Anna Beispiel wurde in „Große Turner“ aufgenommen.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "move_request_rejected_owner", subject: `Verschiebe-Anfrage abgelehnt: „Große Turner“`, text: `Anna Beispiel bleibt in „Minis“ - der Wechsel nach „Große Turner“ wurde abgelehnt.\n\nBegründung: Beispiel-Ablehnungsgrund.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "move_request_rejected_requester", subject: `Deine Verschiebe-Anfrage wurde abgelehnt`, text: `Anna Beispiel konnte nicht nach „Große Turner“ wechseln.\n\nBegründung: Beispiel-Ablehnungsgrund.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "club_waitlist_added", subject: "Neue Anfrage auf der Warteliste", text: `Erika Beispiel hat Ben Muster zur Warteliste hinzugefügt. (Beispiel-Notiz)`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "placement_proposed", subject: `Platzvorschlag für „Minis“`, text: `Erika Beispiel schlägt Ben Muster für deine Gruppe „Minis“ vor - bitte bestätige oder lehne ab.`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "placement_requested", subject: `Übernahme-Anfrage für „Minis“`, text: `Max Mustermann möchte Ben Muster in die Gruppe „Minis“ übernehmen - Begründung: Beispiel-Begründung - bitte freigeben oder ablehnen.`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "placement_confirmed_proposer", subject: `Platzvorschlag bestätigt für „Minis“`, text: `Erika Beispiel hat Ben Muster in „Minis“ aufgenommen.`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "placement_confirmed_new_owner", subject: `Neues Kind in deiner Gruppe „Minis“`, text: `Ben Muster wurde in deine Gruppe „Minis“ aufgenommen. Details (Notfallkontakt) siehst du nach dem Anmelden in der App.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "placement_declined", subject: `Übernahme-Anfrage abgelehnt für „Minis“`, text: `Erika Beispiel kann Ben Muster aktuell nicht in „Minis“ aufnehmen.\n\nBegründung: Beispiel-Ablehnungsgrund.`, link: `${F}/warteliste`, linkLabel: "In der App ansehen" },
    { id: "session_override_requested", subject: `Abweichender Termin angefragt für „Große Turner“`, text: `Max Mustermann möchte den Termin am 2026-09-03 in „Große Turner“ abweichend durchführen (Beispiel-Notiz) - bitte freigeben oder ablehnen.`, link: `${F}/anwesenheit`, linkLabel: "In der App ansehen" },
    { id: "substitute_assigned", subject: `Vertretung eingetragen für „Große Turner“`, text: `Erika Beispiel hat dich für den Termin am 2026-09-03 in „Große Turner“ als Leitung eingetragen - die Stunde zählt in deinem Stundennachweis.`, link: `${F}/nachweis`, linkLabel: "In der App ansehen" },
    { id: "session_override_approved", subject: `Abweichender Termin freigegeben für „Große Turner“`, text: `Erika Beispiel hat deinen abweichenden Termin am 2026-09-03 in „Große Turner“ freigegeben.`, link: `${F}/anwesenheit`, linkLabel: "In der App ansehen" },
    { id: "session_override_rejected", subject: `Abweichender Termin abgelehnt für „Große Turner“`, text: `Erika Beispiel hat deinen abweichenden Termin am 2026-09-03 in „Große Turner“ abgelehnt.`, link: `${F}/anwesenheit`, linkLabel: "In der App ansehen" },
    { id: "move_request_reminder_owner", subject: `Erinnerung: Verschiebe-Anfrage für „Große Turner“`, text: `Anna Beispiel wartet seit 3 Tagen auf deine Freigabe für „Große Turner“.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
    { id: "move_request_reminder_requester", subject: "Erinnerung: Deine Verschiebe-Anfrage wartet noch", text: `Anna Beispiel wartet seit 3 Tagen auf Freigabe für „Große Turner“.`, link: `${F}/kinder`, linkLabel: "In der App ansehen" },
    { id: "capacity_request_reminder", subject: `Erinnerung: Kapazitäts-Anfrage für „Minis“`, text: `Anna Beispiel wartet seit 3 Tagen auf deine Freigabe für „Minis“.`, link: `${F}/gruppen`, linkLabel: "In der App ansehen" },
  ];
  const results: { id: string; ok: boolean }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    try {
      const sent = await sendEmailOnly(c.env, {
        to: TEST_TO,
        subject: `[TEST ${i + 1}/${samples.length} · ${s.id}] ${s.subject}`,
        text: s.text,
        link: s.link,
        linkLabel: s.linkLabel,
      });
      results.push({ id: s.id, ok: sent });
    } catch {
      results.push({ id: s.id, ok: false });
    }
  }
  return c.json(results);
});

// Alle Nutzer*innen vereinsübergreifend - für die Admin-Nutzerverwaltung.
app.get("/api/admin/users", requireAuth, requireAdmin, async (c) => {
  return c.json(await db.listAllUsersForAdmin(c.env.DB));
});

app.get("/api/admin/operations", requireAuth, requireAdmin, async (c) => {
  return c.json(await operationsSummary(c.env.DB));
});

app.post("/api/admin/operations/retry-emails", requireAuth, requireAdmin, async (c) => {
  await c.env.DB.prepare(
    "UPDATE email_deliveries SET next_retry_at = datetime('now') WHERE status = 'failed' AND retryable = 1 AND attempt_count < 3"
  ).run();
  await retryFailedEmails(c.env);
  return c.json({ ok: true });
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizedEmail(body?.email);
  const name = optionalText(body?.name, 100);
  if (!email) return c.json({ error: "E-Mail fehlt oder ist ungültig" }, 400);
  if (name === undefined) return c.json({ error: "Name ist zu lang" }, 400);
  if (await db.getUserByEmail(c.env.DB, email)) return c.json({ error: "E-Mail bereits vergeben" }, 409);

  let clubId: string | null = null;
  if ("clubId" in (body ?? {})) {
    const parsed = optionalId(body.clubId);
    if (parsed === undefined) return c.json({ error: "Ungültige Vereins-ID" }, 400);
    clubId = parsed;
  }
  let clubRole: ClubRole = "member";
  if ("clubRole" in (body ?? {})) {
    if (body.clubRole !== "member" && body.clubRole !== "jugendleiter")
      return c.json({ error: "Ungültige Rolle" }, 400);
    clubRole = body.clubRole;
  }
  const isAdmin = "isAdmin" in (body ?? {}) ? Boolean(validBool(body.isAdmin)) : false;

  // Konto wird zunächst mit zufälligem Dummy-Hash angelegt & blocked (must_change_password=1)
  const dummyPassword = crypto.randomUUID() + crypto.randomUUID();
  const { hash, salt, iterations } = await hashPassword(dummyPassword);
  const user = await db.createUserAdmin(c.env.DB, { email, name, hash, salt, iterations, clubId, clubRole, isAdmin });

  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.user_created",
    targetLabel: email,
  });

  // Einmal-Aktivierungs-Link statt Klartext-Passwort in E-Mail (P1 Hardening)
  const setupToken = await signAccountSetupToken(user.id, c.env.JWT_SECRET);
  await sendEmailOnly(c.env, {
    to: email,
    subject: "Dein Zugang für Turnen – Konto aktivieren",
    text: `Für dich wurde ein Zugang für Turnen angelegt.\n\nBitte aktiviere dein Konto und vergib dein persönliches Passwort über folgenden Link:\n\nDer Link ist 60 Minuten gültig.`,
    link: `${c.env.FRONTEND_URL}/passwort-zuruecksetzen?token=${setupToken}&type=setup`,
    linkLabel: "Konto aktivieren & Passwort festlegen",
  });
  return c.json({ id: user.id, email, name, clubId, clubRole, isAdmin }, 201);
});

app.put("/api/admin/users/:id", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const input: { clubId?: string | null; clubRole?: ClubRole; isAdmin?: boolean } = {};
  if ("clubId" in (body ?? {})) {
    const clubId = optionalId(body.clubId);
    if (clubId === undefined) return c.json({ error: "Ungültige Vereins-ID" }, 400);
    input.clubId = clubId;
  }
  if ("clubRole" in (body ?? {})) {
    if (body.clubRole !== "member" && body.clubRole !== "jugendleiter")
      return c.json({ error: "Ungültige Rolle" }, 400);
    input.clubRole = body.clubRole;
  }
  if ("isAdmin" in (body ?? {})) {
    const isAdmin = validBool(body.isAdmin);
    if (isAdmin === undefined) return c.json({ error: "Ungültiger Admin-Status" }, 400);
    input.isAdmin = isAdmin;
  }
  const targetUser = await db.getUserById(c.env.DB, id);
  await db.adminUpdateUser(c.env.DB, id, input);
  // Keine sensiblen Werte (Passwort etc.) im Audit-Log - nur, WAS geändert
  // wurde (Aktion/Zielfeld), nicht der komplette Payload.
  const changedFields = Object.keys(input).join(", ");
  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.user_updated",
    targetLabel: `${targetUser?.email ?? id}: ${changedFields}`,
  });
  return c.json({ ok: true });
});

app.put("/api/admin/users/:id/password", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const newPassword = validPassword(body?.newPassword);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!newPassword) return c.json({ error: "Neues Passwort ist ungültig (mind. 15 Zeichen)" }, 400);
  if (await isPasswordPwned(newPassword)) {
    return c.json({ error: "Dieses Passwort wurde in bekannten Datenlecks gefunden. Bitte ein anderes wählen." }, 400);
  }
  const targetUser = await db.getUserById(c.env.DB, id);
  // must_change_password = true: die Admin-Person kennt dieses Passwort,
  // die betroffene Person muss es beim nächsten Login selbst ersetzen.
  await db.updateUserPassword(c.env.DB, id, await hashPassword(newPassword), true);
  // Session Revocation (Finding P1 "ADMIN PASSWORD RESET", externe
  // Production-Readiness-Prüfung 2026-08-27): fehlte hier bisher komplett -
  // ein Admin-Reset ist ein Security-Recovery-Vorgang (z.B. Verdacht auf
  // kompromittierten Account), ALLE Sitzungen der Zielperson müssen enden,
  // nicht nur zukünftige Logins ein neues Passwort verlangen. Anders als bei
  // der eigenen Passwortänderung gibt es hier keine "aktuelle Sitzung"
  // auszunehmen - die admin-ausführende Person ist nicht als Zielperson
  // authentifiziert, also alle Sitzungen ausnahmslos widerrufen.
  await db.revokeAllUserSessions(c.env.DB, id);
  // Niemals das neue Passwort selbst loggen - nur, dass ein Reset stattfand.
  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.user_password_reset",
    targetLabel: targetUser?.email ?? id,
  });
  return c.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (id === c.get("userId")) return c.json({ error: "Eigenen Account nicht selbst löschen" }, 400);
  const targetUser = await db.getUserById(c.env.DB, id);
  await db.deleteUser(c.env.DB, id);
  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.user_deleted",
    targetLabel: targetUser?.email ?? id,
  });
  return c.body(null, 204);
});

// Systemweiter Verlauf über alle Vereine hinweg.
app.get("/api/admin/audit-log", requireAuth, requireAdmin, async (c) => {
  const requestedLimit = Number(c.req.query("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 200;
  return c.json(await db.listAuditLogSystemWide(c.env.DB, limit));
});

// Einmaliger Backfill: verschlüsselt Notfallkontakte, die noch aus der Zeit
// vor Einführung der Feld-Verschlüsselung im Klartext vorliegen (Finding
// PRIV-02). Idempotent - überspringt bereits verschlüsselte Werte
// (erkennbar am "v1:"-Präfix), daher gefahrlos mehrfach aufrufbar. Nur für
// die Admin-Rolle. (health_notes gibt es nicht mehr, siehe Migration 0033 -
// Gesundheitshinweise wurden als Feature komplett aus der App entfernt.)
app.post("/api/admin/backfill-health-encryption", requireAuth, requireAdmin, async (c) => {
  const rows = await db.listAllChildRowsForBackfill(c.env.DB);
  let updated = 0;
  for (const row of rows) {
    const needsName = row.emergency_contact_name !== null && !row.emergency_contact_name.startsWith("v1:");
    const needsPhone = row.emergency_contact_phone !== null && !row.emergency_contact_phone.startsWith("v1:");
    if (!needsName && !needsPhone) continue;

    await db.updateChildEncryptedFieldsRaw(c.env.DB, row.id, {
      emergencyContactName: needsName
        ? await encryptField(row.emergency_contact_name, c.env.ENCRYPTION_KEY)
        : row.emergency_contact_name,
      emergencyContactPhone: needsPhone
        ? await encryptField(row.emergency_contact_phone, c.env.ENCRYPTION_KEY)
        : row.emergency_contact_phone,
    });
    updated++;
  }
  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.backfill_encryption",
    targetLabel: `${updated} von ${rows.length} Kind-Datensätzen verschlüsselt`,
  });
  return c.json({ totalChildren: rows.length, updated });
});

// Name/E-Mail des eigenen Accounts ändern. Kein Token-Umtausch mehr nötig
// (die Sitzung selbst kennt nur noch die User-ID, nicht mehr Name/E-Mail -
// s. Session-Management-Härtung); das Frontend übernimmt die Antwort direkt
// in seinen State statt ein neues JWT zu speichern.
//
// Ändert sich die E-Mail-Adresse tatsächlich, verlangt das zusätzlich das
// aktuelle Passwort (Step-up-Authentifizierung) - vorher war das ungeschützt,
// obwohl die E-Mail zugleich der Login-Name ist (Production-Readiness-
// Prüfung 2026-08-27). Reiner Namenswechsel bleibt ohne Passwort möglich.
app.put("/api/me", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizedEmail(body?.email);
  const name = optionalText(body?.name, 100);
  if (!email) return c.json({ error: "E-Mail fehlt oder ist ungültig" }, 400);
  if (name === undefined) return c.json({ error: "Name ist zu lang" }, 400);

  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  if (!userRow) return c.json({ error: "Nutzer nicht gefunden" }, 404);

  if (email !== userRow.email) {
    const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
    if (!(await verifyPassword(currentPassword, userRow.password_hash, userRow.password_salt, userRow.password_iterations))) {
      return c.json({ error: "Zur Bestätigung der E-Mail-Änderung bitte aktuelles Passwort eingeben" }, 403);
    }
  }

  const existing = await db.getUserByEmail(c.env.DB, email);
  if (existing && existing.id !== c.get("userId")) return c.json({ error: "E-Mail wird bereits verwendet" }, 409);

  const user = await db.updateUserProfile(c.env.DB, c.get("userId"), { name, email });
  if (!user) return c.json({ error: "Nutzer nicht gefunden" }, 404);

  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: name,
    action: "profile.updated",
    targetLabel: email,
  });

  return c.json({ user: { id: user.id, email: user.email, name: user.name } });
});

// Eigenes Passwort ändern - verlangt das aktuelle Passwort zur Bestätigung,
// analog zum Login-Check.
app.put("/api/me/password", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : undefined;
  const newPassword = validPassword(body?.newPassword);
  if (!currentPassword) return c.json({ error: "Aktuelles Passwort fehlt" }, 400);
  if (!newPassword) return c.json({ error: "Neues Passwort muss mindestens 15 Zeichen lang sein" }, 400);

  const userRow = await db.getUserRowById(c.env.DB, c.get("userId"));
  if (!userRow) return c.json({ error: "Nutzer nicht gefunden" }, 404);

  const valid = await verifyPassword(currentPassword, userRow.password_hash, userRow.password_salt, userRow.password_iterations);
  if (!valid) return c.json({ error: "Aktuelles Passwort ist falsch" }, 401);

  if (await isPasswordPwned(newPassword)) {
    return c.json({ error: "Dieses Passwort wurde in bekannten Datenlecks gefunden. Bitte ein anderes wählen." }, 400);
  }

  // must_change_password = false: die Person hat gerade selbst ein neues
  // Passwort gewählt - erfüllt einen etwaigen erzwungenen Wechsel.
  await db.updateUserPassword(c.env.DB, userRow.id, await hashPassword(newPassword), false);
  // Session Revocation (Session-Management-Härtung): ein gestohlenes Token
  // auf einem anderen Gerät soll nach einer Passwortänderung nicht gültig
  // bleiben. Die aktuelle Sitzung (auf der die Änderung selbst gerade
  // läuft) bleibt bewusst ausgenommen, sonst wäre man sofort selbst
  // ausgeloggt.
  await db.revokeAllUserSessions(c.env.DB, userRow.id, c.get("sessionId"));
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "profile.password_changed",
    targetLabel: c.get("email"),
  });
  return c.json({ ok: true });
});

// Self-Service "Passwort vergessen" (Finding SEC-07) - vorher war ein
// blockierter Account nur durch die Admin-Rolle wiederherstellbar. Antwort
// bewusst IMMER identisch (200, generische Nachricht), unabhängig davon, ob
// die E-Mail-Adresse existiert - sonst ließen sich Accounts per Timing/
// Statuscode aufzählen (Account Enumeration).
// Rate Limiting (Finding P1 "PASSWORD RESET HARDENING", externe Production-
// Readiness-Prüfung 2026-08-27) - kombiniert E-Mail und IP, beide mit
// eigenem Limit im selben Zeitfenster. Bewusst grosszügiger als der Login-
// Rate-Limiter (LOGIN_MAX_FAILED_ATTEMPTS): eine legitime Person kann
// durchaus mehrfach hintereinander "Passwort vergessen" anklicken (Mail
// nicht angekommen, falscher Ordner o.ä.).
const RESET_REQUEST_WINDOW_MINUTES = 15;
const RESET_REQUEST_MAX_PER_EMAIL = 5;
const RESET_REQUEST_MAX_PER_IP = 20;

app.post("/api/password-reset/request", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizedEmail(body?.email);
  const genericResponse = c.json({ ok: true, message: "Falls diese E-Mail-Adresse registriert ist, wurde eine Zurücksetzen-Mail verschickt." });
  if (!email) return genericResponse;

  const ip = c.req.header("CF-Connecting-IP") ?? null;
  const { byEmail, byIp } = await db.countRecentPasswordResetRequests(c.env.DB, {
    email,
    ip,
    windowMinutes: RESET_REQUEST_WINDOW_MINUTES,
  });
  // Immer dieselbe generische Antwort, auch wenn das Limit greift - sonst
  // ließe sich über ein abweichendes Verhalten indirekt auf die Existenz
  // eines Accounts schließen. Der Request wird nur nicht mehr gezählt/
  // protokolliert und keine Mail mehr verschickt.
  if (byEmail >= RESET_REQUEST_MAX_PER_EMAIL || byIp >= RESET_REQUEST_MAX_PER_IP) return genericResponse;
  await db.recordPasswordResetRequest(c.env.DB, email, ip);

  const userRow = await db.getUserByEmail(c.env.DB, email);
  if (!userRow) return genericResponse;

  const resetToken = await signPasswordResetToken(userRow.id, c.env.JWT_SECRET);
  await sendEmailOnly(c.env, {
    to: userRow.email,
    subject: "Passwort zurücksetzen",
    text: `Für dein Konto wurde ein Zurücksetzen des Passworts angefordert. Falls du das warst, kannst du dir über den folgenden Link ein neues Passwort vergeben.\n\nDer Link ist 30 Minuten gültig. Falls du das nicht angefordert hast, ignoriere diese E-Mail - es ändert sich nichts an deinem Passwort.`,
    link: `${c.env.FRONTEND_URL}/passwort-zuruecksetzen?token=${resetToken}`,
    linkLabel: "Neues Passwort festlegen",
  });
  return genericResponse;
});

app.post("/api/password-reset/confirm", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : null;
  const newPassword = validPassword(body?.newPassword);
  if (!token) return c.json({ error: "Token fehlt" }, 400);
  if (!newPassword) return c.json({ error: "Neues Passwort muss mindestens 15 Zeichen lang sein" }, 400);

  let payload: { userId: string; jti: string; expiresAt: number };
  try {
    payload = await verifyPasswordResetToken(token, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: "Link ist ungültig oder abgelaufen. Bitte erneut anfordern." }, 401);
  }

  const userRow = await db.getUserById(c.env.DB, payload.userId);
  if (!userRow) return c.json({ error: "Link ist ungültig oder abgelaufen. Bitte erneut anfordern." }, 401);

  if (await isPasswordPwned(newPassword)) {
    return c.json({ error: "Dieses Passwort wurde in bekannten Datenlecks gefunden. Bitte ein anderes wählen." }, 400);
  }

  // Einmaligkeit (Production-Readiness-Prüfung 2026-08-27) - der Token darf
  // erst JETZT verbraucht werden, nachdem alles andere (Signatur, Ablauf,
  // Nutzer, Passwort-Syntax, HIBP) bereits erfolgreich geprüft wurde. Vorher
  // wurde die jti schon vor der HIBP-Prüfung konsumiert - ein abgelehntes
  // (z.B. geleaktes) Passwort hätte den sonst gültigen Link bereits
  // verbrannt, ohne dass der Wechsel stattfand, und die Person hätte einen
  // komplett neuen Reset anfordern müssen. Der INSERT mit PRIMARY KEY auf
  // jti bleibt der atomare Gate: bei zwei parallelen Requests mit
  // derselben jti gewinnt nur einer, unabhängig von der Reihenfolge davor.
  const expiresAtIso = toSqliteDatetime(new Date(payload.expiresAt * 1000));
  const firstUse = await db.consumePasswordResetJti(c.env.DB, payload.jti, expiresAtIso);
  if (!firstUse) return c.json({ error: "Dieser Link wurde bereits verwendet. Bitte einen neuen anfordern." }, 401);

  // must_change_password = false: selbst gewähltes neues Passwort.
  await db.updateUserPassword(c.env.DB, userRow.id, await hashPassword(newPassword), false);
  // Ein Passwort-Reset ist ein Recovery-Vorgang (möglicher Kompromittierungs-
  // Verdacht) - anders als bei der normalen Passwortänderung werden hier
  // ALLE Sitzungen widerrufen, es gibt keine "aktuelle" auszunehmen (dieser
  // Endpunkt ist nicht authentifiziert).
  await db.revokeAllUserSessions(c.env.DB, userRow.id);
  await db.logAudit(c.env.DB, {
    clubId: userRow.clubId,
    actorId: userRow.id,
    actorName: userRow.name,
    action: "profile.password_reset_via_email",
    targetLabel: userRow.email,
  });
  return c.json({ ok: true });
});

// Single-Use Account-Aktivierung (P1 Hardening)
app.post("/api/account-setup/confirm", async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : null;
  const newPassword = validPassword(body?.newPassword);
  if (!token) return c.json({ error: "Token fehlt" }, 400);
  if (!newPassword) return c.json({ error: "Neues Passwort muss mindestens 15 Zeichen lang sein" }, 400);

  let payload: { userId: string; jti: string; expiresAt: number };
  try {
    payload = await verifyAccountSetupToken(token, c.env.JWT_SECRET);
  } catch {
    return c.json({ error: "Link ist ungültig oder abgelaufen. Bitte erneut anfordern." }, 401);
  }

  const userRow = await db.getUserById(c.env.DB, payload.userId);
  if (!userRow) return c.json({ error: "Link ist ungültig oder abgelaufen. Bitte erneut anfordern." }, 401);

  if (await isPasswordPwned(newPassword)) {
    return c.json({ error: "Dieses Passwort wurde in bekannten Datenlecks gefunden. Bitte ein anderes wählen." }, 400);
  }

  const expiresAtIso = toSqliteDatetime(new Date(payload.expiresAt * 1000));
  const firstUse = await db.consumePasswordResetJti(c.env.DB, payload.jti, expiresAtIso);
  if (!firstUse) return c.json({ error: "Dieser Link wurde bereits verwendet. Bitte einen neuen anfordern." }, 401);

  await db.updateUserPassword(c.env.DB, userRow.id, await hashPassword(newPassword), false);
  await db.revokeAllUserSessions(c.env.DB, userRow.id);
  await db.logAudit(c.env.DB, {
    clubId: userRow.clubId,
    actorId: userRow.id,
    actorName: userRow.name,
    action: "admin.account_activated",
    targetLabel: userRow.email,
  });

  return c.json({ ok: true, message: "Konto erfolgreich aktiviert" });
});

app.post("/api/admin/users/:id/resend-setup", requireAuth, requireAdmin, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const targetUser = await db.getUserById(c.env.DB, id);
  if (!targetUser) return c.json({ error: "Nutzer nicht gefunden" }, 404);

  const setupToken = await signAccountSetupToken(targetUser.id, c.env.JWT_SECRET);
  await sendEmailOnly(c.env, {
    to: targetUser.email,
    subject: "Dein Zugang für Turnen – Konto aktivieren",
    text: `Für dich wurde eine Aktivierung deines Zugangs für Turnen erneut angefordert.\n\nBitte aktiviere dein Konto über den folgenden Link und wähle dein persönliches Passwort:\n\nDer Link ist 60 Minuten gültig.`,
    link: `${c.env.FRONTEND_URL}/passwort-zuruecksetzen?token=${setupToken}&type=setup`,
    linkLabel: "Konto aktivieren & Passwort festlegen",
  });

  await db.logAudit(c.env.DB, {
    clubId: null,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "admin.user_setup_resent",
    targetLabel: targetUser.email,
  });

  return c.json({ ok: true, message: "Aktivierungs-E-Mail wurde erneut gesendet" });
});

// --- Vereine -------------------------------------------------------------

app.get("/api/clubs", requireAuth, async (c) => {
  return c.json(await db.listClubs(c.env.DB));
});

// Wer einen Verein anlegt, wird automatisch dessen erste Jugendleitung -
// bleibt aber ganz normales Mitglied mit eigenen Gruppen.
app.post("/api/clubs", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  if (!name) return c.json({ error: "Vereinsname fehlt oder ist ungültig" }, 400);

  const existing = await db.getClubByName(c.env.DB, name);
  if (existing) return c.json({ error: "Ein Verein mit diesem Namen existiert bereits" }, 409);

  const club = await db.createClub(c.env.DB, name);
  await db.setUserClub(c.env.DB, c.get("userId"), club.id, "jugendleiter");
  await db.logAudit(c.env.DB, {
    clubId: club.id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "club.created",
    targetLabel: club.name,
  });
  return c.json({ id: club.id, name: club.name, clubNumber: null, memberCount: 1, createdAt: club.created_at }, 201);
});

// Vereinsnummer (Landessportbund) - nur die Jugendleitung darf sie pflegen,
// wird für den Stundennachweis benötigt.
app.put("/api/clubs/mine/number", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann diese Aktion ausführen" }, 403);

  const body = await c.req.json().catch(() => null);
  const clubNumber = optionalText(body?.clubNumber, 30);
  if (clubNumber === undefined) return c.json({ error: "Vereinsnummer ist zu lang" }, 400);

  await db.setClubNumber(c.env.DB, clubId, clubNumber);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "club.number_updated",
    targetLabel: clubNumber ?? "(entfernt)",
  });
  return c.json({ ok: true });
});

app.put("/api/me/club", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const clubId = optionalId(body?.clubId);
  if (clubId === undefined) return c.json({ error: "Ungültige Vereins-ID" }, 400);

  const currentClubId = c.get("clubId");
  const currentRole = c.get("clubRole");

  if (clubId !== null) {
    const club = await db.getClubById(c.env.DB, clubId);
    if (!club) return c.json({ error: "Verein nicht gefunden" }, 404);

    // Hat der Verein schon eine Jugendleitung, braucht der Beitritt deren
    // Freigabe - sonst könnte sich jede*r ungeprüft eintragen. Ohne
    // Jugendleitung (z.B. ganz neuer/verwaister Verein) bleibt der direkte
    // Beitritt möglich, sonst könnte niemand mehr beitreten.
    const hasLeadership = (await db.countClubLeaders(c.env.DB, clubId)) > 0;
    if (hasLeadership) {
      let request;
      try {
        request = await db.createClubJoinRequest(c.env.DB, { clubId, userId: c.get("userId") });
      } catch {
        return c.json({ error: "Es läuft bereits eine Beitrittsanfrage" }, 409);
      }

      const leaders = (await db.listClubMembers(c.env.DB, clubId)).filter((m) => m.role === "jugendleiter");
      for (const leader of leaders) {
        await notifyUser(c.env, {
          userId: leader.id,
          userEmail: leader.email,
          userName: leader.name,
          type: "club_join_requested",
          title: `Beitrittsanfrage für „${club.name}“`,
          body: `${c.get("name") ?? c.get("email")} möchte „${club.name}“ beitreten - bitte freigeben oder ablehnen.`,
          link: "/verein",
        });
      }

      return c.json({ status: "pending_club_join_approval", requestId: request.id, clubName: club.name }, 202);
    }
  }

  // Wer den Verein verlässt und die einzige Jugendleitung ist, muss zuerst
  // jemand anderen befördern - sonst bleibt der Verein ohne Leitung zurück.
  if (clubId === null && currentClubId && currentRole === "jugendleiter") {
    const members = await db.listClubMembers(c.env.DB, currentClubId);
    const otherMembers = members.filter((m) => m.id !== c.get("userId"));
    const otherLeaders = otherMembers.filter((m) => m.role === "jugendleiter");
    if (otherMembers.length > 0 && otherLeaders.length === 0) {
      return c.json(
        { error: "Du bist die einzige Jugendleitung. Bitte zuerst jemanden befördern, bevor du den Verein verlässt." },
        409
      );
    }
  }

  // Neuer Verein (oder gar keiner) - Rolle wird immer auf "member"
  // zurückgesetzt, Jugendleitung gilt nur im jeweiligen Verein.
  await db.setUserClub(c.env.DB, c.get("userId"), clubId, "member");
  await db.logAudit(c.env.DB, {
    clubId: clubId ?? currentClubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: clubId === null ? "club.left" : "club.joined",
    targetLabel: c.get("email"),
  });
  return c.json({ clubId, clubRole: "member" });
});

app.get("/api/clubs/mine/members", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listClubMembers(c.env.DB, clubId));
});

// Offene Beitrittsanfragen für den eigenen Verein - nur für die
// Jugendleitung, die sie freigeben oder ablehnen muss.
app.get("/api/club-join-requests/incoming", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || (c.get("clubRole") !== "jugendleiter" && !c.get("isAdmin"))) return c.json([]);
  return c.json(await db.listPendingClubJoinRequestsForClub(c.env.DB, clubId));
});

// Die eigene offene Beitrittsanfrage (falls vorhanden) - für die Anzeige
// "wartet auf Freigabe" auf der Verein-Seite.
app.get("/api/club-join-requests/mine", requireAuth, async (c) => {
  return c.json(await db.getPendingClubJoinRequestForUser(c.env.DB, c.get("userId")));
});

app.post("/api/club-join-requests/:id/cancel", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getClubJoinRequestById(c.env.DB, id);
  if (!request) return c.body(null, 204);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.user_id !== c.get("userId")) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setClubJoinRequestStatus(c.env.DB, id, "cancelled");
  return c.body(null, 204);
});

app.post("/api/club-join-requests/:id/approve", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getClubJoinRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }

  await db.setUserClub(c.env.DB, request.user_id, request.club_id, "member");
  await db.setClubJoinRequestStatus(c.env.DB, id, "approved");

  const club = await db.getClubById(c.env.DB, request.club_id);
  const applicant = await db.getUserById(c.env.DB, request.user_id);
  await db.logAudit(c.env.DB, {
    clubId: request.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "club_join_request.approved",
    targetLabel: applicant?.name ?? applicant?.email ?? request.user_id,
  });
  if (applicant && club) {
    await notifyUser(c.env, {
      userId: applicant.id,
      userEmail: applicant.email,
      userName: applicant.name,
      type: "club_join_approved",
      title: `Beitritt zu „${club.name}“ freigegeben`,
      body: `${c.get("name") ?? c.get("email")} hat deine Beitrittsanfrage für „${club.name}“ freigegeben.`,
      link: "/verein",
    });
  }

  return c.json({ ok: true });
});

app.post("/api/club-join-requests/:id/reject", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getClubJoinRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }

  await db.setClubJoinRequestStatus(c.env.DB, id, "rejected");

  const club = await db.getClubById(c.env.DB, request.club_id);
  const applicant = await db.getUserById(c.env.DB, request.user_id);
  if (applicant && club) {
    await notifyUser(c.env, {
      userId: applicant.id,
      userEmail: applicant.email,
      userName: applicant.name,
      type: "club_join_rejected",
      title: `Beitritt zu „${club.name}“ abgelehnt`,
      body: `${c.get("name") ?? c.get("email")} hat deine Beitrittsanfrage für „${club.name}“ abgelehnt.`,
      link: "/verein",
    });
  }

  return c.json({ ok: true });
});

// --- Ferien/Feiertage (vereinsspezifisch) -----------------------------------
// Zusätzlich zu den fest im Frontend hinterlegten RLP-Schulferien
// (src/lib/holidays.ts) - z.B. für bewegliche Ferientage oder Vereine
// außerhalb Rheinland-Pfalz. Lesend für alle Vereinsmitglieder (wird für die
// Trainingstermin-Berechnung gebraucht), Anlegen/Löschen nur Jugendleitung.
app.get("/api/holidays", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listHolidaysForClub(c.env.DB, clubId));
});

app.post("/api/holidays", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann Ferien pflegen" }, 403);

  const body = await c.req.json().catch(() => null);
  const label = requiredText(body?.label, 100);
  const start = validDate(body?.start);
  const end = validDate(body?.end);
  if (!label) return c.json({ error: "Bezeichnung fehlt oder ist ungültig" }, 400);
  if (!start || !end) return c.json({ error: "Ungültiger Zeitraum" }, 400);
  if (start > end) return c.json({ error: "Beginn muss vor oder gleich dem Ende liegen" }, 400);

  const holiday = await db.createHoliday(c.env.DB, { clubId, label, start, end });
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "holiday.created",
    targetLabel: `${label} (${start} – ${end})`,
  });
  return c.json(holiday, 201);
});

// Bulk-Import (ICS/CSV wird im Frontend geparst, siehe src/lib/holidayImport.ts
// - hier kommen nur schon aufbereitete {label, start, end}-Einträge an).
// Begrenzt auf 500 Einträge pro Import, damit niemand versehentlich eine
// riesige Datei in tausende Einzelzeilen verwandelt.
app.post("/api/holidays/import", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann Ferien pflegen" }, 403);

  const body = await c.req.json().catch(() => null);
  const rawEntries = Array.isArray(body?.entries) ? body.entries : null;
  if (!rawEntries || rawEntries.length === 0) return c.json({ error: "Keine Einträge übergeben" }, 400);
  if (rawEntries.length > 500) return c.json({ error: "Zu viele Einträge auf einmal (max. 500)" }, 400);

  const entries: { label: string; start: string; end: string }[] = [];
  for (const raw of rawEntries) {
    const label = requiredText(raw?.label, 200);
    const start = validDate(raw?.start);
    const end = validDate(raw?.end);
    if (!label || !start || !end || start > end) return c.json({ error: "Ungültiger Eintrag in der Import-Datei" }, 400);
    entries.push({ label, start, end });
  }

  const created = await db.createHolidaysBulk(c.env.DB, clubId, entries);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "holiday.imported",
    targetLabel: `${created.length} Ferien-/Ausfallzeiträume importiert`,
  });
  return c.json(created, 201);
});

app.delete("/api/holidays/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const existing = await db.getHolidayRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  if (existing.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Nur die Jugendleitung kann Ferien pflegen" }, 403);
  }
  await db.deleteHoliday(c.env.DB, id);
  await db.logAudit(c.env.DB, {
    clubId: existing.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "holiday.deleted",
    targetLabel: `${existing.label} (${existing.start_date} – ${existing.end_date})`,
  });
  return c.body(null, 204);
});

// --- Events & Helfer-Zuteilung ---

app.get("/api/events", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listEventsForClub(c.env.DB, clubId, c.get("userId")));
});

app.post("/api/events", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const canCreateEvent = c.get("clubRole") === "member" || c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin"));
  if (!canCreateEvent) {
    return c.json({ error: "Nur Turntrainer, Gruppenleitung, Jugendleitung oder Admins können Events erstellen" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const eventDate = validDate(body.eventDate);
  if (!title) return c.json({ error: "Titel ist erforderlich" }, 400);
  if (!eventDate) return c.json({ error: "Gültiges Datum erforderlich (JJJJ-MM-TT)" }, 400);

  const startTime = typeof body.startTime === "string" && body.startTime.trim() ? body.startTime.trim() : null;
  const endTime = typeof body.endTime === "string" && body.endTime.trim() ? body.endTime.trim() : null;
  const location = typeof body.location === "string" && body.location.trim() ? body.location.trim() : null;
  const requiredTrainers = typeof body.requiredTrainers === "number" && body.requiredTrainers > 0 ? Math.floor(body.requiredTrainers) : 1;
  const tasks = typeof body.tasks === "string" && body.tasks.trim() ? body.tasks.trim() : null;
  const materials = typeof body.materials === "string" && body.materials.trim() ? body.materials.trim() : null;
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  const event = await db.createEvent(c.env.DB, {
    clubId,
    title,
    description,
    eventDate,
    startTime,
    endTime,
    location,
    requiredTrainers,
    tasks,
    materials,
    createdBy: c.get("userId"),
  });

  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "event.created",
    targetLabel: `${title} (${eventDate})`,
  });

  return c.json(event, 201);
});

app.put("/api/events/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  if (!existing) return c.json({ error: "Event nicht gefunden" }, 404);

  const isLeadership = c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin")) || existing.createdBy === c.get("userId");
  if (!isLeadership) {
    return c.json({ error: "Keine Berechtigung zum Bearbeiten" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : undefined;
  const eventDate = body.eventDate ? validDate(body.eventDate) : undefined;
  const startTime = body.startTime !== undefined ? (typeof body.startTime === "string" && body.startTime.trim() ? body.startTime.trim() : null) : undefined;
  const endTime = body.endTime !== undefined ? (typeof body.endTime === "string" && body.endTime.trim() ? body.endTime.trim() : null) : undefined;
  const location = body.location !== undefined ? (typeof body.location === "string" && body.location.trim() ? body.location.trim() : null) : undefined;
  const requiredTrainers = typeof body.requiredTrainers === "number" && body.requiredTrainers > 0 ? Math.floor(body.requiredTrainers) : undefined;
  const tasks = body.tasks !== undefined ? (typeof body.tasks === "string" && body.tasks.trim() ? body.tasks.trim() : null) : undefined;
  const materials = body.materials !== undefined ? (typeof body.materials === "string" && body.materials.trim() ? body.materials.trim() : null) : undefined;
  const description = body.description !== undefined ? (typeof body.description === "string" && body.description.trim() ? body.description.trim() : null) : undefined;

  const updated = await db.updateEvent(c.env.DB, id, clubId, c.get("userId"), {
    title,
    description,
    eventDate,
    startTime,
    endTime,
    location,
    requiredTrainers,
    tasks,
    materials,
  });

  return c.json(updated);
});

app.delete("/api/events/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  if (!existing) return c.body(null, 204);

  const isLeadership = c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin")) || existing.createdBy === c.get("userId");
  if (!isLeadership) {
    return c.json({ error: "Keine Berechtigung zum Löschen" }, 403);
  }

  await db.deleteEvent(c.env.DB, id, clubId);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "event.deleted",
    targetLabel: `${existing.title} (${existing.eventDate})`,
  });

  return c.body(null, 204);
});

app.post("/api/events/:id/register", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  if (!existing) return c.json({ error: "Event nicht gefunden" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const unregister = Boolean(body.unregister);

  if (unregister) {
    await db.unregisterEventHelper(c.env.DB, id, c.get("userId"));
  } else {
    await db.registerEventHelper(c.env.DB, id, c.get("userId"), null);
  }

  const updated = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  return c.json(updated);
});

app.post("/api/events/:id/assign", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const isLeadership = c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin"));
  if (!isLeadership) {
    return c.json({ error: "Nur die Jugendleitung oder Admins können Helfer zuteilen" }, 403);
  }

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Event-ID" }, 400);

  const existing = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  if (!existing) return c.json({ error: "Event nicht gefunden" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const targetUserId = validId(body.userId);
  if (!targetUserId) return c.json({ error: "Ungültige Nutzer-ID" }, 400);
  const unassign = Boolean(body.unassign);
  const assignedTask = optionalText(body.assignedTask, 200);

  if (unassign) {
    await db.unregisterEventHelper(c.env.DB, id, targetUserId);
  } else {
    await db.registerEventHelper(c.env.DB, id, targetUserId, c.get("userId"), assignedTask);
  }

  const updated = await db.getEventById(c.env.DB, id, clubId, c.get("userId"));
  return c.json(updated);
});

// --- Geräte- & Mängelmelder ----------------------------------------------

app.get("/api/equipment-reports", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const reports = await db.listEquipmentReportsForClub(c.env.DB, clubId);
  return c.json(reports);
});

app.post("/api/equipment-reports", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const body = await c.req.json().catch(() => null);
  const title = requiredText(body?.title, 150);
  if (!title) return c.json({ error: "Titel / Bezeichnung der Mängelmeldung ist erforderlich" }, 400);

  const location = optionalText(body?.location, 150);
  const description = optionalText(body?.description, 2000);
  const severityRaw = body?.severity;
  const severity = severityRaw === "low" || severityRaw === "high" ? severityRaw : "medium";

  const created = await db.createEquipmentReport(c.env.DB, {
    clubId,
    title,
    location,
    severity,
    description,
    reportedBy: c.get("userId"),
  });

  return c.json(created, 201);
});

app.put("/api/equipment-reports/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Mängelmeldung-ID" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const title = optionalText(body.title, 150);
  const location = optionalText(body.location, 150);
  const description = optionalText(body.description, 2000);

  const severityRaw = body.severity;
  const severity = severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" ? severityRaw : undefined;

  const statusRaw = body.status;
  const status = statusRaw === "open" || statusRaw === "in_progress" || statusRaw === "resolved" ? statusRaw : undefined;

  const updated = await db.updateEquipmentReport(c.env.DB, id, clubId, {
    title: title ?? undefined,
    location,
    severity,
    status,
    description,
  });

  return c.json(updated);
});

app.delete("/api/equipment-reports/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Mängelmeldung-ID" }, 400);

  await db.deleteEquipmentReport(c.env.DB, id, clubId);
  return c.json({ ok: true });
});

// --- Schwarzes Brett & Pinnwand ------------------------------------------

app.get("/api/bulletin-posts", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const posts = await db.listBulletinPostsForClub(c.env.DB, clubId);
  return c.json(posts);
});

app.post("/api/bulletin-posts", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const body = await c.req.json().catch(() => null);
  const title = requiredText(body?.title, 150);
  const content = requiredText(body?.content, 5000);
  if (!title || !content) return c.json({ error: "Titel und Inhalt sind erforderlich" }, 400);

  const categoryRaw = body?.category;
  const validCategories = ["general", "hall", "training", "event", "urgent"];
  const category = validCategories.includes(categoryRaw) ? categoryRaw : "general";

  const isLeadership = c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin"));
  const isPinned = isLeadership ? Boolean(body?.isPinned) : false;

  const created = await db.createBulletinPost(c.env.DB, {
    clubId,
    title,
    content,
    category,
    authorId: c.get("userId"),
    isPinned,
  });

  return c.json(created, 201);
});

app.put("/api/bulletin-posts/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Beitrags-ID" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const title = optionalText(body.title, 150);
  const content = optionalText(body.content, 5000);

  const categoryRaw = body.category;
  const validCategories = ["general", "hall", "training", "event", "urgent"];
  const category = validCategories.includes(categoryRaw) ? categoryRaw : undefined;

  const isLeadership = c.get("clubRole") === "jugendleiter" || Boolean(c.get("isAdmin"));
  const isPinned = isLeadership && body.isPinned !== undefined ? Boolean(body.isPinned) : undefined;

  const updated = await db.updateBulletinPost(c.env.DB, id, clubId, {
    title: title ?? undefined,
    content: content ?? undefined,
    category,
    isPinned,
  });

  return c.json(updated);
});

app.delete("/api/bulletin-posts/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Beitrags-ID" }, 400);

  await db.deleteBulletinPost(c.env.DB, id, clubId);
  return c.json({ ok: true });
});

// --- Turnplaner & Hallen-Aufbauplaner -------------------------------------

app.get("/api/training-plans", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const plans = await db.listTrainingPlansForClub(c.env.DB, clubId);
  return c.json(plans);
});

app.post("/api/training-plans", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const body = await c.req.json().catch(() => null);
  const title = requiredText(body?.title, 150);
  if (!title) return c.json({ error: "Titel / Name des Hallenaufbaus ist erforderlich" }, 400);

  const description = optionalText(body?.description, 2000);
  const groupId = optionalId(body?.groupId);
  const canvasData = body?.canvasData ?? { equipment: [] };

  const created = await db.createTrainingPlan(c.env.DB, {
    clubId,
    title,
    description,
    groupId,
    canvasData,
    createdBy: c.get("userId"),
  });

  return c.json(created, 201);
});

app.put("/api/training-plans/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Plan-ID" }, 400);

  const body = await c.req.json().catch(() => ({}));
  const title = optionalText(body.title, 150);
  const description = optionalText(body.description, 2000);
  const groupId = optionalId(body.groupId);
  const canvasData = body.canvasData;

  const updated = await db.updateTrainingPlan(c.env.DB, id, clubId, {
    title: title ?? undefined,
    description,
    groupId,
    canvasData,
  });

  return c.json(updated);
});

app.delete("/api/training-plans/:id", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige Plan-ID" }, 400);

  await db.deleteTrainingPlan(c.env.DB, id, clubId);
  return c.json({ ok: true });
});

// Ein anderes Vereinsmitglied zur Jugendleitung befördern - nur für
// bestehende Jugendleitungen desselben Vereins.
app.post("/api/clubs/mine/members/:userId/promote", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann diese Aktion ausführen" }, 403);

  const targetUserId = validId(c.req.param("userId"));
  if (!targetUserId) return c.json({ error: "Ungültige Nutzer-ID" }, 400);

  const target = await db.getUserById(c.env.DB, targetUserId);
  const ok = await db.setClubRole(c.env.DB, targetUserId, clubId, "jugendleiter");
  if (!ok) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "member.promoted",
    targetLabel: target?.name ?? target?.email ?? targetUserId,
  });
  return c.json({ ok: true });
});

// Eine Jugendleitung zurückstufen - nur möglich, wenn danach mindestens eine
// weitere Jugendleitung im Verein übrig bleibt.
app.post("/api/clubs/mine/members/:userId/demote", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann diese Aktion ausführen" }, 403);

  const targetUserId = validId(c.req.param("userId"));
  if (!targetUserId) return c.json({ error: "Ungültige Nutzer-ID" }, 400);

  const otherLeaders = await db.countClubLeaders(c.env.DB, clubId, targetUserId);
  if (otherLeaders === 0) {
    return c.json({ error: "Es muss mindestens eine Jugendleitung im Verein bleiben" }, 409);
  }

  const target = await db.getUserById(c.env.DB, targetUserId);
  const ok = await db.setClubRole(c.env.DB, targetUserId, clubId, "member");
  if (!ok) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "member.demoted",
    targetLabel: target?.name ?? target?.email ?? targetUserId,
  });
  return c.json({ ok: true });
});

// Additive Vereins-Flags (Springer:in / Kassenwart:in) setzen/entfernen -
// beliebig mit der club_role kombinierbar, nur die Jugendleitung vergibt sie.
// Springer:in zusätzlich nur, solange die Person keine eigene Gruppe leitet.
app.post("/api/clubs/mine/members/:userId/make-springer", requireAuth, (c) => setMemberFlag(c, "is_springer", true));
app.post("/api/clubs/mine/members/:userId/unset-springer", requireAuth, (c) => setMemberFlag(c, "is_springer", false));
app.post("/api/clubs/mine/members/:userId/make-kassenwart", requireAuth, (c) => setMemberFlag(c, "is_kassenwart", true));
app.post("/api/clubs/mine/members/:userId/unset-kassenwart", requireAuth, (c) => setMemberFlag(c, "is_kassenwart", false));

async function setMemberFlag(c: Context<AppEnv>, column: "is_springer" | "is_kassenwart", value: boolean) {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann diese Aktion ausführen" }, 403);

  const targetUserId = validId(c.req.param("userId"));
  if (!targetUserId) return c.json({ error: "Ungültige Nutzer-ID" }, 400);

  const target = await db.getUserById(c.env.DB, targetUserId);
  if (!target || target.clubId !== clubId) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  if (column === "is_springer" && value && (await db.userLeadsAnyGroup(c.env.DB, targetUserId))) {
    return c.json({ error: "Person leitet noch eine Gruppe – bitte zuerst die Gruppenleitung übergeben" }, 409);
  }

  const ok = await db.setUserFlag(c.env.DB, column, targetUserId, clubId, value);
  if (!ok) return c.json({ error: "Mitglied nicht gefunden" }, 404);
  const actionBase = column === "is_springer" ? "springer" : "kassenwart";
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: value ? `member.made_${actionBase}` : `member.unset_${actionBase}`,
    targetLabel: target.name ?? target.email ?? targetUserId,
  });
  return c.json({ ok: true });
}

// --- Gruppen -----------------------------------------------------------

app.get("/api/groups", requireAuth, async (c) => {
  return c.json(await db.listGroupsForUser(c.env.DB, c.get("userId"), c.get("clubId"), c.get("clubRole")));
});

// Saisonwechsel-Assistent: reine, jederzeit neu berechenbare Vorschläge.
// Die eigentliche Ausführung nutzt anschließend bewusst den etablierten
// /children/:id/move-Flow mit Kapazitätsprüfung, Audit und Freigaben.
app.get("/api/season-transition/proposals", requireAuth, async (c) => {
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann diese Aktion ausführen" }, 403);
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);
  const referenceDate = validDate(c.req.query("referenceDate"));
  if (!referenceDate) return c.json({ error: "Stichtag ist ungültig (Format JJJJ-MM-TT)" }, 400);
  const at = new Date(`${referenceDate}T12:00:00Z`);
  const ageAt = (birthDate: string) => {
    const [year, month, day] = birthDate.split("-").map(Number);
    let age = at.getUTCFullYear() - year;
    if (at.getUTCMonth() + 1 < month || (at.getUTCMonth() + 1 === month && at.getUTCDate() < day)) age--;
    return age;
  };
  const [groups, children] = await Promise.all([
    db.listGroupsForUser(c.env.DB, c.get("userId"), c.get("clubId"), c.get("clubRole")),
    db.listChildrenForUser(c.env.DB, c.get("userId"), c.get("clubId")),
  ]);
  const counts = new Map<string, number>();
  for (const child of children) if (child.groupId) counts.set(child.groupId, (counts.get(child.groupId) ?? 0) + 1);
  const clubGroups = groups.filter((group) => group.clubId === clubId);
  const byId = new Map(clubGroups.map((group) => [group.id, group]));
  const proposals = children.flatMap((child) => {
    if (!child.groupId) return [];
    const current = byId.get(child.groupId);
    if (!current) return [];
    const age = ageAt(child.birthDate);
    if (age >= current.minAge && age < current.maxAge) return [];
    const candidates = clubGroups
      .filter((group) => group.id !== current.id && age >= group.minAge && age < group.maxAge)
      .map((group) => ({
        id: group.id,
        name: group.name,
        availablePlaces: group.maxChildren === null ? null : Math.max(0, group.maxChildren - (counts.get(group.id) ?? 0)),
      }))
      .sort((a, b) => (b.availablePlaces ?? Number.MAX_SAFE_INTEGER) - (a.availablePlaces ?? Number.MAX_SAFE_INTEGER));
    return [{ childId: child.id, childName: `${child.firstName} ${child.lastName}`, birthDate: child.birthDate, age, fromGroupId: current.id, fromGroupName: current.name, candidates }];
  });
  return c.json({ referenceDate, proposals });
});

app.post("/api/groups", requireAuth, async (c) => {
  if (c.get("isSpringer"))
    return c.json({ error: "Springer:innen können keine eigene Gruppe anlegen" }, 403);
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  const ageRange = validAgeRange(body?.minAge, body?.maxAge);
  const sortOrder = validSortOrder(body?.sortOrder);
  const maxChildren = validOptionalCount(body?.maxChildren);
  const weekday = validWeekday(body?.weekday);
  const startTime = validTime(body?.startTime);
  const endTime = validTime(body?.endTime);
  const location = optionalText(body?.location, 100);
  const color = validGroupColor(body?.color);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);
  if (maxChildren === null) return c.json({ error: "Max. Kinderzahl fehlt" }, 400);
  if (weekday === undefined) return c.json({ error: "Wochentag ist ungültig" }, 400);
  if (weekday === null) return c.json({ error: "Trainingstag fehlt" }, 400);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (startTime === null || endTime === null) return c.json({ error: "Von-/Bis-Uhrzeit fehlt" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);
  if (location === null) return c.json({ error: "Ort/Halle fehlt" }, 400);
  if (color === undefined) return c.json({ error: "Farbe ist ungültig" }, 400);

  const group = await db.createGroup(c.env.DB, {
    name,
    ...ageRange,
    sortOrder,
    maxChildren,
    weekday,
    startTime,
    endTime,
    location,
    ownerId: c.get("userId"),
    ownerName: c.get("name"),
    clubId: c.get("clubId"),
    color,
  });
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.created",
    targetLabel: group.name,
    groupId: group.id,
  });
  return c.json(group, 201);
});

app.put("/api/groups/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  const ageRange = validAgeRange(body?.minAge, body?.maxAge);
  const sortOrder = validSortOrder(body?.sortOrder);
  const maxChildren = validOptionalCount(body?.maxChildren);
  const weekday = validWeekday(body?.weekday);
  const startTime = validTime(body?.startTime);
  const endTime = validTime(body?.endTime);
  const location = optionalText(body?.location, 100);
  const color = validGroupColor(body?.color);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);
  if (maxChildren === null) return c.json({ error: "Max. Kinderzahl fehlt" }, 400);
  if (weekday === undefined) return c.json({ error: "Wochentag ist ungültig" }, 400);
  if (weekday === null) return c.json({ error: "Trainingstag fehlt" }, 400);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (startTime === null || endTime === null) return c.json({ error: "Von-/Bis-Uhrzeit fehlt" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);
  if (location === null) return c.json({ error: "Ort/Halle fehlt" }, 400);
  if (color === undefined) return c.json({ error: "Farbe ist ungültig" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const isLeadership = Boolean(
    existing.club_id && existing.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter"
  );
  if (!isLeadership && !(await db.canWriteGroupAsync(c.env.DB, existing, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const group = await db.updateGroup(
    c.env.DB,
    id,
    { name, ...ageRange, sortOrder, maxChildren, weekday, startTime, endTime, location, color },
    { userId: c.get("userId"), ownerName: c.get("name") }
  );
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.updated",
    targetLabel: group.name,
    groupId: group.id,
  });

  // Wurde die Kapazität erhöht, können jetzt Wartelisten-Einträge nachrücken.
  await promoteWaitlistIfPossible(c, id);
  await notifyClubWaitlistOnFreedCapacity(c, id);
  return c.json(group);
});

// Eine herrenlose Alt-Gruppe (aus der Zeit vor Vereinen) dem eigenen Verein
// zuordnen. Danach gehört sie dem aufrufenden Nutzer und ist für andere
// Vereinsmitglieder lesend sichtbar. Nur die Jugendleitung darf das, damit
// nicht jedes Mitglied beliebig Gruppen in den Verein ziehen kann.
app.post("/api/groups/:id/claim", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);
  if (c.get("clubRole") !== "jugendleiter")
    return c.json({ error: "Nur die Jugendleitung kann Gruppen dem Verein zuordnen" }, 403);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (existing.owner_id !== null || existing.club_id !== null) {
    return c.json({ error: "Gruppe ist bereits einem Turnleiter bzw. Verein zugeordnet" }, 409);
  }

  const group = await db.claimGroup(c.env.DB, id, { ownerId: c.get("userId"), ownerName: c.get("name"), clubId });
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.claimed",
    targetLabel: group.name,
    groupId: group.id,
  });
  return c.json(group);
});

app.delete("/api/groups/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  const isLeadership = Boolean(
    existing.club_id && existing.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter"
  );
  if (!isLeadership && !(await db.canWriteGroupAsync(c.env.DB, existing, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.deleteGroup(c.env.DB, id);
  await db.logAudit(c.env.DB, {
    clubId: existing.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.deleted",
    targetLabel: existing.name,
  });
  return c.body(null, 204);
});

// Mehrere gleichberechtigte Leitungen pro Gruppe (dauerhaft, nicht nur als
// Vertretung für einen einzelnen Termin): Mit-Trainer*innen bekommen
// dieselben Schreibrechte wie die eigentliche Gruppenleitung. Verwalten
// (hinzufügen/entfernen) dürfen nur die/der Besitzer:in der Gruppe oder die
// Jugendleitung - nicht Mit-Trainer*innen selbst, um unkontrolliertes
// Weiterreichen zu verhindern.
app.get("/api/groups/:id/co-leaders", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const group = await db.getGroupRowById(c.env.DB, id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!(await db.canWriteGroupAsync(c.env.DB, group, c.get("userId")))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  return c.json(await db.listGroupCoLeaders(c.env.DB, id));
});

app.post("/api/groups/:id/co-leaders", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const targetUserId = validId(body?.userId);
  if (!id || !targetUserId) return c.json({ error: "Ungültige Anfrage" }, 400);

  const group = await db.getGroupRowById(c.env.DB, id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const isOwnerOrLeadership =
    db.canWriteGroup(group, c.get("userId")) ||
    (group.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
  if (!isOwnerOrLeadership) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  if (targetUserId === group.owner_id) return c.json({ error: "Ist bereits Gruppenleitung" }, 400);

  const target = await db.getUserById(c.env.DB, targetUserId);
  if (!target || !group.club_id || target.clubId !== group.club_id) {
    return c.json({ error: "Nur Mitglieder desselben Vereins können Mit-Trainer*in werden" }, 400);
  }
  if (target.isSpringer) {
    return c.json({ error: "Springer:innen können nicht als Mit-Trainer*in eingetragen werden – bitte zuerst die Springer-Rolle aufheben" }, 400);
  }

  await db.addGroupCoLeader(c.env.DB, id, targetUserId, c.get("userId"));
  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.co_leader_added",
    targetLabel: `${group.name} ← ${target.name ?? target.email}`,
    groupId: group.id,
  });
  await notifyUser(c.env, {
    userId: target.id,
    userEmail: target.email,
    userName: target.name,
    type: "group_co_leader_added",
    title: `Mit-Trainer*in für „${group.name}“`,
    body: `${c.get("name") ?? c.get("email")} hat dich als Mit-Trainer*in für „${group.name}“ eingetragen - du hast jetzt dieselben Rechte wie die Gruppenleitung.`,
    link: "/gruppen",
  });

  return c.json({ ok: true }, 201);
});

app.delete("/api/groups/:id/co-leaders/:userId", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const targetUserId = validId(c.req.param("userId"));
  if (!id || !targetUserId) return c.json({ error: "Ungültige ID" }, 400);

  const group = await db.getGroupRowById(c.env.DB, id);
  if (!group) return c.body(null, 204);
  const isOwnerOrLeadership =
    db.canWriteGroup(group, c.get("userId")) ||
    (group.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
  if (!isOwnerOrLeadership) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.removeGroupCoLeader(c.env.DB, id, targetUserId);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.co_leader_removed",
    targetLabel: group.name,
    groupId: id,
  });
  return c.body(null, 204);
});

// --- Kinder --------------------------------------------------------------

// Least-Privilege-Härtung (externe Production-Readiness-Prüfung
// 2026-08-27): die Kinderliste ist vereinsweit sichtbar (auch für Kinder
// fremder Gruppen, damit z.B. Geschwister-Verknüpfung oder Warteliste
// funktionieren), enthielt bisher aber für JEDES zurückgegebene Kind auch
// die entschlüsselten Notfallkontakte - unabhängig davon, ob die
// anfragende Person überhaupt eine Beziehung zu dieser Gruppe hat. Wer ein
// Kind nicht bearbeiten darf UND nicht Jugendleitung ist (die braucht den
// vereinsweiten Überblick tatsächlich, z.B. für Vertretungsplanung),
// bekommt die Notfallkontakte jetzt als null statt im Klartext - alle
// anderen Felder (Name, Gruppe, Alter) bleiben unverändert sichtbar, die
// sind fürs bloße Auflisten/Zuordnen nötig.
app.get("/api/children", requireAuth, async (c) => {
  const includeArchived = c.req.query("includeArchived") === "true";
  const children = await db.listChildrenForUser(c.env.DB, c.get("userId"), c.get("clubId"), includeArchived);
  // Volle Sicht (inkl. Notfallkontakte) für Jugendleitung UND Plattform-Admin.
  const fullView = c.get("clubRole") === "jugendleiter" || c.get("isAdmin");
  const decrypted = await Promise.all(
    children.map(async (child) => {
      const full = await decryptChild(child, c.env.ENCRYPTION_KEY);
      if (full.canEdit || fullView) return full;
      return { ...full, emergencyContactName: null, emergencyContactPhone: null };
    })
  );
  return c.json(decrypted);
});

// Entschlüsselt die verschlüsselt gespeicherten Felder eines Child-Objekts
// für die API-Antwort - siehe worker/src/crypto.ts, Finding PRIV-02. Das
// Frontend bekommt weiterhin ganz normalen Klartext, die Verschlüsselung
// ist rein serverseitig.
async function decryptChild<T extends Child | null>(child: T, encryptionKey: string): Promise<T> {
  if (!child) return child;
  return {
    ...child,
    emergencyContactName: await decryptField(child.emergencyContactName, encryptionKey),
    emergencyContactPhone: await decryptField(child.emergencyContactPhone, encryptionKey),
  };
}

// Formatiert Geburtsdatum und Notfallkontakt eines Kindes für
// Benachrichtigungs-E-Mails an eine (neue) Gruppenleitung - die Daten sind
// zwar ohnehin vereinsweit über die Kinderliste einsehbar, aber direkt in
// der Mail sollen sie sofort verfügbar sein, ohne erst in der App
// nachschauen zu müssen.
async function childContactSummary(child: ChildRow, encryptionKey: string): Promise<string> {
  const [year, month, day] = child.birth_date.split("-");
  const lines = [`Geburtsdatum: ${day}.${month}.${year}`];
  const contactName = await decryptField(child.emergency_contact_name, encryptionKey);
  const contactPhone = await decryptField(child.emergency_contact_phone, encryptionKey);
  const contact = [contactName, contactPhone].filter(Boolean).join(", ");
  if (contact) lines.push(`Notfallkontakt: ${contact}`);
  return lines.join("\n");
}

// Benachrichtigt alle Jugendleitungen des Vereins, dem eine Gruppe gehört,
// über eine neue Kapazitäts-Anfrage.
async function notifyCapacityRequest(
  c: { env: Env; get: <K extends keyof Variables>(key: K) => Variables[K] },
  clubId: string,
  groupName: string,
  childName: string
): Promise<void> {
  const members = await db.listClubMembers(c.env.DB, clubId);
  for (const member of members.filter((m) => m.role === "jugendleiter")) {
    await notifyUser(c.env, {
      userId: member.id,
      userEmail: member.email,
      userName: member.name,
      type: "capacity_request",
      title: `Kapazitäts-Anfrage für „${groupName}“`,
      body: `${childName} soll in die volle Gruppe „${groupName}“ - bitte freigeben oder ablehnen.`,
      link: "/gruppen",
    });
  }
}

app.post("/api/children", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const firstName = requiredText(body?.firstName, 100);
  const lastName = requiredText(body?.lastName, 100);
  const birthDate = validDate(body?.birthDate);
  const groupId = optionalId(body?.groupId);
  const emergencyContactName = optionalText(body?.emergencyContactName, 100);
  const emergencyContactPhone = optionalText(body?.emergencyContactPhone, 40);
  const familyId = optionalId(body?.familyId);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (emergencyContactName === undefined) return c.json({ error: "Notfallkontakt (Name) ist zu lang" }, 400);
  if (emergencyContactPhone === undefined) return c.json({ error: "Notfallkontakt (Telefon) ist zu lang" }, 400);
  if (familyId === undefined) return c.json({ error: "Familie ist ungültig" }, 400);

  // Mandantengrenze (P0-Fix, s. Migration 0036): bei Zielgruppe deren
  // Verein, sonst der Verein der anlegenden Person - ein Kind ganz ohne
  // Vereinszuordnung darf nicht neu entstehen, sonst wäre es sofort wieder
  // für niemanden mehr sinnvoll zuordenbar bzw. je nach Zufall der
  // OR-Kette in listChildrenForUser für alle offen.
  let clubIdForChild: string | null = null;
  let targetGroup: GroupRow | null = null;
  if (groupId) {
    targetGroup = await db.getGroupRowById(c.env.DB, groupId);
    if (!targetGroup) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    clubIdForChild = targetGroup.club_id;
  } else {
    clubIdForChild = c.get("clubId");
    if (!clubIdForChild) return c.json({ error: "Kein Verein zugeordnet" }, 400);
  }

  // Cross-Tenant-Verknüpfung verhindern (Migration 0039, s. auch
  // PUT /api/children/:id/family) - auch schon beim Anlegen prüfen, nicht
  // nur beim nachträglichen Ändern der Familien-Zuordnung.
  if (familyId) {
    const family = await db.getFamilyRowById(c.env.DB, familyId);
    if (!family || family.club_id === null || family.club_id !== clubIdForChild) {
      return c.json({ error: "Familie gehört nicht zu diesem Verein" }, 403);
    }
  }

  // Notfallkontakte verschlüsselt ablegen (auch im Kapazitäts-Anfrage-
  // Payload, falls diese Aktion erst nach Freigabe ausgeführt wird) - siehe
  // worker/src/crypto.ts, Finding PRIV-02. Bewusst KEIN Freitext-Notizfeld
  // mehr (ehemals "notes") - Art.-9-Daten (Diagnosen, Allergien etc.)
  // lassen sich sonst faktisch trotzdem eintragen, unabhängig vom
  // Spaltennamen. Siehe auch Entfernung von health_notes.
  const childInput = {
    firstName,
    lastName,
    birthDate,
    groupId,
    clubId: clubIdForChild,
    emergencyContactName: await encryptField(emergencyContactName, c.env.ENCRYPTION_KEY),
    emergencyContactPhone: await encryptField(emergencyContactPhone, c.env.ENCRYPTION_KEY),
    familyId,
  };

  const duplicate = clubIdForChild
    ? await db.findUnassignedChildDuplicate(c.env.DB, { clubId: clubIdForChild, firstName, lastName, birthDate })
    : null;

  if (groupId) {
    const group = targetGroup as GroupRow;
    const canWriteTarget =
      (await db.canWriteGroupAsync(c.env.DB, group, c.get("userId"))) ||
      (c.get("clubRole") === "jugendleiter" && Boolean(group.club_id) && group.club_id === c.get("clubId"));
    if (!canWriteTarget) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

    if (duplicate) {
      return c.json({
        error: `${duplicate.firstName} ${duplicate.lastName} ist bereits ohne Gruppe angelegt`,
        code: "unassigned_child_duplicate",
        existingChildId: duplicate.id,
        existingChildName: `${duplicate.firstName} ${duplicate.lastName}`,
        targetGroupId: group.id,
        targetGroupName: group.name,
      }, 409);
    }

    const gate = await capacityGate(c.env.DB, group, undefined, {
      userId: c.get("userId"),
      clubId: c.get("clubId"),
      clubRole: c.get("clubRole"),
    });
    if (gate.mode === "self_confirm" && body?.confirmOverCapacity !== true) return c.json(gate.warning, 409);
    if (gate.mode === "leadership_approval") {
      const pending = await fileCapacityRequest(c.env.DB, {
        groupId,
        groupName: group.name,
        action: "create_child",
        childId: null,
        payload: childInput,
        requestedBy: c.get("userId"),
      });
      if (group.club_id) await notifyCapacityRequest(c, group.club_id, group.name, `${firstName} ${lastName}`);
      return c.json(pending, 202);
    }
  }

  if (duplicate) {
    return c.json({
      error: `${duplicate.firstName} ${duplicate.lastName} ist bereits ohne Gruppe angelegt`,
      code: "unassigned_child_duplicate",
      existingChildId: duplicate.id,
      existingChildName: `${duplicate.firstName} ${duplicate.lastName}`,
      targetGroupId: null,
      targetGroupName: null,
    }, 409);
  }

  const child = await db.createChild(c.env.DB, childInput);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.created",
    targetLabel: `${firstName} ${lastName}`,
    groupId,
    childId: child.id,
  });
  await notifyClubInApp(c.env, clubIdForChild, {
    type: "club_child_created",
    title: "Kind neu hinzugefügt",
    body: `${firstName} ${lastName} wurde ${targetGroup ? `der Gruppe „${targetGroup.name}“` : "dem Bereich „Ohne Gruppe“"} hinzugefügt.`,
    link: "/kinder",
    childId: child.id,
  });
  return c.json(await decryptChild(child, c.env.ENCRYPTION_KEY), 201);
});

app.put("/api/children/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const firstName = requiredText(body?.firstName, 100);
  const lastName = requiredText(body?.lastName, 100);
  const birthDate = validDate(body?.birthDate);
  const groupId = optionalId(body?.groupId);
  const emergencyContactName = optionalText(body?.emergencyContactName, 100);
  const emergencyContactPhone = optionalText(body?.emergencyContactPhone, 40);
  const familyId = optionalId(body?.familyId);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (emergencyContactName === undefined) return c.json({ error: "Notfallkontakt (Name) ist zu lang" }, 400);
  if (emergencyContactPhone === undefined) return c.json({ error: "Notfallkontakt (Telefon) ist zu lang" }, 400);
  if (familyId === undefined) return c.json({ error: "Familie ist ungültig" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  // Mandantengrenze (P0-Fix, s. Migration 0036): bei Zielgruppe deren
  // Verein, sonst unverändert (isChildWritable hat oben bereits verifiziert,
  // dass der/die Bearbeitende zum bisherigen club_id-Verein passt).
  let clubIdForChild = existing.club_id;
  let targetGroup: GroupRow | null = null;
  if (groupId) {
    targetGroup = await db.getGroupRowById(c.env.DB, groupId);
    if (!targetGroup) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    clubIdForChild = targetGroup.club_id;
  }

  // Cross-Tenant-Verknüpfung verhindern (Migration 0039).
  if (familyId) {
    const family = await db.getFamilyRowById(c.env.DB, familyId);
    if (!family || family.club_id === null || family.club_id !== clubIdForChild) {
      return c.json({ error: "Familie gehört nicht zu diesem Verein" }, 403);
    }
  }

  const childInput = {
    firstName,
    lastName,
    birthDate,
    groupId,
    clubId: clubIdForChild,
    emergencyContactName: await encryptField(emergencyContactName, c.env.ENCRYPTION_KEY),
    emergencyContactPhone: await encryptField(emergencyContactPhone, c.env.ENCRYPTION_KEY),
    familyId,
  };

  if (groupId) {
    const group = targetGroup as GroupRow;
    const canWriteTarget =
      (await db.canWriteGroupAsync(c.env.DB, group, c.get("userId"))) ||
      (c.get("clubRole") === "jugendleiter" && Boolean(group.club_id) && group.club_id === c.get("clubId"));
    if (!canWriteTarget) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

    if (groupId !== existing.group_id) {
      const gate = await capacityGate(c.env.DB, group, id, {
        userId: c.get("userId"),
        clubId: c.get("clubId"),
        clubRole: c.get("clubRole"),
      });
      if (gate.mode === "self_confirm" && body?.confirmOverCapacity !== true) return c.json(gate.warning, 409);
      if (gate.mode === "leadership_approval") {
        const pending = await fileCapacityRequest(c.env.DB, {
          groupId,
          groupName: group.name,
          action: "update_child",
          childId: id,
          payload: childInput,
          requestedBy: c.get("userId"),
        });
        if (group.club_id) await notifyCapacityRequest(c, group.club_id, group.name, `${firstName} ${lastName}`);
        return c.json(pending, 202);
      }
    }
  }

  const previousGroupId = existing.group_id;
  const child = await db.updateChild(c.env.DB, id, childInput);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);

  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.updated",
    targetLabel: `${firstName} ${lastName}`,
    groupId: groupId,
    childId: id,
  });

  if (previousGroupId !== groupId) {
    const previousGroup = previousGroupId ? await db.getGroupRowById(c.env.DB, previousGroupId) : null;
    await notifyClubInApp(c.env, clubIdForChild, {
      type: "club_child_moved",
      title: "Kind verschoben",
      body: childMovedBody(`${firstName} ${lastName}`, previousGroup, targetGroup),
      link: "/kinder",
      childId: id,
    });
  }

  // Verließ das Kind eine kapazitätsbeschränkte Gruppe, kann jetzt jemand
  // von deren Warteliste nachrücken.
  if (previousGroupId && previousGroupId !== groupId) {
    await promoteWaitlistIfPossible(c, previousGroupId);
    await notifyClubWaitlistOnFreedCapacity(c, previousGroupId);
  }

  return c.json(await decryptChild(child, c.env.ENCRYPTION_KEY));
});

app.delete("/api/children/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.deleted",
    targetLabel: `${existing.first_name} ${existing.last_name}`,
    groupId: existing.group_id,
  });

  // Erst Freitext-Spuren (Verlauf/Postfach) anonymisieren/entfernen, dann
  // den Kind-Datensatz selbst löschen - siehe
  // PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-06 (vorher blieb der
  // Name/Kontext trotz Löschung unbegrenzt in audit_log/notifications
  // stehen).
  await db.redactChildTraces(c.env.DB, id);
  await db.deleteChild(c.env.DB, id);
  if (existing.group_id) {
    await promoteWaitlistIfPossible(c, existing.group_id);
    await notifyClubWaitlistOnFreedCapacity(c, existing.group_id);
  }
  // Diese Meldung wird bewusst erst nach redactChildTraces() ohne
  // child_id-Referenz angelegt: Der ausdrücklich gewünschte Löschhinweis
  // bleibt im vereinsinternen Postfach sichtbar, enthält aber weder
  // Geburtsdatum noch Kontakt- oder Gesundheitsdaten.
  await notifyClubInApp(c.env, existing.club_id, {
    type: "club_child_deleted",
    title: "Kind gelöscht",
    body: `${existing.first_name} ${existing.last_name} wurde endgültig gelöscht.`,
    link: "/kinder",
  });
  return c.body(null, 204);
});

// Austreten lassen statt löschen - Anwesenheitshistorie und Stundennachweis
// bleiben erhalten, das Kind zählt aber nirgends mehr aktiv mit (Kapazität,
// Anwesenheitslisten). Lässt sich jederzeit wieder reaktivieren.
app.post("/api/children/:id/archive", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const child = await db.archiveChild(c.env.DB, id);
  if (existing.group_id) {
    await promoteWaitlistIfPossible(c, existing.group_id);
    await notifyClubWaitlistOnFreedCapacity(c, existing.group_id);
  }
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.archived",
    targetLabel: `${existing.first_name} ${existing.last_name}`,
    groupId: existing.group_id,
    childId: id,
  });
  const previousGroup = existing.group_id ? await db.getGroupRowById(c.env.DB, existing.group_id) : null;
  await notifyClubInApp(c.env, existing.club_id, {
    type: "club_child_archived",
    title: "Kind ausgetreten",
    body: previousGroup
      ? `${existing.first_name} ${existing.last_name} ist aus „${previousGroup.name}“ ausgetreten.`
      : `${existing.first_name} ${existing.last_name} wurde als ausgetreten markiert (zuletzt „Ohne Gruppe“).`,
    link: "/kinder",
    childId: id,
  });
  return c.json(await decryptChild(child, c.env.ENCRYPTION_KEY));
});

app.post("/api/children/:id/reactivate", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const child = await db.reactivateChild(c.env.DB, id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.reactivated",
    targetLabel: `${existing.first_name} ${existing.last_name}`,
    groupId: existing.group_id,
    childId: id,
  });
  return c.json(await decryptChild(child, c.env.ENCRYPTION_KEY));
});

// --- Familien / Geschwister --------------------------------------------------

// Application-Level Encryption für Familien-Kontaktdaten (P1 "FAMILY FIELD
// ENCRYPTION", externe Production-Readiness-Prüfung 2026-08-27) - dieselbe
// bewährte AES-256-GCM-Verschlüsselung wie bei Notfallkontakten
// (worker/src/crypto.ts, Finding PRIV-02), keine eigene Kryptografie.
async function decryptFamily<T extends Family | null>(family: T, encryptionKey: string): Promise<T> {
  if (!family) return family;
  return {
    ...family,
    contactName: await decryptField(family.contactName, encryptionKey),
    contactPhone: await decryptField(family.contactPhone, encryptionKey),
    contactEmail: await decryptField(family.contactEmail, encryptionKey),
  };
}

app.get("/api/families", requireAuth, async (c) => {
  const families = await db.listFamiliesForUser(c.env.DB, c.get("userId"), c.get("clubId"));
  return c.json(await Promise.all(families.map((f) => decryptFamily(f, c.env.ENCRYPTION_KEY))));
});

// Nur die Familien-Zuordnung eines Kindes ändern, ohne den restlichen
// Datensatz erneut mitschicken zu müssen - Basis für das Verknüpfen von
// Geschwistern direkt aus der Kinder-Liste heraus (siehe Frontend:
// Geschwister werden über eine Auswahl anderer Kinder verknüpft, nicht über
// eine separat anzulegende "Familie").
app.put("/api/children/:id/family", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const familyId = optionalId(body?.familyId);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (familyId === undefined) return c.json({ error: "Familie ist ungültig" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);

  // Bewusst großzügiger als der volle Kind-Bearbeitungsschutz: Geschwister
  // sollen sich auch gruppen- und übungsleiterübergreifend verknüpfen
  // lassen. Wer das Kind ohnehin bearbeiten darf, darf das natürlich immer;
  // zusätzlich reicht es, wenn das Kind über eine Vereinsgruppe im selben
  // Verein sichtbar ist - es wird ja nur die Familien-Zuordnung berührt,
  // sonst nichts.
  let allowed = await isChildWritable(c.env.DB, existing, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") });
  if (!allowed && existing.group_id) {
    const group = await db.getGroupRowById(c.env.DB, existing.group_id);
    const clubId = c.get("clubId");
    allowed = Boolean(group?.club_id && clubId && group.club_id === clubId);
  }
  if (!allowed) return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  // Cross-Tenant-Verknüpfung verhindern (Migration 0039): eine Familie darf
  // nur mit Kindern desselben Vereins verknüpft werden, sonst könnte eine
  // manipulierte familyId Kinder unterschiedlicher Vereine in derselben
  // Familie zusammenführen und damit deren Notfallkontakte querverfügbar
  // machen.
  if (familyId) {
    const family = await db.getFamilyRowById(c.env.DB, familyId);
    if (!family || family.club_id === null || family.club_id !== existing.club_id) {
      return c.json({ error: "Familie gehört nicht zu diesem Verein" }, 403);
    }
  }

  const child = await db.setChildFamily(c.env.DB, id, familyId);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "child.family_changed",
    targetLabel: `${existing.first_name} ${existing.last_name}`,
    groupId: existing.group_id,
    childId: id,
  });
  return c.json(await decryptChild(child, c.env.ENCRYPTION_KEY));
});

app.post("/api/families", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  const contactName = optionalText(body?.contactName, 100);
  const contactPhone = optionalText(body?.contactPhone, 40);
  const contactEmail = optionalText(body?.contactEmail, 254);
  if (!name) return c.json({ error: "Name der Familie fehlt oder ist ungültig" }, 400);
  if (contactName === undefined) return c.json({ error: "Kontaktname ist zu lang" }, 400);
  if (contactPhone === undefined) return c.json({ error: "Telefonnummer ist zu lang" }, 400);
  if (contactEmail === undefined) return c.json({ error: "E-Mail ist zu lang" }, 400);

  const family = await db.createFamily(
    c.env.DB,
    {
      name,
      contactName: await encryptField(contactName, c.env.ENCRYPTION_KEY),
      contactPhone: await encryptField(contactPhone, c.env.ENCRYPTION_KEY),
      contactEmail: await encryptField(contactEmail, c.env.ENCRYPTION_KEY),
    },
    c.get("userId"),
    c.get("clubId")
  );
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "family.created",
    targetLabel: name,
  });
  return c.json(await decryptFamily(family, c.env.ENCRYPTION_KEY), 201);
});

app.put("/api/families/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  const contactName = optionalText(body?.contactName, 100);
  const contactPhone = optionalText(body?.contactPhone, 40);
  const contactEmail = optionalText(body?.contactEmail, 254);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!name) return c.json({ error: "Name der Familie fehlt oder ist ungültig" }, 400);
  if (contactName === undefined) return c.json({ error: "Kontaktname ist zu lang" }, 400);
  if (contactPhone === undefined) return c.json({ error: "Telefonnummer ist zu lang" }, 400);
  if (contactEmail === undefined) return c.json({ error: "E-Mail ist zu lang" }, 400);

  const existing = await db.getFamilyRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Familie nicht gefunden" }, 404);
  // Tenant-Grenze zuerst prüfen (Migration 0039, fest gesetztes club_id) -
  // eine fremde Vereins-ID darf niemals als "nicht gefunden" von einer
  // eigenen unterscheidbar sein oder umgekehrt Berechtigungsdetails leaken.
  // Innerhalb des eigenen Vereins bleibt es bei der bisherigen, strengeren
  // Regel (nur die anlegende Person darf bearbeiten).
  const sameClub = existing.club_id !== null && existing.club_id === c.get("clubId");
  if (!sameClub || existing.created_by !== c.get("userId")) {
    return c.json({ error: "Keine Berechtigung für diese Familie" }, 403);
  }

  const family = await db.updateFamily(c.env.DB, id, {
    name,
    contactName: await encryptField(contactName, c.env.ENCRYPTION_KEY),
    contactPhone: await encryptField(contactPhone, c.env.ENCRYPTION_KEY),
    contactEmail: await encryptField(contactEmail, c.env.ENCRYPTION_KEY),
  });
  if (!family) return c.json({ error: "Familie nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "family.updated",
    targetLabel: name,
  });
  return c.json(await decryptFamily(family, c.env.ENCRYPTION_KEY));
});

// --- Audit-Log -----------------------------------------------------------------

// Nutzerentscheidung: Verlauf (auch clubbezogen) ist nur für die Admin-Rolle
// sichtbar, nicht mehr für Jugendleitung/normale Mitglieder.
app.get("/api/audit-log", requireAuth, requireAdmin, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  // Für Filter/Export im Frontend darf mehr als das Standard-Limit
  // angefragt werden, gedeckelt auf 1000, damit niemand die ganze Tabelle
  // auf einmal ziehen kann.
  const requestedLimit = Number(c.req.query("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 100;
  return c.json(
    await db.listAuditLogForClub(
      c.env.DB,
      clubId,
      {
        userId: c.get("userId"),
        isJugendleiter: c.get("clubRole") === "jugendleiter",
      },
      limit
    )
  );
});

// Rohdaten (Zugang/Wechsel/Austritt-Ereignisse) für die Zu-/Abgänge-Tabelle
// in der Mitgliederstatistik - Gruppen-Sichtbarkeitsfilterung übernimmt das
// Frontend wie bei den Bestandszahlen.
app.get("/api/member-events", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listChildLifecycleEventsForClub(c.env.DB, clubId));
});

// --- Vertretungsbörse ---------------------------------------------------------

// Für einen Termin eine Vertretung suchen - andere Vereinsmitglieder sehen
// die Anfrage im Marktplatz und können sie übernehmen.
app.post("/api/substitute-requests", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const groupId = validId(body?.groupId);
  const sessionDate = validDate(body?.date);
  const note = optionalText(body?.note, 200);
  if (!groupId || !sessionDate) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);
  if (note === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!(await db.canWriteGroupAsync(c.env.DB, group, c.get("userId")))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const request = await db.createSubstituteRequest(c.env.DB, {
    groupId,
    sessionDate,
    note,
    requestedBy: c.get("userId"),
  });
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "substitute_request.created",
    targetLabel: `${group.name} am ${sessionDate}`,
    groupId,
  });

  if (group.club_id) {
    const members = await db.listClubMembers(c.env.DB, group.club_id);
    const notification = {
      type: "substitute_request",
      title: `Vertretung gesucht für „${group.name}“`,
      body: `${c.get("name") ?? c.get("email")} sucht für den Termin am ${sessionDate} in „${group.name}“ eine Vertretung.${note ? ` (${note})` : ""}`,
      link: "/vertretungen",
    };
    for (const member of members) {
      if (member.id === c.get("userId")) {
        // Die anfragende Person erhält die vereinsweite In-App-Meldung
        // ebenfalls, aber keine E-Mail über die eigene Aktion.
        await db.createNotification(c.env.DB, { userId: member.id, ...notification });
      } else {
        await notifyUser(c.env, {
          userId: member.id,
          userEmail: member.email,
          userName: member.name,
          ...notification,
        });
      }
    }
  }

  return c.json(request, 201);
});

app.get("/api/substitute-requests/open", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listOpenSubstituteRequestsForClub(c.env.DB, clubId));
});

// Anstehende Vertretungen im Verein (ab heute) - übernommene UND noch offene,
// für Dashboard und Vertretungs-Kalender. status unterscheidet die beiden.
app.get("/api/substitute-requests/upcoming", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  const now = new Date();
  const todayIso = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  return c.json(await db.listUpcomingSubstituteRequestsForClub(c.env.DB, clubId, todayIso));
});

app.get("/api/substitute-requests/mine", requireAuth, async (c) => {
  return c.json(await db.listMySubstituteRequests(c.env.DB, c.get("userId")));
});

// Vereinsweiter Verlauf aller Vertretungs-Anfragen (jeder Status) - nur für
// die Jugendleitung, alle anderen sehen weiterhin nur /mine.
app.get("/api/substitute-requests/club", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || (c.get("clubRole") !== "jugendleiter" && !c.get("isAdmin")))
    return c.json({ error: "Keine Berechtigung" }, 403);
  return c.json(await db.listSubstituteRequestsForClub(c.env.DB, clubId));
});

// Eine offene Vertretungs-Anfrage übernehmen - setzt die Leitung für den
// Termin direkt, damit die Stunde automatisch im eigenen Stundennachweis
// landet, sobald die Anwesenheit erfasst wird.
app.post("/api/substitute-requests/:id/claim", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getSubstituteRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "open") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group || !group.club_id || group.club_id !== c.get("clubId")) {
    return c.json({ error: "Nur Mitglieder desselben Vereins können diese Anfrage übernehmen" }, 403);
  }
  if (request.requested_by === c.get("userId")) return c.json({ error: "Eigene Anfrage kann nicht übernommen werden" }, 400);

  const claimed = await db.claimSubstituteRequest(c.env.DB, id, c.get("userId"));
  if (!claimed) return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  await db.setSessionLeader(c.env.DB, request.group_id, request.session_date, c.get("userId"));

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "substitute_request.claimed",
    targetLabel: `${group.name} am ${request.session_date}`,
    groupId: group.id,
  });

  if (request.requested_by) {
    const requester = await db.getUserById(c.env.DB, request.requested_by);
    if (requester) {
      await notifyUser(c.env, {
        userId: requester.id,
        userEmail: requester.email,
        userName: requester.name,
        type: "substitute_claimed",
        title: `Vertretung übernommen für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} übernimmt den Termin am ${request.session_date} in „${group.name}“.`,
        link: "/vertretungen",
      });
    }
  }

  return c.json({ ok: true });
});

app.post("/api/substitute-requests/:id/cancel", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getSubstituteRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "open") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  const isRequester = request.requested_by === c.get("userId");
  const isLeadership = Boolean(group?.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
  if (!isRequester && !isLeadership) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setSubstituteRequestStatus(c.env.DB, id, "cancelled");
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "substitute_request.cancelled",
    targetLabel: `${group?.name ?? "?"} am ${request.session_date}`,
    groupId: request.group_id,
  });
  return c.json({ ok: true });
});

// Eine bereits übernommene Vertretung wieder zurückgeben - entweder die
// Vertretung selbst ("kann kurzfristig doch nicht mehr") oder die
// ursprüngliche Gruppenleitung ("übernimmt die Stunde kurzfristig doch
// wieder selbst"). Das Schreibrecht für den Termin wandert damit sofort
// zurück zur Gruppenleitung.
app.post("/api/substitute-requests/:id/return", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getSubstituteRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "claimed") return c.json({ error: "Anfrage ist aktuell nicht übernommen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);

  const userId = c.get("userId");
  const isSubstitute = request.claimed_by === userId;
  const isOwner = await db.canWriteGroupAsync(c.env.DB, group, userId);
  const isLeadership = Boolean(group.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
  if (!isSubstitute && !isOwner && !isLeadership) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.returnSubstituteRequest(c.env.DB, id, request.group_id, request.session_date);

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: userId,
    actorName: c.get("name"),
    action: "substitute_request.returned",
    targetLabel: `${group.name} am ${request.session_date}`,
    groupId: group.id,
  });

  // Die jeweils andere Seite benachrichtigen.
  const notifyTargetId = isSubstitute ? group.owner_id : request.claimed_by;
  if (notifyTargetId) {
    const target = await db.getUserById(c.env.DB, notifyTargetId);
    if (target) {
      await notifyUser(c.env, {
        userId: target.id,
        userEmail: target.email,
        userName: target.name,
        type: "substitute_returned",
        title: `Vertretung zurückgegeben für „${group.name}“`,
        body: isSubstitute
          ? `${c.get("name") ?? c.get("email")} kann den Termin am ${request.session_date} in „${group.name}“ doch nicht übernehmen - die Stunde liegt wieder bei dir.`
          : `${c.get("name") ?? c.get("email")} übernimmt den Termin am ${request.session_date} in „${group.name}“ kurzfristig wieder selbst.`,
        link: "/vertretungen",
      });
    }
  }

  return c.json({ ok: true });
});

// Ein Kind in eine andere Gruppe verschieben. Erfüllt es die
// Altersvoraussetzung der Zielgruppe (oder gehört die Zielgruppe dem
// anfragenden Nutzer selbst bzw. ist herrenlos), wird sofort verschoben.
// Andernfalls entsteht eine Verschiebe-Anfrage, die der Turnleiter der
// Zielgruppe erst noch freigeben muss.
app.post("/api/children/:id/move", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const toGroupId = validId(body?.toGroupId);
  if (!id || !toGroupId) return c.json({ error: "Ungültige Anfrage" }, 400);

  const child = await db.getChildRowById(c.env.DB, id);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, child, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);
  if (child.group_id === toGroupId) return c.json({ error: "Kind ist bereits in dieser Gruppe" }, 400);

  const targetGroup = await db.getGroupRowById(c.env.DB, toGroupId);
  if (!targetGroup) return c.json({ error: "Zielgruppe nicht gefunden" }, 404);

  const existingPending = await db.getPendingMoveRequestForChild(c.env.DB, id);
  if (existingPending) return c.json({ error: "Für dieses Kind liegt bereits eine offene Verschiebe-Anfrage vor" }, 409);

  // Ohne Freigabe verschieben darf: wer die Zielgruppe selbst besitzt/mitleitet
  // (oder sie herrenlos ist), sowie die Jugendleitung für jede Gruppe ihres
  // Vereins. Für alle anderen (z.B. eine Turnleitung, die in eine fremde
  // Gruppe verschiebt) ist immer eine Freigabe der Zielgruppen-Leitung nötig -
  // auch wenn das Alter passt, damit die Zielgruppe das mitbekommt und
  // gegebenenfalls widersprechen kann.
  const targetOwnedOrCoLed = await db.canWriteGroupAsync(c.env.DB, targetGroup, c.get("userId"));
  const isLeadershipOfTargetClub = Boolean(
    targetGroup.club_id && targetGroup.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter"
  );

  if (targetOwnedOrCoLed || isLeadershipOfTargetClub) {
    const gate = await capacityGate(c.env.DB, targetGroup, id, {
      userId: c.get("userId"),
      clubId: c.get("clubId"),
      clubRole: c.get("clubRole"),
    });
    if (gate.mode === "self_confirm" && body?.confirmOverCapacity !== true) return c.json(gate.warning, 409);
    if (gate.mode === "leadership_approval") {
      const pending = await fileCapacityRequest(c.env.DB, {
        groupId: toGroupId,
        groupName: targetGroup.name,
        action: "move_child",
        childId: id,
        payload: { toGroupId },
        requestedBy: c.get("userId"),
      });
      if (targetGroup.club_id) {
        await notifyCapacityRequest(c, targetGroup.club_id, targetGroup.name, `${child.first_name} ${child.last_name}`);
      }
      return c.json(pending, 202);
    }
    const previousGroupId = child.group_id;
    const previousGroup = previousGroupId ? await db.getGroupRowById(c.env.DB, previousGroupId) : null;
    await db.moveChildToGroup(c.env.DB, id, toGroupId);
    await db.logAudit(c.env.DB, {
      clubId: c.get("clubId"),
      actorId: c.get("userId"),
      actorName: c.get("name"),
      action: "child.moved",
      targetLabel: `${child.first_name} ${child.last_name} → ${targetGroup.name}`,
      groupId: toGroupId,
      childId: id,
    });
    await notifyClubInApp(c.env, targetGroup.club_id ?? child.club_id, {
      type: "club_child_moved",
      title: "Kind verschoben",
      body: childMovedBody(`${child.first_name} ${child.last_name}`, previousGroup, targetGroup),
      link: "/kinder",
      childId: id,
    });
    if (previousGroupId) {
      await promoteWaitlistIfPossible(c, previousGroupId);
      await notifyClubWaitlistOnFreedCapacity(c, previousGroupId);
    }
    return c.json({ status: "moved", groupId: toGroupId });
  }

  // Wer eine Verschiebe-Anfrage stellt, muss immer begründen, warum -
  // die Zielgruppen-Leitung soll nicht nur ein blankes "wechseln möchte"
  // sehen, sondern eine nachvollziehbare Begründung.
  const moveReason = requiredText(body?.reason, 300);
  if (!moveReason) return c.json({ error: "Eine Begründung für die Verschiebe-Anfrage ist erforderlich" }, 400);

  const request = await db.createMoveRequest(c.env.DB, {
    childId: id,
    fromGroupId: child.group_id,
    toGroupId,
    requestedBy: c.get("userId"),
    reason: moveReason,
  });
  if (targetGroup.owner_id) {
    const owner = await db.getUserById(c.env.DB, targetGroup.owner_id);
    if (owner) {
      const fits = db.ageFitsGroup(child.birth_date, targetGroup);
      const reasonSentence = fits
        ? `möchte in deine Gruppe „${targetGroup.name}“ wechseln`
        : `soll in deine Gruppe „${targetGroup.name}“ wechseln, erfüllt aber die Altersvoraussetzung nicht`;
      await notifyUser(c.env, {
        userId: owner.id,
        userEmail: owner.email,
        userName: owner.name,
        type: "move_request",
        title: `Verschiebe-Anfrage für „${targetGroup.name}“`,
        // Gesundheitsdaten/Notfallkontakte nur im In-App-Postfach (body),
        // nicht per Klartext-E-Mail an ein externes Postfach - siehe
        // PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-01.
        body: `${child.first_name} ${child.last_name} ${reasonSentence} - bitte freigeben oder ablehnen.\n\nBegründung: ${moveReason}\n\n${await childContactSummary(child, c.env.ENCRYPTION_KEY)}`,
        emailBody: `${child.first_name} ${child.last_name} ${reasonSentence} - bitte freigeben oder ablehnen.\n\nBegründung: ${moveReason}\n\nDetails (Notfallkontakt) siehst du nach dem Anmelden in der App.`,
        link: "/gruppen",
        childId: id,
      });
    }
  }
  return c.json({ status: "pending", requestId: request.id }, 202);
});

// --- Verschiebe-Anfragen ---------------------------------------------------

app.get("/api/move-requests/incoming", requireAuth, async (c) => {
  return c.json(await db.listIncomingMoveRequests(c.env.DB, c.get("userId")));
});

app.get("/api/move-requests/outgoing", requireAuth, async (c) => {
  return c.json(await db.listOutgoingMoveRequests(c.env.DB, c.get("userId")));
});

app.post("/api/move-requests/:id/approve", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const body = await c.req.json().catch(() => null);

  const request = await db.getMoveRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const targetGroup = await db.getGroupRowById(c.env.DB, request.to_group_id);
  if (!targetGroup || targetGroup.owner_id !== c.get("userId"))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const gate = await capacityGate(c.env.DB, targetGroup, request.child_id, {
    userId: c.get("userId"),
    clubId: c.get("clubId"),
    clubRole: c.get("clubRole"),
  });
  if (gate.mode === "self_confirm" && body?.confirmOverCapacity !== true) return c.json(gate.warning, 409);
  if (gate.mode === "leadership_approval") {
    const pending = await fileCapacityRequest(c.env.DB, {
      groupId: request.to_group_id,
      groupName: targetGroup.name,
      action: "approve_move_request",
      childId: request.child_id,
      payload: { moveRequestId: request.id },
      requestedBy: c.get("userId"),
    });
    if (targetGroup.club_id) {
      const child = await db.getChildRowById(c.env.DB, request.child_id);
      if (child) await notifyCapacityRequest(c, targetGroup.club_id, targetGroup.name, `${child.first_name} ${child.last_name}`);
    }
    return c.json(pending, 202);
  }

  await db.moveChildToGroup(c.env.DB, request.child_id, request.to_group_id);
  await db.setMoveRequestStatus(c.env.DB, id, "approved", c.get("userId"));
  if (request.from_group_id) {
    await promoteWaitlistIfPossible(c, request.from_group_id);
    await notifyClubWaitlistOnFreedCapacity(c, request.from_group_id);
  }
  const movedChild = await db.getChildRowById(c.env.DB, request.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "move_request.approved",
    targetLabel: movedChild ? `${movedChild.first_name} ${movedChild.last_name} → ${targetGroup.name}` : targetGroup.name,
    groupId: targetGroup.id,
    childId: request.child_id,
  });

  // Alte Gruppenleitung und ursprüngliche Antragsteller*in über den Ausgang
  // informieren - vorher gab es hier gar keine Benachrichtigung.
  const movedChildName = movedChild ? `${movedChild.first_name} ${movedChild.last_name}` : "Ein Kind";
  const fromGroup = request.from_group_id ? await db.getGroupRowById(c.env.DB, request.from_group_id) : null;
  if (fromGroup?.owner_id && fromGroup.owner_id !== c.get("userId")) {
    const oldOwner = await db.getUserById(c.env.DB, fromGroup.owner_id);
    if (oldOwner) {
      await notifyUser(c.env, {
        userId: oldOwner.id,
        userEmail: oldOwner.email,
        userName: oldOwner.name,
        type: "move_request_approved",
        title: `Verschiebe-Anfrage genehmigt: „${targetGroup.name}“`,
        body: `${movedChildName} wurde von „${fromGroup.name}“ in „${targetGroup.name}“ verschoben.`,
        link: "/gruppen",
        childId: request.child_id,
      });
    }
  }
  if (request.requested_by && request.requested_by !== c.get("userId") && request.requested_by !== fromGroup?.owner_id) {
    const requester = await db.getUserById(c.env.DB, request.requested_by);
    if (requester) {
      await notifyUser(c.env, {
        userId: requester.id,
        userEmail: requester.email,
        userName: requester.name,
        type: "move_request_approved",
        title: `Deine Verschiebe-Anfrage wurde genehmigt`,
        body: `${movedChildName} wurde in „${targetGroup.name}“ aufgenommen.`,
        link: "/gruppen",
        childId: request.child_id,
      });
    }
  }
  await notifyClubInApp(c.env, targetGroup.club_id, {
    type: "club_child_moved",
    title: "Kind verschoben",
    body: childMovedBody(movedChildName, fromGroup, targetGroup),
    link: "/kinder",
    childId: request.child_id,
    excludeUserIds: [
      fromGroup?.owner_id !== c.get("userId") ? fromGroup?.owner_id : null,
      request.requested_by !== c.get("userId") && request.requested_by !== fromGroup?.owner_id ? request.requested_by : null,
    ],
  });

  return c.json({ ok: true });
});

app.post("/api/move-requests/:id/reject", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const body = await c.req.json().catch(() => null);
  const rejectReason = requiredText(body?.reason, 300);
  if (!rejectReason) return c.json({ error: "Eine Begründung für die Ablehnung ist erforderlich" }, 400);

  const request = await db.getMoveRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const targetGroup = await db.getGroupRowById(c.env.DB, request.to_group_id);
  if (!targetGroup || targetGroup.owner_id !== c.get("userId"))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.setMoveRequestStatus(c.env.DB, id, "rejected", c.get("userId"), rejectReason);
  const rejectedChild = await db.getChildRowById(c.env.DB, request.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "move_request.rejected",
    targetLabel: rejectedChild ? `${rejectedChild.first_name} ${rejectedChild.last_name} → ${targetGroup.name}` : targetGroup.name,
    groupId: targetGroup.id,
  });

  // Alte Gruppenleitung und ursprüngliche Antragsteller*in über die
  // Ablehnung informieren - vorher gab es hier gar keine Benachrichtigung.
  const rejectedChildName = rejectedChild ? `${rejectedChild.first_name} ${rejectedChild.last_name}` : "Das Kind";
  const fromGroup = request.from_group_id ? await db.getGroupRowById(c.env.DB, request.from_group_id) : null;
  if (fromGroup?.owner_id && fromGroup.owner_id !== c.get("userId")) {
    const oldOwner = await db.getUserById(c.env.DB, fromGroup.owner_id);
    if (oldOwner) {
      await notifyUser(c.env, {
        userId: oldOwner.id,
        userEmail: oldOwner.email,
        userName: oldOwner.name,
        type: "move_request_rejected",
        title: `Verschiebe-Anfrage abgelehnt: „${targetGroup.name}“`,
        body: `${rejectedChildName} bleibt in „${fromGroup.name}“ - der Wechsel nach „${targetGroup.name}“ wurde abgelehnt.\n\nBegründung: ${rejectReason}`,
        link: "/gruppen",
      });
    }
  }
  if (request.requested_by && request.requested_by !== c.get("userId") && request.requested_by !== fromGroup?.owner_id) {
    const requester = await db.getUserById(c.env.DB, request.requested_by);
    if (requester) {
      await notifyUser(c.env, {
        userId: requester.id,
        userEmail: requester.email,
        userName: requester.name,
        type: "move_request_rejected",
        title: `Deine Verschiebe-Anfrage wurde abgelehnt`,
        body: `${rejectedChildName} konnte nicht nach „${targetGroup.name}“ wechseln.\n\nBegründung: ${rejectReason}`,
        link: "/gruppen",
      });
    }
  }

  return c.json({ ok: true });
});

app.delete("/api/move-requests/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getMoveRequestRowById(c.env.DB, id);
  if (!request) return c.body(null, 204);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.requested_by !== c.get("userId")) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setMoveRequestStatus(c.env.DB, id, "cancelled", c.get("userId"));
  const withdrawnChild = await db.getChildRowById(c.env.DB, request.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "move_request.withdrawn",
    targetLabel: withdrawnChild ? `${withdrawnChild.first_name} ${withdrawnChild.last_name}` : request.id,
    groupId: request.to_group_id,
    childId: request.child_id,
  });
  return c.body(null, 204);
});

// --- Kapazitäts-Anfragen ----------------------------------------------------

app.get("/api/capacity-requests/incoming", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || (c.get("clubRole") !== "jugendleiter" && !c.get("isAdmin"))) return c.json([]);
  return c.json(await db.listIncomingCapacityRequests(c.env.DB, clubId));
});

app.get("/api/capacity-requests/outgoing", requireAuth, async (c) => {
  return c.json(await db.listOutgoingCapacityRequests(c.env.DB, c.get("userId")));
});

app.post("/api/capacity-requests/:id/approve", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getCapacityRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group || !group.club_id || group.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Nur die Jugendleitung dieses Vereins kann diese Anfrage freigeben" }, 403);
  }

  // Vorherige Gruppe merken, bevor sie ggf. verlassen wird, um danach deren
  // Warteliste nachrücken zu lassen.
  const previousGroupId = request.child_id ? (await db.getChildRowById(c.env.DB, request.child_id))?.group_id ?? null : null;

  await applyCapacityRequest(c.env, request, c.get("userId"));
  await db.setCapacityRequestStatus(c.env.DB, id, "approved", c.get("userId"));
  if (previousGroupId && previousGroupId !== request.group_id) {
    await promoteWaitlistIfPossible(c, previousGroupId);
    await notifyClubWaitlistOnFreedCapacity(c, previousGroupId);
  }
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "capacity_request.approved",
    targetLabel: `${group.name} (${request.action})`,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

app.post("/api/capacity-requests/:id/reject", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getCapacityRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group || !group.club_id || group.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Nur die Jugendleitung dieses Vereins kann diese Anfrage ablehnen" }, 403);
  }

  await db.setCapacityRequestStatus(c.env.DB, id, "rejected", c.get("userId"));
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "capacity_request.rejected",
    targetLabel: `${group.name} (${request.action})`,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

app.delete("/api/capacity-requests/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getCapacityRequestRowById(c.env.DB, id);
  if (!request) return c.body(null, 204);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.requested_by !== c.get("userId")) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setCapacityRequestStatus(c.env.DB, id, "cancelled", c.get("userId"));
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "capacity_request.withdrawn",
    targetLabel: request.id,
    groupId: request.group_id,
    childId: request.child_id,
  });
  return c.body(null, 204);
});

// --- Warteliste --------------------------------------------------------------

// Ein Kind auf die Warteliste einer (vollen) Gruppe setzen, statt sofort
// hinzuzufügen bzw. eine Kapazitäts-Anfrage zu stellen.
app.post("/api/groups/:id/waitlist", requireAuth, async (c) => {
  const groupId = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const childId = validId(body?.childId);
  if (!groupId || !childId) return c.json({ error: "Ungültige Anfrage" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);

  const child = await db.getChildRowById(c.env.DB, childId);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (await db.hasActiveClubWaitlistEntry(c.env.DB, childId)) {
    return c.json({ error: "Kind steht bereits auf der Vereinswarteliste" }, 409);
  }
  if (!(await isChildWritable(c.env.DB, child, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") })))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const entry = await db.addToWaitlist(c.env.DB, { groupId, childId, requestedBy: c.get("userId") });
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "waitlist.added",
    targetLabel: `${child.first_name} ${child.last_name} → ${group.name}`,
    groupId,
    childId,
  });
  return c.json(entry, 201);
});

app.get("/api/groups/:id/waitlist", requireAuth, async (c) => {
  const groupId = validId(c.req.param("id"));
  if (!groupId) return c.json({ error: "Ungültige ID" }, 400);
  return c.json(await db.listWaitlistForGroup(c.env.DB, groupId));
});

app.get("/api/waitlist/mine", requireAuth, async (c) => {
  return c.json(await db.listWaitlistForUser(c.env.DB, c.get("userId")));
});

app.delete("/api/waitlist/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const entry = await db.getWaitlistEntryById(c.env.DB, id);
  if (!entry) return c.body(null, 204);
  if (entry.status !== "waiting") return c.json({ error: "Eintrag ist nicht mehr aktiv" }, 409);

  const group = await db.getGroupRowById(c.env.DB, entry.group_id);
  const canManage = entry.requested_by === c.get("userId") || (group && (await db.canWriteGroupAsync(c.env.DB, group, c.get("userId"))));
  if (!canManage) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setWaitlistEntryStatus(c.env.DB, id, "cancelled");
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "waitlist.removed",
    targetLabel: entry.id,
    groupId: entry.group_id,
    childId: entry.child_id,
  });
  return c.body(null, 204);
});

// --- Vereinswarteliste / Platzvorschläge ----------------------------------------

// Getrennt von der Gruppen-Warteliste oben: Kinder ohne Gruppe landen hier,
// vereinsweit sichtbar. Die Jugendleitung kann von hier aus eine Gruppe
// vorschlagen; die Gruppenleitung muss das aktiv bestätigen (siehe unten).
app.post("/api/club-waitlist", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein zugeordnet" }, 400);
  const body = await c.req.json().catch(() => null);
  const childId = validId(body?.childId);
  const note = optionalText(body?.note, 200);
  if (!childId) return c.json({ error: "Ungültiges Kind" }, 400);
  if (note === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  const child = await db.getChildRowById(c.env.DB, childId);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (child.group_id !== null) return c.json({ error: "Kind ist bereits einer Gruppe zugeordnet" }, 409);
  if (await db.hasActiveGroupWaitlistEntry(c.env.DB, childId)) {
    return c.json({ error: "Kind steht bereits auf der Warteliste einer Gruppe" }, 409);
  }
  const allowed = await isChildWritable(c.env.DB, child, c.get("userId"), { clubId: c.get("clubId"), clubRole: c.get("clubRole") });
  if (!allowed) return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  let entry;
  try {
    entry = await db.addToClubWaitlist(c.env.DB, { clubId, childId, note, addedBy: c.get("userId") });
  } catch {
    // Unique-Index verhindert doppelte "waiting"-Einträge - z.B. wenn ein
    // Turnleiter ohne Sicht auf die Gesamtliste (s.u.) versehentlich ein
    // schon angemeldetes Kind erneut einträgt.
    return c.json({ error: "Kind steht bereits auf der Warteliste" }, 409);
  }
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "club_waitlist.added",
    targetLabel: `${child.first_name} ${child.last_name}`,
    childId,
  });

  // Die Jugendleitung hat die konsolidierte Sicht auf die Warteliste -
  // deshalb sofort per E-Mail/In-App informieren, sobald jemand ein Kind
  // anmeldet, statt dass sie es erst beim nächsten Blick in die App merkt.
  const leaders = (await db.listClubMembers(c.env.DB, clubId)).filter(
    (m) => m.role === "jugendleiter" && m.id !== c.get("userId")
  );
  for (const leader of leaders) {
    await notifyUser(c.env, {
      userId: leader.id,
      userEmail: leader.email,
      userName: leader.name,
      type: "club_waitlist_added",
      title: "Neue Anfrage auf der Warteliste",
      body: `${c.get("name") ?? c.get("email")} hat ${child.first_name} ${child.last_name} zur Warteliste hinzugefügt.${note ? ` (${note})` : ""}`,
      link: "/warteliste",
    });
  }

  return c.json(entry, 201);
});

app.get("/api/club-waitlist/candidates", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listClubWaitlistCandidates(c.env.DB, clubId));
});

// Vereinsweite Sicht auf die Warteliste - für alle Vereinsmitglieder
// sichtbar, damit Gruppenleitungen selbst anfragen können, ein wartendes
// Kind in die eigene Gruppe zu übernehmen (siehe .../request unten).
app.get("/api/club-waitlist", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  const entries = await db.listClubWaitlist(c.env.DB, clubId);
  if (c.get("clubRole") === "jugendleiter" || c.get("isAdmin")) return c.json(entries);

  // Turnleiter*innen sehen nur Kinder, die altersmäßig zu einer eigenen
  // Gruppe passen würden (damit sich eine Übernahme-Anfrage überhaupt lohnt),
  // und ohne den Namen der anmeldenden Person - die volle Liste bleibt der
  // Jugendleitung vorbehalten.
  const myGroups = (await db.listGroupsForUser(c.env.DB, c.get("userId"), clubId, c.get("clubRole"))).filter(
    (g) => g.canEdit
  );
  if (myGroups.length === 0) return c.json([]);

  const filtered: typeof entries = [];
  for (const entry of entries) {
    const child = await db.getChildRowById(c.env.DB, entry.childId);
    if (!child) continue;
    const fitsAny = myGroups.some((g) => db.ageFitsGroup(child.birth_date, { min_age: g.minAge, max_age: g.maxAge }));
    if (!fitsAny) continue;
    filtered.push({ ...entry, addedByName: null });
  }
  return c.json(filtered);
});

app.post("/api/club-waitlist/:id/cancel", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const entry = await db.getClubWaitlistEntryById(c.env.DB, id);
  if (!entry) return c.body(null, 204);
  if (entry.status !== "waiting") return c.json({ error: "Eintrag ist nicht mehr aktiv" }, 409);
  const allowed = entry.added_by === c.get("userId") || c.get("clubRole") === "jugendleiter";
  if (!allowed) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setClubWaitlistStatus(c.env.DB, id, "cancelled");
  const cancelledChild = await db.getChildRowById(c.env.DB, entry.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "club_waitlist.cancelled",
    targetLabel: cancelledChild ? `${cancelledChild.first_name} ${cancelledChild.last_name}` : entry.id,
    childId: entry.child_id,
  });
  return c.body(null, 204);
});

// Die Jugendleitung schlägt für ein wartendes Kind eine konkrete Gruppe vor
// ("nach Rücksprache mit dem Turntrainer") - verschiebt das Kind aber noch
// nicht, das passiert erst mit der Bestätigung der Gruppenleitung.
app.post("/api/club-waitlist/:id/propose", requireAuth, async (c) => {
  if (c.get("clubRole") !== "jugendleiter") return c.json({ error: "Nur die Jugendleitung kann eine Gruppe vorschlagen" }, 403);
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const groupId = validId(body?.groupId);
  if (!id || !groupId) return c.json({ error: "Ungültige Anfrage" }, 400);

  const entry = await db.getClubWaitlistEntryById(c.env.DB, id);
  if (!entry) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  if (entry.status !== "waiting") return c.json({ error: "Eintrag ist nicht mehr aktiv" }, 409);
  if (entry.club_id !== c.get("clubId")) return c.json({ error: "Keine Berechtigung" }, 403);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (group.club_id !== c.get("clubId")) return c.json({ error: "Gruppe gehört nicht zu deinem Verein" }, 403);

  let request;
  try {
    request = await db.createPlacementRequest(c.env.DB, { waitlistEntryId: id, groupId, proposedBy: c.get("userId") });
  } catch {
    return c.json({ error: "Für dieses Kind läuft bereits ein Vorschlag" }, 409);
  }
  const proposedChild = await db.getChildRowById(c.env.DB, entry.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "placement_request.proposed",
    targetLabel: `${proposedChild ? `${proposedChild.first_name} ${proposedChild.last_name}` : "?"} → ${group.name}`,
    groupId,
    childId: entry.child_id,
  });

  if (group.owner_id) {
    const owner = await db.getUserById(c.env.DB, group.owner_id);
    const child = proposedChild;
    if (owner && child) {
      await notifyUser(c.env, {
        userId: owner.id,
        userEmail: owner.email,
        userName: owner.name,
        type: "placement_proposed",
        title: `Platzvorschlag für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} schlägt ${child.first_name} ${child.last_name} für deine Gruppe „${group.name}“ vor - bitte bestätige oder lehne ab.`,
        link: "/warteliste",
      });
    }
  }

  return c.json(request, 201);
});

// Eine Gruppenleitung (oder Mit-Trainer*in) fragt selbst an, ein wartendes
// Kind in die eigene Gruppe zu übernehmen - anders als bei .../propose
// entscheidet hier immer die Jugendleitung, unabhängig von freier Kapazität
// (siehe .../confirm und .../decline unten).
app.post("/api/club-waitlist/:id/request", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const groupId = validId(body?.groupId);
  const reason = requiredText(body?.reason, 300);
  if (!id || !groupId) return c.json({ error: "Ungültige Anfrage" }, 400);
  if (!reason) return c.json({ error: "Eine Begründung für die Übernahme-Anfrage ist erforderlich" }, 400);

  const entry = await db.getClubWaitlistEntryById(c.env.DB, id);
  if (!entry) return c.json({ error: "Eintrag nicht gefunden" }, 404);
  if (entry.status !== "waiting") return c.json({ error: "Eintrag ist nicht mehr aktiv" }, 409);
  if (entry.club_id !== c.get("clubId")) return c.json({ error: "Keine Berechtigung" }, 403);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!(await db.canWriteGroupAsync(c.env.DB, group, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  let request;
  try {
    request = await db.createPlacementRequest(c.env.DB, {
      waitlistEntryId: id,
      groupId,
      proposedBy: c.get("userId"),
      reason,
      initiatedByOwner: true,
    });
  } catch {
    return c.json({ error: "Für dieses Kind läuft bereits ein Vorschlag" }, 409);
  }
  const requestedChild = await db.getChildRowById(c.env.DB, entry.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "placement_request.requested",
    targetLabel: `${requestedChild ? `${requestedChild.first_name} ${requestedChild.last_name}` : "?"} → ${group.name}`,
    groupId,
    childId: entry.child_id,
  });

  if (group.club_id) {
    const child = requestedChild;
    const leaders = (await db.listClubMembers(c.env.DB, group.club_id)).filter((m) => m.role === "jugendleiter");
    for (const leader of leaders) {
      await notifyUser(c.env, {
        userId: leader.id,
        userEmail: leader.email,
        userName: leader.name,
        type: "placement_requested",
        title: `Übernahme-Anfrage für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} möchte ${child ? `${child.first_name} ${child.last_name}` : "ein Kind"} in die Gruppe „${group.name}“ übernehmen${
          reason ? ` - Begründung: ${reason}` : ""
        } - bitte freigeben oder ablehnen.`,
        link: "/warteliste",
      });
    }
  }

  return c.json(request, 201);
});

app.get("/api/placement-requests/incoming", requireAuth, async (c) => {
  const own = await db.listPendingPlacementRequestsForOwner(c.env.DB, c.get("userId"));
  const clubId = c.get("clubId");
  if (clubId && c.get("clubRole") === "jugendleiter") {
    const forClub = await db.listPendingPlacementRequestsForClub(c.env.DB, clubId);
    const seenIds = new Set(own.map((r) => r.id));
    return c.json([...own, ...forClub.filter((r) => !seenIds.has(r.id))]);
  }
  return c.json(own);
});

// Die Gruppenleitung bestätigt den Vorschlag - erst jetzt wird das Kind
// tatsächlich in die Gruppe verschoben. Bei Kapazitätsüberschreitung wie bei
// den übrigen Kind-Aktionen: Selbstbestätigung per confirmOverCapacity.
app.post("/api/placement-requests/:id/confirm", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const body = await c.req.json().catch(() => null);

  const request = await db.getPlacementRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Vorschlag nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Vorschlag ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);

  // Eigene Übernahme-Anfrage (initiated_by_owner): das bestätigt immer die
  // Jugendleitung, nicht die Gruppenleitung selbst (die hat ja angefragt).
  const isOwnerInitiated = request.initiated_by_owner === 1;
  if (isOwnerInitiated) {
    const isLeadership = Boolean(group.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
    if (!isLeadership) return c.json({ error: "Nur die Jugendleitung kann das freigeben" }, 403);
  } else if (!(await db.canWriteGroupAsync(c.env.DB, group, c.get("userId")))) {
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  }

  const entry = await db.getClubWaitlistEntryById(c.env.DB, request.waitlist_entry_id);
  if (!entry) return c.json({ error: "Warteliste-Eintrag nicht gefunden" }, 404);
  const child = await db.getChildRowById(c.env.DB, entry.child_id);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);

  // Bei einer eigenen Übernahme-Anfrage entscheidet die Jugendleitung
  // ohnehin abschließend - kein zusätzlicher Kapazitäts-Warnhinweis nötig,
  // egal ob die Gruppe voll wäre.
  if (!isOwnerInitiated) {
    const warning = await capacityWarning(c.env.DB, group, undefined);
    if (warning && body?.confirmOverCapacity !== true) return c.json(warning, 409);
  }

  const previousGroup = child.group_id ? await db.getGroupRowById(c.env.DB, child.group_id) : null;
  await db.moveChildToGroup(c.env.DB, entry.child_id, request.group_id);
  await db.setPlacementRequestStatus(c.env.DB, id, "confirmed");
  await db.setClubWaitlistStatus(c.env.DB, entry.id, "placed");

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "placement_request.confirmed",
    targetLabel: `${child.first_name} ${child.last_name} → ${group.name}`,
    groupId: group.id,
    childId: child.id,
  });

  if (request.proposed_by) {
    const proposer = await db.getUserById(c.env.DB, request.proposed_by);
    if (proposer) {
      await notifyUser(c.env, {
        userId: proposer.id,
        userEmail: proposer.email,
        userName: proposer.name,
        type: "placement_confirmed",
        title: `Platzvorschlag bestätigt für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} hat ${child.first_name} ${child.last_name} in „${group.name}“ aufgenommen.`,
        link: "/warteliste",
        childId: child.id,
      });
    }
  }

  // Neue Gruppenleitung informieren, falls sie nicht selbst bestätigt hat
  // (z.B. Bestätigung durch Mit-Trainer*in oder Jugendleitung) - vorher gab
  // es hier keine Benachrichtigung an die eigentliche Gruppenleitung.
  if (group.owner_id && group.owner_id !== c.get("userId") && group.owner_id !== request.proposed_by) {
    const newOwner = await db.getUserById(c.env.DB, group.owner_id);
    if (newOwner) {
      await notifyUser(c.env, {
        userId: newOwner.id,
        userEmail: newOwner.email,
        userName: newOwner.name,
        type: "placement_confirmed",
        title: `Neues Kind in deiner Gruppe „${group.name}“`,
        // Gesundheitsdaten/Notfallkontakte nur im In-App-Postfach (body),
        // nicht per Klartext-E-Mail an ein externes Postfach - siehe
        // PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-01.
        body: `${child.first_name} ${child.last_name} wurde in deine Gruppe „${group.name}“ aufgenommen.\n\n${await childContactSummary(child, c.env.ENCRYPTION_KEY)}`,
        emailBody: `${child.first_name} ${child.last_name} wurde in deine Gruppe „${group.name}“ aufgenommen. Details (Notfallkontakt) siehst du nach dem Anmelden in der App.`,
        link: "/gruppen",
        childId: child.id,
      });
    }
  }
  await notifyClubInApp(c.env, group.club_id, {
    type: "club_child_moved",
    title: "Kind verschoben",
    body: childMovedBody(`${child.first_name} ${child.last_name}`, previousGroup, group),
    link: "/kinder",
    childId: child.id,
    excludeUserIds: [
      request.proposed_by,
      group.owner_id !== c.get("userId") && group.owner_id !== request.proposed_by ? group.owner_id : null,
    ],
  });

  return c.json({ ok: true });
});

app.post("/api/placement-requests/:id/decline", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const body = await c.req.json().catch(() => null);
  const declineReason = requiredText(body?.reason, 300);
  if (!declineReason) return c.json({ error: "Eine Begründung für die Ablehnung ist erforderlich" }, 400);

  const request = await db.getPlacementRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Vorschlag nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Vorschlag ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);

  const isOwnerInitiated = request.initiated_by_owner === 1;
  if (isOwnerInitiated) {
    const isLeadership = Boolean(group.club_id && group.club_id === c.get("clubId") && c.get("clubRole") === "jugendleiter");
    if (!isLeadership) return c.json({ error: "Nur die Jugendleitung kann das ablehnen" }, 403);
  } else if (!(await db.canWriteGroupAsync(c.env.DB, group, c.get("userId")))) {
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  }

  await db.setPlacementRequestStatus(c.env.DB, id, "declined", declineReason);

  const entryForAudit = await db.getClubWaitlistEntryById(c.env.DB, request.waitlist_entry_id);
  const childForAudit = entryForAudit ? await db.getChildRowById(c.env.DB, entryForAudit.child_id) : null;
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "placement_request.declined",
    targetLabel: `${childForAudit ? `${childForAudit.first_name} ${childForAudit.last_name}` : "?"} → ${group.name}`,
    groupId: group.id,
    childId: entryForAudit?.child_id ?? null,
  });

  if (request.proposed_by) {
    const proposer = await db.getUserById(c.env.DB, request.proposed_by);
    const child = childForAudit;
    if (proposer && child) {
      await notifyUser(c.env, {
        userId: proposer.id,
        userEmail: proposer.email,
        userName: proposer.name,
        type: "placement_declined",
        title: `${isOwnerInitiated ? "Übernahme-Anfrage" : "Platzvorschlag"} abgelehnt für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} kann ${child.first_name} ${child.last_name} aktuell nicht in „${group.name}“ aufnehmen.${
          declineReason ? `\n\nBegründung: ${declineReason}` : ""
        }`,
        link: "/warteliste",
      });
    }
  }

  return c.json({ ok: true });
});

// --- Benachrichtigungen -------------------------------------------------------

app.get("/api/notifications", requireAuth, async (c) => {
  return c.json(await db.listNotificationsForUser(c.env.DB, c.get("userId")));
});

app.post("/api/notifications/:id/read", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  await db.markNotificationRead(c.env.DB, id, c.get("userId"));
  return c.json({ ok: true });
});

app.post("/api/notifications/read-all", requireAuth, async (c) => {
  await db.markAllNotificationsRead(c.env.DB, c.get("userId"));
  return c.json({ ok: true });
});

// --- Anwesenheits-Trends -------------------------------------------------------

// Letztes Anwesenheitsdatum je (sichtbarem) Kind, für "seit X Wochen nicht
// da"-Hinweise auf der Kinder-Seite.
app.get("/api/children/attendance-summary", requireAuth, async (c) => {
  const children = await db.listChildrenForUser(c.env.DB, c.get("userId"), c.get("clubId"));
  const childIds = children.map((child) => child.id);
  const lastDates = await db.getLastPresentDates(c.env.DB, childIds);
  const today = new Date();
  const summary = childIds.map((childId) => {
    const lastPresentDate = lastDates[childId] ?? null;
    let weeksSinceLastPresent: number | null = null;
    if (lastPresentDate) {
      const diffMs = today.getTime() - new Date(`${lastPresentDate}T00:00:00Z`).getTime();
      weeksSinceLastPresent = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
    }
    return { childId, lastPresentDate, weeksSinceLastPresent };
  });
  return c.json(summary);
});

// --- Export ------------------------------------------------------------------

// Aufbauzeit vor dem eigentlichen Trainingsbeginn - zählt bei der
// Stundenerfassung mit dazu (z.B. Training 16:30-17:30 → angerechnet wird
// 16:00-17:30). Gilt einheitlich für den CSV-Export und den amtlichen
// Stundennachweis, da beide derselben Übungsleiterpauschale/dem Zuschuss-
// nachweis dienen.
const SETUP_MINUTES = 30;

function subtractMinutes(time: string | null, minutes: number): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  let total = h * 60 + m - minutes;
  if (total < 0) total += 24 * 60;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function effectiveStartTime(startTime: string | null): string | null {
  return subtractMinutes(startTime, SETUP_MINUTES);
}

function formatDuration(startTime: string | null, endTime: string | null): string {
  if (!startTime || !endTime) return "";
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}min` : `${rest}min`;
}

function csvCell(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// CSV-Export der geleisteten Turnstunden im Zeitraum - Basis für den
// Zuschussnachweis/die Übungsleiterpauschale. `scope=club` zeigt der
// Jugendleitung alle Gruppen des Vereins, sonst nur die eigenen.
app.get("/api/export/hours", requireAuth, async (c) => {
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  const scope = c.req.query("scope") === "club" ? "club" : "own";
  if (!from || !to) return c.json({ error: "Ungültiger Zeitraum" }, 400);

  const clubId = c.get("clubId");
  const allGroups = await db.listGroupsForUser(c.env.DB, c.get("userId"), clubId);
  const groupIds =
    scope === "club" && clubId && (c.get("clubRole") === "jugendleiter" || c.get("isAdmin"))
      ? allGroups.filter((g) => g.clubId === clubId).map((g) => g.id)
      : allGroups.filter((g) => g.ownerId === c.get("userId")).map((g) => g.id);

  const rows = await db.listSessionsForExport(c.env.DB, groupIds, from, to);

  const header = ["Datum", "Wochentag", "Gruppe", "Uhrzeit", "Dauer", "Übungsleiter*in", "Anwesende Kinder"];
  const lines = [header.map(csvCell).join(";")];
  for (const row of rows) {
    const start = effectiveStartTime(row.startTime);
    lines.push(
      [
        row.sessionDate,
        row.weekday !== null ? WEEKDAY_NAMES[row.weekday] : "",
        row.groupName,
        start && row.endTime ? `${start}–${row.endTime}` : "",
        formatDuration(start, row.endTime),
        row.ledByName ?? "",
        String(row.presentCount),
      ]
        .map(csvCell)
        .join(";")
    );
  }
  const csv = "﻿" + lines.join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stunden_${from}_bis_${to}.csv"`,
    },
  });
});

const MONTH_NAMES = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

function hoursBetween(startTime: string | null, endTime: string | null): number | null {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return null;
  return Math.round((minutes / 60) * 100) / 100;
}

// Daten für den amtlichen Stundennachweis (Vorlage: Landessportbund) eines
// Quartals - nur die eigenen Gruppen und nur Termine, die die anfragende
// Person selbst geleitet hat (Termine ohne eingetragene Leitung werden ihr
// zugerechnet, wenn sie die Gruppe besitzt).
app.get("/api/hours-report", requireAuth, async (c) => {
  const year = Number(c.req.query("year"));
  const quarter = Number(c.req.query("quarter"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: "Ungültiges Jahr" }, 400);
  // 0 = ganzes Jahr statt nur eines Quartals.
  if (!Number.isInteger(quarter) || quarter < 0 || quarter > 4) return c.json({ error: "Ungültiges Quartal" }, 400);

  const startMonth = quarter === 0 ? 1 : (quarter - 1) * 3 + 1;
  const endMonth = quarter === 0 ? 12 : startMonth + 2;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const clubId = c.get("clubId");
  const allGroups = await db.listGroupsForUser(c.env.DB, c.get("userId"), clubId);
  // Alle sichtbaren Gruppen durchsuchen, nicht nur die eigenen: eine
  // Vertretung in einer fremden Gruppe (led_by = ich, aber die Gruppe
  // gehört jemand anderem) muss trotzdem im eigenen Stundennachweis
  // auftauchen. Die led_by-Filterung in listSessionsForExport sorgt dafür,
  // dass nur tatsächlich selbst geleitete Termine gezählt werden.
  const groupIds = allGroups.map((g) => g.id);
  const rows = await db.listSessionsForExport(c.env.DB, groupIds, from, to, c.get("userId"));

  const monthNumbers = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => startMonth + i);
  const months = monthNumbers.map((month) => {
    const monthStr = String(month).padStart(2, "0");
    const sessions = rows
      .filter((r) => r.sessionDate.slice(5, 7) === monthStr)
      .map((r) => {
        const einsatzort = r.note ?? (r.location ? `Training ${r.location}` : "Training");
        const start = effectiveStartTime(r.startTime);
        return {
          day: Number(r.sessionDate.slice(8, 10)),
          date: r.sessionDate,
          startTime: start,
          endTime: r.endTime,
          hours: hoursBetween(start, r.endTime),
          location: einsatzort,
        };
      });
    const totalHours = Math.round(sessions.reduce((sum, s) => sum + (s.hours ?? 0), 0) * 100) / 100;
    return { month, monthName: MONTH_NAMES[month - 1], sessions, totalHours };
  });

  const club = clubId ? await db.getClubById(c.env.DB, clubId) : null;

  return c.json({
    year,
    quarter,
    clubName: club?.name ?? null,
    clubNumber: club?.clubNumber ?? null,
    userName: c.get("name"),
    months,
  });
});

// Gesamtübersicht "wie viele Stunden habe ich insgesamt schon geleitet" -
// gruppen- und quartalsübergreifend, mit Aufschlüsselung eigene Stunden vs.
// als Vertretung übernommene, sowie eine Jahres-Aufschlüsselung.
app.get("/api/hours-summary", requireAuth, async (c) => {
  const rows = await db.listAllLedSessionsForUser(c.env.DB, c.get("userId"));

  const byYear = new Map<number, { year: number; ownHours: number; substituteHours: number; sessionCount: number }>();
  let ownHours = 0;
  let substituteHours = 0;

  for (const row of rows) {
    const start = effectiveStartTime(row.startTime);
    const hours = hoursBetween(start, row.endTime);
    if (hours === null) continue;
    const year = Number(row.sessionDate.slice(0, 4));
    if (!byYear.has(year)) byYear.set(year, { year, ownHours: 0, substituteHours: 0, sessionCount: 0 });
    const bucket = byYear.get(year)!;
    bucket.sessionCount += 1;
    if (row.isSubstitute) {
      substituteHours += hours;
      bucket.substituteHours += hours;
    } else {
      ownHours += hours;
      bucket.ownHours += hours;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return c.json({
    ownHours: round2(ownHours),
    substituteHours: round2(substituteHours),
    totalHours: round2(ownHours + substituteHours),
    sessionCount: rows.length,
    byYear: [...byYear.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({ ...y, ownHours: round2(y.ownHours), substituteHours: round2(y.substituteHours), totalHours: round2(y.ownHours + y.substituteHours) })),
  });
});

// --- Eingereichte Stundennachweise (digital unterschrieben, PDF in R2) -----

function hoursReportPeriodBounds(year: number, quarter: number): { from: string; to: string } {
  const startMonth = quarter === 0 ? 1 : (quarter - 1) * 3 + 1;
  const endMonth = quarter === 0 ? 12 : startMonth + 2;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const to = `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

// Gesamtstunden serverseitig neu berechnen - identisch zu GET /api/hours-report,
// damit die Abrechnung nicht der vom Client hochgeladenen Zahl vertrauen muss.
async function computeSubmittedHoursTotal(
  dbEnv: D1Database,
  userId: string,
  clubId: string | null,
  year: number,
  quarter: number
): Promise<number> {
  const { from, to } = hoursReportPeriodBounds(year, quarter);
  const allGroups = await db.listGroupsForUser(dbEnv, userId, clubId);
  const rows = await db.listSessionsForExport(dbEnv, allGroups.map((g) => g.id), from, to, userId);
  let total = 0;
  for (const r of rows) {
    const h = hoursBetween(effectiveStartTime(r.startTime), r.endTime);
    if (h !== null) total += h;
  }
  return Math.round(total * 100) / 100;
}

function hoursReportStorageKey(clubId: string, userId: string, year: number, quarter: number): string {
  const period = quarter === 0 ? `${year}-ganzes-jahr` : `${year}-Q${quarter}`;
  return `${clubId}/${userId}/${period}.pdf`;
}

// Euro-Eingabe (Zahl oder "12,50") -> Cent. null = leer, undefined = ungültig.
function parseOptionalEuroCents(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return undefined;
  return Math.round(n * 100);
}

// Nachweis einreichen bzw. erneut einreichen. Body = PDF-Bytes.
app.put("/api/hours-report/submissions", requireAuth, async (c) => {
  const bucket = c.env.HOURS_REPORTS;
  if (!bucket) return c.json({ error: "Dokumentenspeicher ist nicht konfiguriert" }, 503);

  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Kein Verein ausgewählt" }, 400);

  const year = Number(c.req.query("year"));
  const quarter = Number(c.req.query("quarter"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return c.json({ error: "Ungültiges Jahr" }, 400);
  if (!Number.isInteger(quarter) || quarter < 0 || quarter > 4) return c.json({ error: "Ungültiges Quartal" }, 400);

  const existing = await db.getHoursSubmissionForPeriod(c.env.DB, clubId, c.get("userId"), year, quarter);
  if (existing && existing.status === "settled") {
    return c.json({ error: "Dieser Nachweis wurde bereits abgerechnet und ist gesperrt" }, 409);
  }

  if (!(c.req.header("content-type") ?? "").includes("application/pdf")) {
    return c.json({ error: "Es wird ein PDF erwartet" }, 415);
  }
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "Leeres Dokument" }, 400);
  if (body.byteLength > 10 * 1024 * 1024) return c.json({ error: "Dokument ist zu groß (max. 10 MB)" }, 413);

  const totalHours = await computeSubmittedHoursTotal(c.env.DB, c.get("userId"), clubId, year, quarter);
  const storageKey = hoursReportStorageKey(clubId, c.get("userId"), year, quarter);
  await bucket.put(storageKey, body, { httpMetadata: { contentType: "application/pdf" } });

  await db.upsertHoursSubmission(c.env.DB, {
    clubId,
    userId: c.get("userId"),
    year,
    quarter,
    totalHours,
    storageKey,
    signedByName: c.get("name") ?? null,
  });
  await db.logAudit(c.env.DB, {
    clubId,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: existing ? "hours_report.resubmitted" : "hours_report.submitted",
    targetLabel: `${year}${quarter === 0 ? " (ganzes Jahr)" : ` Q${quarter}`}`,
  });
  return c.json({ ok: true });
});

// Eigene eingereichte Nachweise (alle Zeiträume).
app.get("/api/hours-report/submissions/mine", requireAuth, async (c) => {
  return c.json(await db.listHoursSubmissionsForUser(c.env.DB, c.get("userId")));
});

// Alle eingereichten Nachweise des Vereins - nur Jugendleitung (lesend) und
// Kassenwart:in (lesend + abrechnen).
app.get("/api/hours-report/submissions", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  // Lesen: Jugendleitung, Kassenwart:in, Plattform-Admin. Abrechnen bleibt der
  // Kassenwart:in vorbehalten (siehe /settle).
  if (!clubId || (c.get("clubRole") !== "jugendleiter" && !c.get("isKassenwart") && !c.get("isAdmin"))) {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }
  return c.json(await db.listHoursSubmissionsForClub(c.env.DB, clubId));
});

// Das eingereichte PDF ausliefern. Zugriff: Eigentümer:in, oder Jugendleitung /
// Kassenwart:in desselben Vereins.
app.get("/api/hours-report/submissions/:id/pdf", requireAuth, async (c) => {
  const bucket = c.env.HOURS_REPORTS;
  if (!bucket) return c.json({ error: "Dokumentenspeicher ist nicht konfiguriert" }, 503);

  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const row = await db.getHoursSubmissionRowById(c.env.DB, id);
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);

  const sameClub = row.club_id === c.get("clubId");
  const allowed =
    row.user_id === c.get("userId") ||
    c.get("isAdmin") ||
    (sameClub && (c.get("clubRole") === "jugendleiter" || c.get("isKassenwart")));
  if (!allowed) return c.json({ error: "Keine Berechtigung" }, 403);

  const obj = await bucket.get(row.storage_key);
  if (!obj) return c.json({ error: "Dokument nicht im Speicher gefunden" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="stundennachweis_${row.year}${row.quarter === 0 ? "" : `_Q${row.quarter}`}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});

// Einen eingereichten Nachweis abrechnen - ausschließlich Kassenwart:in.
app.post("/api/hours-report/submissions/:id/settle", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!c.get("isKassenwart")) {
    return c.json({ error: "Nur die Kassenwart:in kann Stundennachweise abrechnen" }, 403);
  }

  const row = await db.getHoursSubmissionRowById(c.env.DB, id);
  if (!row) return c.json({ error: "Nicht gefunden" }, 404);
  if (row.club_id !== c.get("clubId")) return c.json({ error: "Keine Berechtigung" }, 403);
  // Vier-Augen-Prinzip: den eigenen Nachweis nicht selbst abrechnen.
  if (row.user_id === c.get("userId")) {
    return c.json({ error: "Den eigenen Stundennachweis kannst du nicht selbst abrechnen" }, 403);
  }
  if (row.status === "settled") return c.json({ error: "Dieser Nachweis wurde bereits abgerechnet" }, 409);

  const body = await c.req.json().catch(() => null);
  const amountCents = parseOptionalEuroCents(body?.amountEuro);
  const rateCents = parseOptionalEuroCents(body?.rateEuro);
  if (amountCents === undefined) return c.json({ error: "Betrag ist ungültig" }, 400);
  if (rateCents === undefined) return c.json({ error: "Stundensatz ist ungültig" }, 400);
  const note = optionalText(body?.note, 500);
  if (note === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  await db.settleHoursSubmission(c.env.DB, id, {
    settledBy: c.get("userId"),
    amountCents,
    rateCents,
    note,
  });
  await db.logAudit(c.env.DB, {
    clubId: row.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "hours_report.settled",
    targetLabel: `${row.year}${row.quarter === 0 ? " (ganzes Jahr)" : ` Q${row.quarter}`}`,
  });
  return c.json({ ok: true });
});

// --- Anwesenheit -----------------------------------------------------------

// Anwesenheit ist – anders als Gruppen/Kinder – nicht vereinsweit lesbar:
// nur der Besitzer der Gruppe (bzw. bei herrenlosen Alt-Gruppen weiterhin
// jeder) darf sie sehen oder erfassen. Ausnahme: die Jugendleitung sieht die
// Anwesenheit aller Gruppen ihres Vereins (Anwesenheitsübersicht "Alle
// Gruppen").
async function canReadAttendance(
  dbEnv: D1Database,
  group: { id: string; owner_id: string | null; club_id: string | null },
  requester: { userId: string; clubId: string | null; clubRole: ClubRole; isAdmin?: boolean }
): Promise<boolean> {
  const isLeadership = Boolean(
    group.club_id && group.club_id === requester.clubId && (requester.clubRole === "jugendleiter" || requester.isAdmin)
  );
  return isLeadership || (await db.canWriteGroupAsync(dbEnv, group, requester.userId));
}

app.get("/api/attendance-stats", requireAuth, async (c) => {
  const daysRaw = c.req.query("days");
  let fromDate: string | undefined;
  let toDate: string | undefined;
  if (daysRaw !== undefined) {
    const days = Number(daysRaw);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return c.json({ error: "Ungültiger Auswertungszeitraum" }, 400);
    }
    const today = new Date();
    const firstDay = new Date(today);
    firstDay.setUTCDate(firstDay.getUTCDate() - (days - 1));
    fromDate = firstDay.toISOString().slice(0, 10);
    toDate = today.toISOString().slice(0, 10);
  }
  const stats = await db.getAttendanceStats(c.env.DB, c.get("userId"), c.get("clubId"), fromDate, toDate);
  return c.json(stats);
});

app.get("/api/attendance-range/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const requester = { userId: c.get("userId"), clubId: c.get("clubId"), clubRole: c.get("clubRole"), isAdmin: c.get("isAdmin") };
  if (!(await canReadAttendance(c.env.DB, group, requester))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.getAttendanceRange(c.env.DB, groupId, from, to));
});

app.get("/api/attendance-leaders/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const requester = { userId: c.get("userId"), clubId: c.get("clubId"), clubRole: c.get("clubRole"), isAdmin: c.get("isAdmin") };
  if (!(await canReadAttendance(c.env.DB, group, requester))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.getSessionLeaders(c.env.DB, groupId, from, to));
});

app.get("/api/attendance-cancellations/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const requester = { userId: c.get("userId"), clubId: c.get("clubId"), clubRole: c.get("clubRole"), isAdmin: c.get("isAdmin") };
  if (!(await canReadAttendance(c.env.DB, group, requester))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.getCancelledSessions(c.env.DB, groupId, from, to));
});

// Vertretungs-Anfragen der Gruppe im Zeitraum (Status "open" = angefragt,
// "claimed" = übernommen) - für den Hinweis bzw. die Sperre auf der
// Anwesenheit-Seite. Bei "claimed" kann die ursprüngliche Leitung die
// Anwesenheit nicht erfassen, die Stunde wird der Vertretung angerechnet.
app.get("/api/attendance-substitutes/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const requester = { userId: c.get("userId"), clubId: c.get("clubId"), clubRole: c.get("clubRole"), isAdmin: c.get("isAdmin") };
  if (!(await canReadAttendance(c.env.DB, group, requester))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.listSubstituteRequestsForGroupRange(c.env.DB, groupId, from, to));
});

app.get("/api/attendance/:groupId/:date", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const access = await attendanceAccess(c.env.DB, group, c.get("userId"), date);
  // Jugendleitung / Plattform-Admin dürfen jeden Termin ihres Vereins lesen -
  // auch einen an eine Vertretung übergebenen. Für die ursprüngliche
  // Gruppenleitung bleibt so ein Termin dagegen gesperrt (wie eine Absage).
  const isClubLeadershipRead = Boolean(
    group.club_id &&
      group.club_id === c.get("clubId") &&
      (c.get("clubRole") === "jugendleiter" || c.get("isAdmin"))
  );
  if (!access.allowed && !isClubLeadershipRead) {
    return c.json({ error: "Keine Berechtigung für diesen Termin" }, 403);
  }

  return c.json(await db.getAttendance(c.env.DB, groupId, date));
});

app.put("/api/attendance/:groupId/:date", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  const body = await c.req.json().catch(() => null);
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);
  if (!Array.isArray(body?.entries)) return c.json({ error: "Liste der Anwesenheiten fehlt" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const access = await attendanceAccess(c.env.DB, group, c.get("userId"), date);
  if (!access.allowed) {
    return c.json(
      {
        error: access.isSubstituteDate
          ? "Dieser Termin wurde an eine Vertretung übergeben - du kannst die Anwesenheit erst wieder erfassen, wenn sie dir zurückgegeben wurde."
          : "Keine Berechtigung für diese Gruppe",
      },
      403
    );
  }

  // Nur an konfigurierten Trainingstagen darf regulär Anwesenheit erfasst
  // werden - Ausnahme: der Termin ist der eigene, aktuell übernommene
  // Vertretungstermin (kann vom Wochentag der Gruppe abweichen).
  if (group.weekday !== null && !access.isSubstituteDate) {
    const weekday = new Date(`${date}T00:00:00`).getDay();
    if (weekday !== group.weekday) {
      return c.json({ error: "Dieser Tag ist für diese Gruppe kein Trainingstag" }, 400);
    }
  }

  const entries: { childId: string; present: boolean }[] = [];
  for (const raw of body.entries) {
    const childId = validId(raw?.childId);
    const present = validBool(raw?.present);
    if (!childId || present === undefined) return c.json({ error: "Ungültiger Eintrag in der Anwesenheitsliste" }, 400);
    entries.push({ childId, present });
  }

  // BOLA-Schutz (Production-Readiness-Prüfung 2026-08-27): eine syntaktisch
  // gültige UUID ist keine Autorisierung - jede übermittelte childId muss
  // tatsächlich zur Zielgruppe gehören, sonst könnte ein manipulierter
  // Request Anwesenheit für ein fremdes Kind (anderer Gruppe/anderem
  // Verein) eintragen.
  if (entries.length > 0) {
    const validChildIds = await db.listChildIdsInGroup(c.env.DB, groupId);
    if (entries.some((e) => !validChildIds.has(e.childId))) {
      return c.json({ error: "Mindestens ein Kind gehört nicht zu dieser Gruppe" }, 403);
    }
  }

  // ledBy: das Frontend erlaubt hier bewusst jedes Vereinsmitglied ("wer hat
  // geleitet?" listet alle Mitglieder, nicht nur Besitzer*in/Mit-Trainer*in
  // - z.B. spontane Aushilfe). Autorisierung heißt hier also "gehört zum
  // selben Verein wie die Gruppe", nicht "darf die Gruppe sonst bearbeiten"
  // - sonst könnte ein manipulierter Request aber immer noch eine beliebige
  // fremde User-ID als Leitung zuschreiben (Stundenerfassung/Nachweis-
  // Relevanz), das war die eigentliche Lücke.
  const ledBy = body?.ledBy === undefined ? c.get("userId") : optionalId(body.ledBy);
  if (ledBy === undefined) return c.json({ error: "Ungültige Übungsleiter-ID" }, 400);
  if (ledBy !== null && ledBy !== c.get("userId")) {
    const ledByUser = await db.getUserById(c.env.DB, ledBy);
    if (!ledByUser || !group.club_id || ledByUser.clubId !== group.club_id) {
      return c.json({ error: "Ungültige Übungsleiter-ID" }, 400);
    }
  }

  // Termin-spezifische Abweichungen von den Gruppen-Vorgaben, z.B. für
  // Turniere - leer/null bedeutet "wie in der Gruppe hinterlegt".
  const startTime = validTime(body?.startTime);
  const endTime = validTime(body?.endTime);
  const location = optionalText(body?.location, 100);
  const note = optionalText(body?.note, 200);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);
  if (note === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  // Ein abweichender Termin (andere Uhrzeit/Ort/Bezeichnung als sonst, z.B.
  // Turnier) braucht die Freigabe der Jugendleitung - Turnleiter*innen
  // können nur anfragen. Die Anwesenheit selbst wird trotzdem sofort
  // gespeichert; nur die Überschreibung bleibt bis zur Freigabe unangetastet.
  const overrideRequested = startTime !== null || endTime !== null || location !== null || note !== null;
  let overridesToApply: db.SessionOverrides | null = { startTime, endTime, location, note };
  let pendingOverride: { requestId: string; groupName: string } | null = null;

  if (overrideRequested) {
    const clubId = c.get("clubId");
    const isLeader = Boolean(clubId && group.club_id === clubId && c.get("clubRole") === "jugendleiter");
    const hasLeadership = group.club_id ? (await db.countClubLeaders(c.env.DB, group.club_id)) > 0 : false;
    if (!isLeader && hasLeadership) {
      overridesToApply = null;
      let request;
      try {
        request = await db.createSessionOverrideRequest(c.env.DB, {
          groupId,
          sessionDate: date,
          requestedBy: c.get("userId"),
          startTime,
          endTime,
          location,
          note,
        });
      } catch {
        return c.json({ error: "Für diesen Termin läuft bereits eine Anfrage für einen abweichenden Termin" }, 409);
      }
      pendingOverride = { requestId: request.id, groupName: group.name };

      const leaders = (await db.listClubMembers(c.env.DB, group.club_id as string)).filter((m) => m.role === "jugendleiter");
      for (const leader of leaders) {
        await notifyUser(c.env, {
          userId: leader.id,
          userEmail: leader.email,
          userName: leader.name,
          type: "session_override_requested",
          title: `Abweichender Termin angefragt für „${group.name}“`,
          body: `${c.get("name") ?? c.get("email")} möchte den Termin am ${date} in „${group.name}“ abweichend durchführen${note ? ` (${note})` : ""} - bitte freigeben oder ablehnen.`,
          link: "/anwesenheit",
        });
      }
    }
  }

  await db.saveAttendance(c.env.DB, groupId, date, entries, ledBy, overridesToApply);
  if (overrideRequested && overridesToApply !== null) {
    await notifyClubInApp(c.env, group.club_id, {
      type: "club_session_rescheduled",
      title: `Termin geändert: „${group.name}“`,
      body: sessionChangedBody(group, date, overridesToApply),
      link: "/anwesenheit",
    });
  }

  // Wurde jemand anderes als die eintragende Person als Leitung erfasst,
  // ist das eine Vertretung: sie zählt ab jetzt in deren Stundennachweis
  // statt in dem der eintragenden Person - das per Benachrichtigung und
  // Verlaufseintrag transparent machen.
  if (ledBy && ledBy !== c.get("userId")) {
    const substitute = await db.getUserById(c.env.DB, ledBy);
    if (substitute) {
      await notifyUser(c.env, {
        userId: substitute.id,
        userEmail: substitute.email,
        userName: substitute.name,
        type: "substitute_assigned",
        title: `Vertretung eingetragen für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} hat dich für den Termin am ${date} in „${group.name}“ als Leitung eingetragen - die Stunde zählt in deinem Stundennachweis.`,
        link: "/nachweis",
      });
    }
    await db.logAudit(c.env.DB, {
      clubId: c.get("clubId"),
      actorId: c.get("userId"),
      actorName: c.get("name"),
      action: "attendance.substitute_assigned",
      targetLabel: `${group.name} am ${date} → ${substitute?.name ?? substitute?.email ?? ledBy}`,
      groupId: group.id,
    });
  }

  if (pendingOverride) {
    return c.json({ status: "pending_override_approval", requestId: pendingOverride.requestId, groupName: pendingOverride.groupName }, 202);
  }
  return c.json({ ok: true });
});

// --- Abweichende Termine (Freigabe der Jugendleitung) ---------------------------

app.get("/api/session-override-requests/incoming", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || (c.get("clubRole") !== "jugendleiter" && !c.get("isAdmin"))) return c.json([]);
  return c.json(await db.listPendingSessionOverrideRequestsForClub(c.env.DB, clubId));
});

app.get("/api/session-override-requests/mine", requireAuth, async (c) => {
  return c.json(await db.listMySessionOverrideRequests(c.env.DB, c.get("userId")));
});

app.post("/api/session-override-requests/:id/cancel", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getSessionOverrideRequestById(c.env.DB, id);
  if (!request) return c.body(null, 204);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);
  if (request.requested_by !== c.get("userId")) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setSessionOverrideRequestStatus(c.env.DB, id, "cancelled");

  const groupForAudit = await db.getGroupRowById(c.env.DB, request.group_id);
  await db.logAudit(c.env.DB, {
    clubId: groupForAudit?.club_id ?? c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "session_override_request.cancelled",
    targetLabel: `${groupForAudit?.name ?? "?"} am ${request.session_date}`,
    groupId: request.group_id,
  });

  return c.body(null, 204);
});

app.post("/api/session-override-requests/:id/approve", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getSessionOverrideRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group || group.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }

  await db.applySessionOverride(c.env.DB, request.group_id, request.session_date, {
    startTime: request.start_time,
    endTime: request.end_time,
    location: request.location,
    note: request.note,
  });
  await db.setSessionOverrideRequestStatus(c.env.DB, id, "approved");

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "session_override_request.approved",
    targetLabel: `${group.name} am ${request.session_date}`,
    groupId: group.id,
  });

  if (request.requested_by) {
    const requester = await db.getUserById(c.env.DB, request.requested_by);
    if (requester) {
      await notifyUser(c.env, {
        userId: requester.id,
        userEmail: requester.email,
        userName: requester.name,
        type: "session_override_approved",
        title: `Abweichender Termin freigegeben für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} hat deinen abweichenden Termin am ${request.session_date} in „${group.name}“ freigegeben.`,
        link: "/anwesenheit",
      });
    }
  }
  await notifyClubInApp(c.env, group.club_id, {
    type: "club_session_rescheduled",
    title: `Termin geändert: „${group.name}“`,
    body: sessionChangedBody(group, request.session_date, {
      startTime: request.start_time,
      endTime: request.end_time,
      location: request.location,
    }),
    link: "/anwesenheit",
    excludeUserIds: [request.requested_by],
  });

  return c.json({ ok: true });
});

app.post("/api/session-override-requests/:id/reject", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  const request = await db.getSessionOverrideRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group || group.club_id !== c.get("clubId") || c.get("clubRole") !== "jugendleiter") {
    return c.json({ error: "Keine Berechtigung" }, 403);
  }

  await db.setSessionOverrideRequestStatus(c.env.DB, id, "rejected");

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "session_override_request.rejected",
    targetLabel: `${group.name} am ${request.session_date}`,
    groupId: group.id,
  });

  if (request.requested_by) {
    const requester = await db.getUserById(c.env.DB, request.requested_by);
    if (requester) {
      await notifyUser(c.env, {
        userId: requester.id,
        userEmail: requester.email,
        userName: requester.name,
        type: "session_override_rejected",
        title: `Abweichender Termin abgelehnt für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} hat deinen abweichenden Termin am ${request.session_date} in „${group.name}“ abgelehnt.`,
        link: "/anwesenheit",
      });
    }
  }

  return c.json({ ok: true });
});

// --- Trainingsausfall --------------------------------------------------------

// Einen Termin komplett absagen (z.B. Ferien-Ausnahme, Trainer krank ohne
// gefundene Vertretung) - mit Grund, statt einfach als "nicht erfasst" zu
// erscheinen. Keine Freigabe der Jugendleitung nötig, das betrifft nur die
// eigene Gruppe und schafft keine zusätzlichen Stunden.
app.post("/api/attendance/:groupId/:date/cancel", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const access = await attendanceAccess(c.env.DB, group, c.get("userId"), date);
  if (!access.allowed) return c.json({ error: "Keine Berechtigung für diesen Termin" }, 403);

  const body = await c.req.json().catch(() => null);
  const reason = optionalText(body?.reason, 200);
  if (reason === undefined) return c.json({ error: "Grund ist zu lang" }, 400);

  await db.setSessionCancelled(c.env.DB, groupId, date, true, reason);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "attendance.cancelled",
    targetLabel: `${group.name} am ${date}${reason ? ` (${reason})` : ""}`,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

app.post("/api/attendance/:groupId/:date/uncancel", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const access = await attendanceAccess(c.env.DB, group, c.get("userId"), date);
  if (!access.allowed) return c.json({ error: "Keine Berechtigung für diesen Termin" }, 403);

  await db.setSessionCancelled(c.env.DB, groupId, date, false, null);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "attendance.uncancelled",
    targetLabel: `${group.name} am ${date}`,
    groupId: group.id,
  });
  return c.json({ ok: true });
});

app.onError(async (error, c) => {
  console.error("Unbehandelter API-Fehler:", redactError(error));
  if (error instanceof SyntaxError) return c.json({ error: "Ungültiger JSON-Request" }, 400);
  await recordOperationalEvent(c.env.DB, "api.unhandled_error", "critical", c.req.path);
  return c.json({ error: "Interner Serverfehler" }, 500);
});

// Erinnert einmalig (siehe reminded_at) an seit mindestens STALE_REQUEST_DAYS
// offene Verschiebe-/Kapazitäts-Anfragen - läuft täglich per Cron Trigger
// (siehe [triggers] in wrangler.toml). Reine Zusatz-Benachrichtigung: wird
// die Anfrage danach doch noch entschieden, bleibt reminded_at einfach
// gesetzt, es gibt keine zweite Erinnerung für dieselbe Anfrage.
const STALE_REQUEST_DAYS = 3;

async function remindStaleRequests(env: Env): Promise<void> {
  const threshold = new Date(Date.now() - STALE_REQUEST_DAYS * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

  const staleMoves = await db.listStaleMoveRequests(env.DB, threshold);
  for (const request of staleMoves) {
    const targetGroup = await db.getGroupRowById(env.DB, request.toGroupId);
    if (targetGroup?.owner_id) {
      const owner = await db.getUserById(env.DB, targetGroup.owner_id);
      if (owner) {
        await notifyUser(env, {
          userId: owner.id,
          userEmail: owner.email,
          userName: owner.name,
          type: "move_request_reminder",
          title: `Erinnerung: Verschiebe-Anfrage für „${request.toGroupName}“`,
          body: `${request.childName} wartet seit ${STALE_REQUEST_DAYS} Tagen auf deine Freigabe für „${request.toGroupName}“.`,
          link: "/gruppen",
        });
      }
    }
    if (request.requestedBy) {
      const requester = await db.getUserById(env.DB, request.requestedBy);
      if (requester) {
        await notifyUser(env, {
          userId: requester.id,
          userEmail: requester.email,
          userName: requester.name,
          type: "move_request_reminder",
          title: `Erinnerung: Deine Verschiebe-Anfrage wartet noch`,
          body: `${request.childName} wartet seit ${STALE_REQUEST_DAYS} Tagen auf Freigabe für „${request.toGroupName}“.`,
          link: "/kinder",
        });
      }
    }
    await db.markMoveRequestReminded(env.DB, request.id);
  }

  const staleCapacity = await db.listStaleCapacityRequests(env.DB, threshold);
  for (const request of staleCapacity) {
    const group = await db.getGroupRowById(env.DB, request.groupId);
    if (group?.club_id) {
      const members = await db.listClubMembers(env.DB, group.club_id);
      for (const member of members.filter((m) => m.role === "jugendleiter")) {
        await notifyUser(env, {
          userId: member.id,
          userEmail: member.email,
          userName: member.name,
          type: "capacity_request_reminder",
          title: `Erinnerung: Kapazitäts-Anfrage für „${request.groupName}“`,
          body: `${request.childName} wartet seit ${STALE_REQUEST_DAYS} Tagen auf deine Freigabe für „${request.groupName}“.`,
          link: "/gruppen",
        });
      }
    }
    await db.markCapacityRequestReminded(env.DB, request.id);
  }
}

// Speicherbegrenzung für archivierte (ausgetretene) Kinder (Finding PRIV-05,
// Art. 5(1)(e) DSGVO). Läuft täglich per Cron, löscht endgültig (analog
// zu DELETE /api/children/:id: redactChildTraces() vor deleteChild(), damit
// auch Audit-Log/Notifications-Reste nicht bestehen bleiben). Ohne
// gesetzte ARCHIVED_CHILD_RETENTION_DAYS-Variable passiert NICHTS -
// die konkrete Frist ist eine bewusste Konfigurations-/Rechtsentscheidung,
// kein hartkodierter Automatismus (siehe types.ts, Env.ARCHIVED_CHILD_RETENTION_DAYS).
async function deleteStaleArchivedChildren(env: Env): Promise<void> {
  const retentionDays = Number(env.ARCHIVED_CHILD_RETENTION_DAYS);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;

  const stale = await db.listArchivedChildrenOlderThan(env.DB, retentionDays);
  for (const child of stale) {
    // actorId bewusst leer statt eines erfundenen "system"-Users - actor_id
    // hat eine FK-Referenz auf users(id), ein nicht existierender Wert
    // würde den Insert scheitern lassen.
    await db.logAudit(env.DB, {
      clubId: child.club_id,
      actorId: null,
      actorName: "Automatische Löschung (Aufbewahrungsfrist)",
      action: "child.retention_deleted",
      targetLabel: `Nach ${retentionDays} Tagen Archivierung automatisch gelöscht`,
      childId: child.id,
    });
    await db.redactChildTraces(env.DB, child.id);
    await db.deleteChild(env.DB, child.id);
  }
}

// Speicherbegrenzung für Security-Tabellen (externe Production-Readiness-
// Prüfung 2026-08-27, Finding "Retention"): sessions/login_attempts/
// used_password_reset_tokens wuchsen bisher unbegrenzt. Gleiche
// Opt-in-Logik wie bei deleteStaleArchivedChildren - ohne gesetzte
// SECURITY_LOG_RETENTION_DAYS läuft kein Cleanup.
async function cleanupSecurityLogs(env: Env): Promise<void> {
  const retentionDays = Number(env.SECURITY_LOG_RETENTION_DAYS);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return;
  await db.cleanupSecurityLogs(env.DB, retentionDays);
}

// Allgemeine Speicherbegrenzung fürs In-App-Postfach. Die Frist gilt für
// gelesene und ungelesene Meldungen gleichermaßen; ohne gültige positive
// Konfiguration wird nichts gelöscht.
async function cleanupNotifications(env: Env): Promise<void> {
  const retentionDays = Number(env.NOTIFICATION_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) return;
  await cleanupExpiredNotifications(env.DB, retentionDays);
}

async function runTrackedCron(env: Env, jobName: string, job: () => Promise<void>): Promise<void> {
  await startCron(env.DB, jobName);
  try {
    await job();
    await finishCron(env.DB, jobName);
  } catch (error) {
    await finishCron(env.DB, jobName, error);
    console.error(`Cron ${jobName} fehlgeschlagen:`, redactError(error));
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runTrackedCron(env, "stale-request-reminders", () => remindStaleRequests(env)));
    ctx.waitUntil(runTrackedCron(env, "archived-child-retention", () => deleteStaleArchivedChildren(env)));
    ctx.waitUntil(runTrackedCron(env, "security-log-retention", () => cleanupSecurityLogs(env)));
    ctx.waitUntil(runTrackedCron(env, "notification-retention", () => cleanupNotifications(env)));
    ctx.waitUntil(runTrackedCron(env, "email-retries", () => retryFailedEmails(env)));
    ctx.waitUntil(runTrackedCron(env, "operational-data-retention", () => cleanupOperationalData(env.DB)));
  },
} satisfies ExportedHandler<Env>;
