import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import * as db from "./db";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth";
import { notifyUser } from "./notifications";
import {
  normalizedEmail,
  optionalId,
  optionalText,
  requiredText,
  validAgeRange,
  validBool,
  validDate,
  validId,
  validOptionalCount,
  validPassword,
  validSortOrder,
  validTime,
  validWeekday,
} from "./validation";
import type { CapacityRequestRow, ClubRole, Env } from "./types";

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

type Variables = {
  userId: string;
  email: string;
  name: string | null;
  clubId: string | null;
  clubRole: ClubRole;
};

type AppEnv = { Bindings: Env; Variables: Variables };

const app = new Hono<AppEnv>();

app.use("*", async (c, next) =>
  cors({
    origin: (origin, context) => {
      if (!origin) return null;
      if (origin === new URL(context.env.FRONTEND_URL).origin) return origin;
      const apiHostname = new URL(context.req.url).hostname;
      const isLocalApi = apiHostname === "localhost" || apiHostname === "127.0.0.1";
      const isLocalFrontend = /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
      return isLocalApi && isLocalFrontend ? origin : null;
    },
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    maxAge: 86400,
  })(c, next)
);

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});

const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "Nicht angemeldet" }, 401);
  try {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    const user = await db.getUserById(c.env.DB, payload.sub);
    if (!user) return c.json({ error: "Nicht angemeldet" }, 401);
    c.set("userId", user.id);
    c.set("email", user.email);
    c.set("name", user.name);
    c.set("clubId", user.clubId);
    c.set("clubRole", user.clubRole);
  } catch {
    return c.json({ error: "Nicht angemeldet" }, 401);
  }
  await next();
};

// Ein Kind ist bearbeitbar, wenn es keiner Gruppe zugeordnet ist (Alt-Bestand,
// weiterhin für alle offen) oder wenn die zugehörige Gruppe für den Nutzer
// beschreibbar ist.
async function isChildWritable(dbEnv: D1Database, child: { group_id: string | null }, userId: string): Promise<boolean> {
  if (!child.group_id) return true;
  const group = await db.getGroupRowById(dbEnv, child.group_id);
  if (!group) return true;
  return db.canWriteGroup(group, userId);
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
  return { allowed: db.canWriteGroup(group, userId), isSubstituteDate: false };
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

// Führt die ursprünglich geplante Aktion einer freigegebenen
// Kapazitäts-Anfrage nachträglich aus.
async function applyCapacityRequest(dbEnv: D1Database, request: CapacityRequestRow, approvedBy: string): Promise<void> {
  const payload = JSON.parse(request.payload);
  switch (request.action) {
    case "create_child":
      await db.createChild(dbEnv, payload);
      break;
    case "update_child":
      if (request.child_id) await db.updateChild(dbEnv, request.child_id, payload);
      break;
    case "move_child":
      if (request.child_id) await db.moveChildToGroup(dbEnv, request.child_id, payload.toGroupId);
      break;
    case "approve_move_request": {
      const moveRequest = await db.getMoveRequestRowById(dbEnv, payload.moveRequestId);
      if (moveRequest && moveRequest.status === "pending") {
        await db.moveChildToGroup(dbEnv, moveRequest.child_id, moveRequest.to_group_id);
        await db.setMoveRequestStatus(dbEnv, moveRequest.id, "approved", approvedBy);
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
        });
      }
    }
  }
}

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizedEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : undefined;
  if (!email || !password) return c.json({ error: "E-Mail oder Passwort fehlt" }, 400);

  const userRow = await db.getUserByEmail(c.env.DB, email);
  if (!userRow) return c.json({ error: "E-Mail oder Passwort ungültig" }, 401);

  const valid = await verifyPassword(password, userRow.password_hash, userRow.password_salt);
  if (!valid) return c.json({ error: "E-Mail oder Passwort ungültig" }, 401);

  const token = await signToken(
    { sub: userRow.id, email: userRow.email, name: userRow.name },
    c.env.JWT_SECRET
  );
  return c.json({ token, user: { id: userRow.id, email: userRow.email, name: userRow.name } });
});

app.get("/api/me", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  const club = clubId ? await db.getClubById(c.env.DB, clubId) : null;
  return c.json({
    id: c.get("userId"),
    email: c.get("email"),
    name: c.get("name"),
    clubId,
    clubName: club?.name ?? null,
    clubRole: c.get("clubRole"),
  });
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
  return c.json({ clubId, clubRole: "member" });
});

