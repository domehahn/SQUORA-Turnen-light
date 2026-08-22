import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import * as db from "./db";
import { hashPassword, signToken, verifyPassword, verifyToken } from "./auth";
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
} from "./validation";
import type { Env } from "./types";

type Variables = {
  userId: string;
  email: string;
  name: string | null;
  clubId: string | null;
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
  });
});

// --- Vereine -------------------------------------------------------------

app.get("/api/clubs", requireAuth, async (c) => {
  return c.json(await db.listClubs(c.env.DB));
});

app.post("/api/clubs", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = requiredText(body?.name, 100);
  if (!name) return c.json({ error: "Vereinsname fehlt oder ist ungültig" }, 400);

  const existing = await db.getClubByName(c.env.DB, name);
  if (existing) return c.json({ error: "Ein Verein mit diesem Namen existiert bereits" }, 409);

  const club = await db.createClub(c.env.DB, name);
  await db.setUserClub(c.env.DB, c.get("userId"), club.id);
  return c.json({ id: club.id, name: club.name, memberCount: 1, createdAt: club.created_at }, 201);
});

app.put("/api/me/club", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const clubId = optionalId(body?.clubId);
  if (clubId === undefined) return c.json({ error: "Ungültige Vereins-ID" }, 400);

  if (clubId !== null) {
    const club = await db.getClubById(c.env.DB, clubId);
    if (!club) return c.json({ error: "Verein nicht gefunden" }, 404);
  }
  await db.setUserClub(c.env.DB, c.get("userId"), clubId);
  return c.json({ clubId });
});

