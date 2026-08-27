# Authorization-Modell — Turnen (SQUORA)

Ergänzt `tenant-model.md` (Mandantengrenzen) um die Autorisierungslogik
innerhalb eines Vereins.

## Rollen

| Rolle | Feld | Umfang |
|---|---|---|
| `member` | `users.club_role = 'member'` | Eigene Gruppe(n) (Besitz oder Mit-Trainerschaft) |
| `jugendleiter` | `users.club_role = 'jugendleiter'` | Vereinsweit (alle Gruppen/Kinder/Familien des eigenen Vereins) |
| Platform-Admin | `users.is_admin = 1` | Vereinsübergreifend, `/api/admin/*`; **MFA verpflichtend** |

Eine Person kann gleichzeitig `is_admin` und eine `club_role` haben (z.B.
um sich testweise "als Jugendleitung" in einen Verein einzuwechseln, s.
`AdminClubSwitcher.tsx`).

## Fail-closed-Prinzip (seit P1-06)

Jede Autorisierungsprüfung, die auf eine fehlende/unbekannte Beziehung
trifft (keine Gruppe, keine Vereinszuordnung, keine existierende Gruppe),
lehnt ab (403) statt zu erlauben. Frühere `return true`-Ausnahmen für
"Alt-Bestand"/"herrenlose" Ressourcen wurden entfernt, nachdem gegen die
Produktionsdatenbank verifiziert wurde, dass keine solchen Zeilen mehr
existieren (s. `PRODUCTION_READINESS_ANALYSIS.md`, P1-06). Ein Deny in
diesem Zustand erzeugt einen Security-Event-Log-Eintrag
(`security.unknown_tenant_relation_denied` /
`security.dangling_group_reference_denied`), ohne personenbezogenen
Inhalt.

## Zentrale Prüf-Helfer (`worker/src/index.ts`, `worker/src/db.ts`)

- **`isChildWritable(db, child, userId, ctx)`**: darf `child` bearbeitet
  werden? Wahr bei: eigene Gruppe (Besitz/Mit-Trainerschaft),
  `jugendleiter` desselben Vereins, oder (bei gruppenlosem Kind) gleicher
  `club_id`. Fail-closed sonst.
- **`canWriteGroup(group, userId)`** / **`canWriteGroupAsync(db, group,
  userId)`**: Gruppen-Besitz oder Mit-Trainerschaft (`group_co_leaders`).
- **`requireAuth`**: Session-Gültigkeit, Idle-/Absolute-Timeout,
  MFA-Pflicht für `is_admin`, `must_change_password`-Sperre (in dieser
  Reihenfolge - s. `session-management.md`).
- **`requireAdmin`**: `is_admin`-Gate für `/api/admin/*`.

## BOLA/IDOR-Schutz

Jede ID aus der URL/dem Request-Body wird gegen die tatsächliche
Beziehung geprüft, nicht nur auf syntaktische Gültigkeit:

- **Anwesenheit**: `childId` im PUT-Body muss zur Zielgruppe gehören
  (`db.listChildIdsInGroup`), sonst 403. `ledBy` muss zum selben Verein
  gehören.
- **Familien-Verknüpfung**: `familyId` muss dieselbe `club_id` wie das
  Kind haben, sonst 403 (P0-02-Folgeschutz).
- **Admin-Nutzerverwaltung**: Zielnutzer-ID wird geladen und geprüft,
  bevor irgendeine Mutation läuft.

## Least Privilege

- `GET /api/children` liefert Notfallkontakte nur an Personen, die das
  Kind bearbeiten dürfen oder `jugendleiter` sind - sonst `null` statt
  Klartext (s. `PRIVACY_SECURITY_GAP_ANALYSIS.md`, sechster Durchgang).
- Bewusst **keine** separaten `ChildSummary`/`ChildDetail`-Endpunkte
  eingeführt (größerer Umbau) - stattdessen Redaktion pro Element in
  derselben Liste, alle anderen Felder (Name, Gruppe, Alter) bleiben
  sichtbar (für Zuordnung/Geschwister-Verknüpfung nötig).
- **Nicht umgesetzt in diesem Durchgang**: eine tiefere Rollen-Aufteilung
  bei `GET /api/clubs/mine/members` (z.B. E-Mail/Admin-Status/Last-Login
  nur für `jugendleiter` sichtbar, nicht für `member`). Als **P2-Finding**
  dokumentiert - der aktuelle Zustand liefert diese Felder vereinsweit an
  alle Mitglieder; kein akuter Cross-Tenant- oder Datenschutz-Bruch
  (Vereinsmitglieder kennen sich i.d.R. ohnehin), aber nicht strikt
  Least-Privilege.

## CSRF

Zusätzlich zu `SameSite=Strict` prüft der Server bei
`POST`/`PUT`/`PATCH`/`DELETE` explizit `Origin` (Fallback `Sec-Fetch-Site`)
gegen den eigenen Frontend-Origin (`isSameOriginRequest()`,
`worker/src/index.ts`) - lehnt sonst mit 403 ab, bevor die Route selbst
erreicht wird. `GET`/`HEAD`/`OPTIONS` sind unbetroffen.