app.get("/api/clubs/mine/members", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listClubMembers(c.env.DB, clubId));
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

// --- Gruppen -----------------------------------------------------------

app.get("/api/groups", requireAuth, async (c) => {
  return c.json(await db.listGroupsForUser(c.env.DB, c.get("userId"), c.get("clubId")));
});

app.post("/api/groups", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  const ageRange = validAgeRange(body?.minAge, body?.maxAge);
  const sortOrder = validSortOrder(body?.sortOrder);
  const maxChildren = validOptionalCount(body?.maxChildren);
  const weekday = validWeekday(body?.weekday);
  const startTime = validTime(body?.startTime);
  const endTime = validTime(body?.endTime);
  const location = optionalText(body?.location, 100);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);
  if (weekday === undefined) return c.json({ error: "Wochentag ist ungültig" }, 400);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);

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
  });
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.created",
    targetLabel: group.name,
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
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);
  if (weekday === undefined) return c.json({ error: "Wochentag ist ungültig" }, 400);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(existing, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const group = await db.updateGroup(
    c.env.DB,
    id,
    { name, ...ageRange, sortOrder, maxChildren, weekday, startTime, endTime, location },
    { userId: c.get("userId"), ownerName: c.get("name") }
  );
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "group.updated",
    targetLabel: group.name,
  });

  // Wurde die Kapazität erhöht, können jetzt Wartelisten-Einträge nachrücken.
  await promoteWaitlistIfPossible(c, id);
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
  });
  return c.json(group);
});

app.delete("/api/groups/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  if (!db.canWriteGroup(existing, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

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

// --- Kinder --------------------------------------------------------------

app.get("/api/children", requireAuth, async (c) => {
  return c.json(await db.listChildrenForUser(c.env.DB, c.get("userId"), c.get("clubId")));
});

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
  const notes = optionalText(body?.notes, 500);
  const emergencyContactName = optionalText(body?.emergencyContactName, 100);
  const emergencyContactPhone = optionalText(body?.emergencyContactPhone, 40);
  const healthNotes = optionalText(body?.healthNotes, 1000);
  const familyId = optionalId(body?.familyId);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (notes === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);
  if (emergencyContactName === undefined) return c.json({ error: "Notfallkontakt (Name) ist zu lang" }, 400);
  if (emergencyContactPhone === undefined) return c.json({ error: "Notfallkontakt (Telefon) ist zu lang" }, 400);
  if (healthNotes === undefined) return c.json({ error: "Gesundheitshinweise sind zu lang" }, 400);
  if (familyId === undefined) return c.json({ error: "Familie ist ungültig" }, 400);

  const childInput = { firstName, lastName, birthDate, groupId, notes, emergencyContactName, emergencyContactPhone, healthNotes, familyId };

  if (groupId) {
    const group = await db.getGroupRowById(c.env.DB, groupId);
    if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

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

  const child = await db.createChild(c.env.DB, childInput);
  return c.json(child, 201);
});