app.get("/api/clubs/mine/members", requireAuth, async (c) => {
  const clubId = c.get("clubId");
  if (!clubId) return c.json([]);
  return c.json(await db.listClubMembers(c.env.DB, clubId));
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
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);

  const group = await db.createGroup(c.env.DB, {
    name,
    ...ageRange,
    sortOrder,
    maxChildren,
    ownerId: c.get("userId"),
    ownerName: c.get("name"),
    clubId: c.get("clubId"),
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
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!name) return c.json({ error: "Name fehlt oder ist ungültig" }, 400);
  if (!ageRange) return c.json({ error: "Altersspanne ist ungültig (min. Alter muss <= max. Alter sein)" }, 400);
  if (sortOrder === undefined) return c.json({ error: "Sortierung ist ungültig" }, 400);
  if (maxChildren === undefined) return c.json({ error: "Max. Kinderzahl ist ungültig" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(existing, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const group = await db.updateGroup(
    c.env.DB,
    id,
    { name, ...ageRange, sortOrder, maxChildren },
    { userId: c.get("userId"), ownerName: c.get("name") }
  );
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  return c.json(group);
});

// Eine herrenlose Alt-Gruppe (aus der Zeit vor Vereinen) dem eigenen Verein
// zuordnen. Danach gehört sie dem aufrufenden Nutzer und ist für andere
// Vereinsmitglieder lesend sichtbar.
app.post("/api/groups/:id/claim", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const clubId = c.get("clubId");
  if (!clubId) return c.json({ error: "Du bist aktuell keinem Verein zugeordnet" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (existing.owner_id !== null || existing.club_id !== null) {
    return c.json({ error: "Gruppe ist bereits einem Turnleiter bzw. Verein zugeordnet" }, 409);
  }

  const group = await db.claimGroup(c.env.DB, id, { ownerId: c.get("userId"), ownerName: c.get("name"), clubId });
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  return c.json(group);
});

app.delete("/api/groups/:id", requireAuth, async (c) => {
  const id = validId(c.req.param("id"));
  if (!id) return c.json({ error: "Ungültige ID" }, 400);

  const existing = await db.getGroupRowById(c.env.DB, id);
  if (!existing) return c.body(null, 204);
  if (!db.canWriteGroup(existing, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.deleteGroup(c.env.DB, id);
  return c.body(null, 204);
});

// --- Kinder --------------------------------------------------------------

app.get("/api/children", requireAuth, async (c) => {
  return c.json(await db.listChildrenForUser(c.env.DB, c.get("userId"), c.get("clubId")));
});

app.post("/api/children", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const firstName = requiredText(body?.firstName, 100);
  const lastName = requiredText(body?.lastName, 100);
  const birthDate = validDate(body?.birthDate);
  const groupId = optionalId(body?.groupId);
  const notes = optionalText(body?.notes, 500);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (notes === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  if (groupId) {
    const group = await db.getGroupRowById(c.env.DB, groupId);
    if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  }

  const child = await db.createChild(c.env.DB, { firstName, lastName, birthDate, groupId, notes });
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
  if (!id) return c.json({ error: "Ungültige ID" }, 400);
  if (!firstName) return c.json({ error: "Vorname fehlt oder ist ungültig" }, 400);
  if (!lastName) return c.json({ error: "Nachname fehlt oder ist ungültig" }, 400);
  if (!birthDate) return c.json({ error: "Geburtsdatum ist ungültig (Format JJJJ-MM-TT)" }, 400);
  if (groupId === undefined) return c.json({ error: "Gruppe ist ungültig" }, 400);
  if (notes === undefined) return c.json({ error: "Notiz ist zu lang" }, 400);

  const existing = await db.getChildRowById(c.env.DB, id);
  if (!existing) return c.json({ error: "Kind nicht gefunden" }, 404);
  if (!(await isChildWritable(c.env.DB, existing, c.get("userId"))))
    return c.json({ error: "Keine Berechtigung für dieses Kind" }, 403);

  if (groupId) {
    const group = await db.getGroupRowById(c.env.DB, groupId);
    if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
    if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);
  }

  const child = await db.updateChild(c.env.DB, id, { firstName, lastName, birthDate, groupId, notes });
  if (!child) return c.json({ error: "Kind nicht gefunden" }, 404);
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
  return c.body(null, 204);
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
    await db.moveChildToGroup(c.env.DB, id, toGroupId);
    return c.json({ status: "moved", groupId: toGroupId });
  }

  const request = await db.createMoveRequest(c.env.DB, {
    childId: id,
    fromGroupId: child.group_id,
    toGroupId,
    requestedBy: c.get("userId"),
  });
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

  const request = await db.getMoveRequestRowById(c.env.DB, id);
  if (!request) return c.json({ error: "Anfrage nicht gefunden" }, 404);
  if (request.status !== "pending") return c.json({ error: "Anfrage ist nicht mehr offen" }, 409);

  const targetGroup = await db.getGroupRowById(c.env.DB, request.to_group_id);
  if (!targetGroup || targetGroup.owner_id !== c.get("userId"))
    return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  await db.moveChildToGroup(c.env.DB, request.child_id, request.to_group_id);
  await db.setMoveRequestStatus(c.env.DB, id, "approved", c.get("userId"));
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

app.get("/api/attendance/:groupId/:date", requireAuth, async (c) => {
  const groupId = validId(c.req.param("groupId"));
  const date = validDate(c.req.param("date"));
  if (!groupId || !date) return c.json({ error: "Ungültige Gruppe oder Datum" }, 400);

  const group = await db.getGroupRowById(c.env.DB, groupId);
  if (!group) return c.json({ error: "Gruppe nicht gefunden" }, 404);
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

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
  if (!db.canWriteGroup(group, c.get("userId"))) return c.json({ error: "Keine Berechtigung für diese Gruppe" }, 403);

  const entries: { childId: string; present: boolean }[] = [];
  for (const raw of body.entries) {
    const childId = validId(raw?.childId);
    const present = validBool(raw?.present);
    if (!childId || present === undefined) return c.json({ error: "Ungültiger Eintrag in der Anwesenheitsliste" }, 400);
    entries.push({ childId, present });
  }

  await db.saveAttendance(c.env.DB, groupId, date, entries);
  return c.json({ ok: true });
});

app.onError((error, c) => {
  console.error("Unbehandelter API-Fehler:", error);
  if (error instanceof SyntaxError) return c.json({ error: "Ungültiger JSON-Request" }, 400);
  return c.json({ error: "Interner Serverfehler" }, 500);
});

export default app;
