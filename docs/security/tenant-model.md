# Tenant-Modell — Turnen (SQUORA)

Ein Verein (`clubs`) ist die Mandantengrenze. Dieses Dokument listet jede
mandantenbezogene Ressource mit ihrem Tenant-Key, ihrer Elternbeziehung
und wer sie lesen/schreiben darf. Ergänzt `PRODUCTION_READINESS_ANALYSIS.md`
(P1-06, Fail-closed-Härtung).

## Grundprinzip

- Der Tenant-Key (`club_id`) wird **serverseitig** aus dem Session-Kontext
  bestimmt (`c.get("clubId")`, aus `requireAuth`/der `users`-Zeile) - nie
  blind aus Request-Body, Query-Parameter oder Frontend-State übernommen.
- Eine unbekannte/kaputte Mandantenbeziehung ist ein **Deny (403)**, nicht
  ein Allow. Kein `return true`/Fallback-Allow für Legacy-/Edge-Cases (s.
  P1-06 in `PRODUCTION_READINESS_ANALYSIS.md`).
- Rollen innerhalb eines Vereins: `member` < `jugendleiter` (vereinsweit)
  < `is_admin` (vereinsübergreifend, MFA-Pflicht).

## Ressourcen

| Resource | Tenant Key | Elternbeziehung | Read | Write |
|---|---|---|---|---|
| `clubs` | `id` (ist selbst der Tenant) | — | `is_admin` (Verwaltung) | `is_admin` |
| `users` | `club_id` (nullable nur für `is_admin` ohne Vereinszuordnung) | — | vereinsweit (`jugendleiter`), eigene Zeile (`member`) | Admin-Nutzerverwaltung, Selbstverwaltung |
| `groups` | `club_id` **NOT NULL** (verifiziert, keine NULL-Zeilen in Produktion) | `clubs.id` | Mitglieder desselben Vereins | Besitzer*in (`owner_id`), Mit-Trainer*innen, `jugendleiter` desselben Vereins |
| `children` | `club_id` **primäre Grenze** (Migration 0036) | `clubs.id`, optional `groups.id` | Mitglieder desselben Vereins (Least-Privilege-Redaktion für Notfallkontakte, s. `authorization-model.md`) | eigene Gruppe(n), Mit-Trainer*innen, `jugendleiter` |
| `families` | `club_id` **NOT NULL bei Neuanlage**, fest bei Anlage gesetzt (Migration 0039) | `clubs.id` | vereinsweit (für Geschwister-Verknüpfung) | anlegende Person (innerhalb desselben Vereins) |
| `attendance_sessions` / `attendance_entries` | über `group_id → groups.club_id` | `groups.id` | Gruppenleitung/vertretende Person | dito, BOLA-geprüft (childId muss zur Zielgruppe gehören) |
| `move_requests` | über `fromGroupId`/`toGroupId → groups.club_id` | `groups.id` | betroffene Gruppenleitungen, `jugendleiter` | `jugendleiter` (Freigabe) |
| `capacity_requests` | über `group_id → groups.club_id` | `groups.id` | dito | `jugendleiter` |
| `club_waitlist_entries` | `club_id` | `clubs.id` | `jugendleiter` | `jugendleiter` |
| `club_join_requests` | `club_id` | `clubs.id` | `jugendleiter` | `jugendleiter` |
| `notifications` | `user_id` (kein Club-Tenant, personenbezogen an den Account) | `users.id` | eigene Zeilen | eigene Zeilen |
| `audit_log` | `club_id` (nullable für systemweite Admin-Aktionen) | `clubs.id` | `jugendleiter` (eigener Verein), `is_admin` (systemweit) | nur serverseitig geschrieben, nie clientseitig |
| `sessions` | `user_id` | `users.id` | eigene Zeilen (Selbstauskunft) | serverseitig, nie clientseitig |

## Bekannte, bewusst tolerierte Grenzfälle

- `users.club_id` kann für `is_admin`-Accounts `NULL` sein (Platform-Admin
  muss keinem einzelnen Verein zugeordnet sein). Alle anderen Rollen haben
  in Produktion immer eine `club_id` (verifiziert).
- Kein Vereinswechsel-Workflow, der `club_id` auf abhängigen Ressourcen
  automatisch nachzieht - genau das war der Fehler bei `families`
  (P0-02) und wurde bewusst durch eine **feste, bei Anlage gesetzte**
  `club_id` statt einer dynamisch abgeleiteten ersetzt. Neue
  mandantenbezogene Tabellen sollten demselben Muster folgen: `club_id`
  als eigene, bei Anlage gesetzte Spalte, nicht über eine Fremdschlüssel-
  Kette zur Laufzeit berechnet.

## Datenbank-Constraints (Stand nach diesem Durchgang)

| Constraint | Wo | Zweck |
|---|---|---|
| `children.group_id REFERENCES groups(id) ON DELETE SET NULL` | Migration 0001 | Verhindert strukturell "dangling group_id" (s. P1-06) |
| `families.created_by REFERENCES users(id) ON DELETE SET NULL` | Migration 0011 | Familie überlebt Löschung der anlegenden Person |
| `sessions.user_id REFERENCES users(id) ON DELETE CASCADE` | Migration 0037 | Sitzungen verwaisen nicht bei Nutzer-Löschung |
| `used_password_reset_tokens.jti PRIMARY KEY` | Migration 0037 | Atomare Einmaligkeit (Race-Condition-sicher, s. P1-03) |

**Nicht umgesetzt in diesem Durchgang:** `children.club_id`/
`families.club_id`/`groups.club_id` sind aktuell **nullable** (kein
`NOT NULL`-Constraint auf DB-Ebene), obwohl in Produktion durchgängig
gesetzt. Eine nachträgliche `NOT NULL`-Migration wäre technisch möglich
(D1/SQLite: neue Tabelle + Kopie, da SQLite `ALTER COLUMN` nicht
unterstützt), aber ein Eingriff mit Rollback-Bedarf, der laut den
kritischen Sicherheitsregeln dieses Durchgangs vorab separat analysiert
und **nicht automatisch gegen Produktion ausgeführt** werden darf. Bleibt
als **P2-Empfehlung** offen: Anwendungsebene (fail-closed, s.o.) ist die
aktuelle Durchsetzung; eine DB-Constraint wäre Defense-in-Depth zusätzlich
dazu, kein Ersatz.