app.put("/api/children/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  const body = await c.req.json().catch(() => null);
  const firstName = requiredText(body?.firstName, 100);
  const lastName = requiredText(body?.lastName, 100);
  const birthDate = validDate(body?.birthDate);
  const groupId = optionalId(body?.groupId);
  const notes = optionalText(body?.notes, 500);
  const emergencyContactName = optionalText(body?.emergencyContactName, 100);
  const emergencyContactPhone = optionalText(body?.emergencyContactPhone, 40);
  const healthNotes = optionalText(body?.healthNotes, 1000);
  const familyId = optionalId(body?.familyId);
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (notes === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);
  if (emergencyContactName === undefined) return c.json({ error: "Notfallkontakt (Name) ist zu lang" }, 400);
  if (emergencyContactPhone === undefined) return c.json({ error: "Notfallkontakt (Telefon) ist zu lang" }, 400);
  if (healthNotes === undefined) return c.json({ error: "Gesundheitshinweise sind zu lang" }, 400);
  if (familyId === undefined) return c.json({ error: "Familie ist ungültig" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const childInput = { firstName, lastName, birthDate, groupId, notes, emergencyContactName, emergencyContactPhone, healthNotes, familyId };

  if (groupId) {
    const group = await db.getGroupRowById(c.env.DB, groupId);
    if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

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

  // Verließ das Kind eine kapazitätsbeschränkte Gruppe, kann jetzt jemand
  // von deren Warteliste nachrücken.
  if (previousGroupId && previousGroupId !== groupId) await promoteWaitlistIfPossible(c, previousGroupId);

  return c.json(child);
});

app.delete("/api/children/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  await db.deleteChild(c.env.DB, id);
  if (existing.group_id) await promoteWaitlistIfPossible(c, existing.group_id);
  return c.body(null, 204);
});

// --- Familien / Geschwister --------------------------------------------------

app.get("/api/families", requireAuth, async (c) => {
  return c.json(await db.listFamiliesForUser(c.env.DB, c.get("userId"), c.get("clubId")));
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
  let allowed = await isChildWritable(c.env.DB, existing, c.get("userId"));
  if (!allowed && existing.group_id) {
    const group = await db.getGroupRowById(c.env.DB, existing.group_id);
    const clubId = c.get("clubId");
    allowed = Boolean(group?.club_id && clubId && group.club_id === clubId);
  }
  if (!allowed) return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const child = await db.setChildFamily(c.env.DB, id, familyId);
  return c.json(child);
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

  const family = await db.createFamily(c.env.DB, { name, contactName, contactPhone, contactEmail }, c.get("userId"));
  return c.json(family, 201);
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
  if (existing.created_by !== c.get("userId")) return c.json({ error: "Keine Berechtigung für diese Familie" }, 403);

  const family = await db.updateFamily(c.env.DB, id, { name, contactName, contactPhone, contactEmail });
  if (!family) return c.json({ error: "Familie nicht gefunden" }, 404);
  return c.json(family);
});

// --- Audit-Log -----------------------------------------------------------------

app.get("/api/audit-log", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listAuditLogForClub(c.env.DB, clubId));
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
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const request = await db.createSubstituteRequest(c.env.DB, {
    groupId,
    sessionDate,
    note,
    requestedBy: c.get("userId"),
  });

  if (group.club_id) {
    const members = await db.listClubMembers(c.env.DB, group.club_id);
    for (const member of members.filter((m) => m.id !== c.get("userId"))) {
      await notifyUser(c.env, {
        userId: member.id,
        userEmail: member.email,
        userName: member.name,
        type: "substitute_request",
        title: `Vertretung gesucht für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} sucht für den Termin am ${sessionDate} in „${group.name}“ eine Vertretung.${note ? ` (${note})` : ""}`,
        link: "/vertretungen",
      });
    }
  }

  return c.json(request, 201);
});

app.get("/api/substitute-requests/open", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listOpenSubstituteRequestsForClub(c.env.DB, clubId));
});

app.get("/api/substitute-requests/mine", requireAuth, async (c) => {
  return c.json(await db.listMySubstituteRequests(c.env.DB, c.get("userId")));
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
  if (request.requested_by !== c.get("userId")) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setSubstituteRequestStatus(c.env.DB, id, "cancelled");
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
  const isOwner = db.canWriteGroup(group, userId);
  if (!isSubstitute && !isOwner) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.returnSubstituteRequest(c.env.DB, id, request.group_id, request.session_date);

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: userId,
    actorName: c.get("name"),
    action: "substitute_request.returned",
    targetLabel: `${group.name} am ${request.session_date}`,
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
  if (!(await isChildWritable(c.env.DB, child, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);
  if (child.group_id === toGroupId) return c.json({ error: "Kind ist bereits in dieser Gruppe" }, 400);

  const targetGroup = await db.getGroupRowById(c.env.DB, toGroupId);
  if (!targetGroup) return c.json({ error: "Zielgruppe nicht gefunden" }, 404);

  const existingPending = await db.getPendingMoveRequestForChild(c.env.DB, id);
  if (existingPending) return c.json({ error: "Für dieses Kind liegt bereits eine offene Verschiebe-Anfrage vor" }, 409);

  const fits = db.ageFitsGroup(child.birth_date, targetGroup);
  const targetOwnedByRequester = targetGroup.owner_id === c.get("userId");
  const targetUnclaimed = targetGroup.owner_id === null;

  if (fits || targetOwnedByRequester || targetUnclaimed) {
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
    await db.moveChildToGroup(c.env.DB, id, toGroupId);
    if (previousGroupId) await promoteWaitlistIfPossible(c, previousGroupId);
    return c.json({ status: "moved", groupId: toGroupId });
  }

  const request = await db.createMoveRequest(c.env.DB, {
    childId: id,
    fromGroupId: child.group_id,
    toGroupId,
    requestedBy: c.get("userId"),
  });
  if (targetGroup.owner_id) {
    const owner = await db.getUserById(c.env.DB, targetGroup.owner_id);
    if (owner) {
      await notifyUser(c.env, {
        userId: owner.id,
        userEmail: owner.email,
        userName: owner.name,
        type: "move_request",
        title: `Verschiebe-Anfrage für „${targetGroup.name}“`,
        body: `${child.first_name} ${child.last_name} soll in deine Gruppe „${targetGroup.name}“ wechseln, erfüllt aber die Altersvoraussetzung nicht - bitte freigeben oder ablehnen.`,
        link: "/gruppen",
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
  if (request.from_group_id) await promoteWaitlistIfPossible(c, request.from_group_id);
  const movedChild = await db.getChildRowById(c.env.DB, request.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "move_request.approved",
    targetLabel: movedChild ? `${movedChild.first_name} ${movedChild.last_name} → ${targetGroup.name}` : targetGroup.name,
  });
  return c.json({ ok: true });
});

app.post("/api/move-requests/:id/reject", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getMoveRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const targetGroup = await db.getGroupRowById(c.env.DB, request.to_group_id);
  if (!targetGroup || targetGroup.owner_id !== c.get("userId"))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.setMoveRequestStatus(c.env.DB, id, "rejected", c.get("userId"));
  const rejectedChild = await db.getChildRowById(c.env.DB, request.child_id);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "move_request.rejected",
    targetLabel: rejectedChild ? `${rejectedChild.first_name} ${rejectedChild.last_name} → ${targetGroup.name}` : targetGroup.name,
  });
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
  return c.body(null, 204);
});

// --- Kapazitäts-Anfragen ----------------------------------------------------

app.get("/api/capacity-requests/incoming", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || c.get("clubRole") !== "jugendleiter") return c.json([]);
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

  await applyCapacityRequest(c.env.DB, request, c.get("userId"));
  await db.setCapacityRequestStatus(c.env.DB, id, "approved", c.get("userId"));
  if (previousGroupId && previousGroupId !== request.group_id) await promoteWaitlistIfPossible(c, previousGroupId);
  await db.logAudit(c.env.DB, {
    clubId: c.get("clubId"),
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "capacity_request.approved",
    targetLabel: `${group.name} (${request.action})`,
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
  if (!(await isChildWritable(c.env.DB, child, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  const entry = await db.addToWaitlist(c.env.DB, { groupId, childId, requestedBy: c.get("userId") });
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
  const canManage = entry.requested_by === c.get("userId") || (group && db.canWriteGroup(group, c.get("userId")));
  if (!canManage) return c.json({ error: "Keine Berechtigung" }, 403);

  await db.setWaitlistEntryStatus(c.env.DB, id, "cancelled");
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
  const allowed = (await isChildWritable(c.env.DB, child, c.get("userId"))) || c.get("clubRole") === "jugendleiter";
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

// Konsolidierte Sicht auf die Warteliste - bewusst nur für die
// Jugendleitung, die von hier aus verteilt. Einzelne Turnleiter*innen
// können zwar Kinder anmelden (s.o.), sehen die Gesamtliste aber nicht.
app.get("/api/club-waitlist", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId || c.get("clubRole") !== "jugendleiter") return c.json([]);
  return c.json(await db.listClubWaitlist(c.env.DB, clubId));
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

  if (group.owner_id) {
    const owner = await db.getUserById(c.env.DB, group.owner_id);
    const child = await db.getChildRowById(c.env.DB, entry.child_id);
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

app.get("/api/placement-requests/incoming", requireAuth, async (c) => {
  return c.json(await db.listPendingPlacementRequestsForOwner(c.env.DB, c.get("userId")));
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
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const entry = await db.getClubWaitlistEntryById(c.env.DB, request.waitlist_entry_id);
  if (!entry) return c.json({ error: "Warteliste-Eintrag nicht gefunden" }, 404);
  const child = await db.getChildRowById(c.env.DB, entry.child_id);
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);

  const warning = await capacityWarning(c.env.DB, group, undefined);
  if (warning && body?.confirmOverCapacity !== true) return c.json(warning, 409);

  await db.moveChildToGroup(c.env.DB, entry.child_id, request.group_id);
  await db.setPlacementRequestStatus(c.env.DB, id, "confirmed");
  await db.setClubWaitlistStatus(c.env.DB, entry.id, "placed");

  await db.logAudit(c.env.DB, {
    clubId: group.club_id,
    actorId: c.get("userId"),
    actorName: c.get("name"),
    action: "placement_request.confirmed",
    targetLabel: `${child.first_name} ${child.last_name} → ${group.name}`,
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
      });
    }
  }

  return c.json({ ok: true });
});

app.post("/api/placement-requests/:id/decline", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const request = await db.getPlacementRequestById(c.env.DB, id);
  if (!request) return c.json({ error: "Vorschlag nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Vorschlag ist nicht mehr offen" }, 409);

  const group = await db.getGroupRowById(c.env.DB, request.group_id);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.setPlacementRequestStatus(c.env.DB, id, "declined");

  if (request.proposed_by) {
    const proposer = await db.getUserById(c.env.DB, request.proposed_by);
    const entry = await db.getClubWaitlistEntryById(c.env.DB, request.waitlist_entry_id);
    const child = entry ? await db.getChildRowById(c.env.DB, entry.child_id) : null;
    if (proposer && child) {
      await notifyUser(c.env, {
        userId: proposer.id,
        userEmail: proposer.email,
        userName: proposer.name,
        type: "placement_declined",
        title: `Platzvorschlag abgelehnt für „${group.name}“`,
        body: `${c.get("name") ?? c.get("email")} kann ${child.first_name} ${child.last_name} aktuell nicht in „${group.name}“ aufnehmen.`,
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
    scope === "club" && clubId && c.get("clubRole") === "jugendleiter"
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
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return c.json({ error: "Ungültiges Quartal" }, 400);

  const startMonth = (quarter - 1) * 3 + 1;
  const from = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth + 2;
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

  const months = [startMonth, startMonth + 1, startMonth + 2].map((month) => {
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

// --- Anwesenheit -----------------------------------------------------------

// Anwesenheit ist – anders als Gruppen/Kinder – nicht vereinsweit lesbar:
// nur der Besitzer der Gruppe (bzw. bei herrenlosen Alt-Gruppen weiterhin
// jeder) darf sie sehen oder erfassen.
app.get("/api/attendance-range/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.getAttendanceRange(c.env.DB, groupId, from, to));
});

app.get("/api/attendance-leaders/:groupId", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const from = validDate(c.req.query("from"));
  const to = validDate(c.req.query("to"));
  if (!groupId || !from || !to) return c.json({ error: "Ungültige Gruppe oder Zeitraum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  return c.json(await db.getSessionLeaders(c.env.DB, groupId, from, to));
});

app.get("/api/attendance/:groupId/:date", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  const access = await attendanceAccess(c.env.DB, group, c.get("userId"), date);
  if (!access.allowed) return c.json({ error: "Keine Berechtigung für diesen Termin" }, 403);

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

  const ledBy = body?.ledBy === undefined ? c.get("userId") : optionalId(body.ledBy);
  if (ledBy === undefined) return c.json({ error: "Ungültige Übungsleiter-ID" }, 400);

  // Termin-spezifische Abweichungen von den Gruppen-Vorgaben, z.B. für
  // Turniere - leer/null bedeutet "wie in der Gruppe hinterlegt".
  const startTime = validTime(body?.startTime);
  const endTime = validTime(body?.endTime);
  const location = optionalText(body?.location, 100);
  const note = optionalText(body?.note, 200);
  if (startTime === undefined || endTime === undefined) return c.json({ error: "Uhrzeit ist ungültig (Format HH:MM)" }, 400);
  if (location === undefined) return c.json({ error: "Ort ist zu lang" }, 400);
  if (note === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  await db.saveAttendance(c.env.DB, groupId, date, entries, ledBy, { startTime, endTime, location, note });

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
    });
  }

  return c.json({ ok: true });
});

app.onError((error, c) => {
  console.error("Unbehandelter API-Fehler:", error);
  if (error instanceof SyntaxError) return c.json({ error: "Ungültiger JSON-Request" }, 400);
  return c.json({ error: "Interner Serverfehler" }, 500);
});

export default app;
