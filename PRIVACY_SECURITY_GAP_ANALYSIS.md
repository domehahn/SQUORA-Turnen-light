# Privacy & Security Gap Analysis — Turnen (SQUORA)

Stand: 2026-08-26. Diese Analyse deckt den vollständigen aktuellen Code ab
(`turnen/worker/src` Backend, `turnen/src` Frontend, `turnen/worker/migrations`
Schema). Sie ist die Grundlage für den Umsetzungsplan; **es wurden noch keine
Code-Änderungen vorgenommen.** Rechtliche/organisatorische Entscheidungen sind
mit `LEGAL/PRIVACY REVIEW REQUIRED` markiert und wurden nicht erfunden.

Begleitdokumente:
- `docs/privacy/cloudflare-data-flow.md` — Cloudflare-Infrastruktur im Detail (D1-Jurisdiktion, Worker-Verarbeitungsort, Email Service, Cache)
- `docs/security/cloudflare-security.md` — Sicherheitssicht auf dieselbe Infrastruktur
- `docs/security/cloudflare-production-checklist.md` — Deploy-Checkliste
- `scripts/privacy-check.ts` — automatisiertes, lesendes Prüfskript (getestet, siehe unten)
- weitere `docs/privacy/*.md` gemäß Abschnitt 22 der Anfrage (Data Inventory, Data Flow, TOMs, Retention, Consent, Data Subject Rights, Third Parties, DPIA-Entwurf) sowie `docs/security/threat-model.md` und `docs/security/privacy-incident-response.md`

## Nachtrag: Externe Production-Readiness-Prüfung (2026-08-27)

Eine externe Prüfung des damaligen Stands (Commit `8b0f06d`) kam zum Ergebnis
**"NO-GO für uneingeschränkten Produktivbetrieb"** wegen eines Cross-Tenant-
Fehlers (P0) sowie mehrerer Production-Blocker. Diese Session hat daraufhin
behoben:

- **SEC-13 (P0, Cross-Tenant-Isolation bei gruppenlosen Kindern)** — siehe
  Finding unten. Der schwerwiegendste Fund, vollständig behoben inkl.
  Schema-Änderung, Backfill und 4 neuen Tests.
- **SEC-14 (BOLA bei der Anwesenheitserfassung)** — siehe Finding unten.
- MFA-Einrichtung um QR-Code ergänzt (`qrcode`-Paket, clientseitig).
- `db:migrate:remote`/`create-admin.mjs` zeigten noch auf den alten,
  gelöschten DB-Namen `turnen` statt `turnen-eu` - auf den stabilen
  Binding-Namen `DB` umgestellt; `create-admin.mjs` fragt das Passwort
  jetzt interaktiv ab statt es als CLI-Argument zu nehmen.

**In einem zweiten Durchgang zusätzlich umgesetzt** (2026-08-27, nach
expliziter Nutzerbestätigung für das volle Session-Management-Paket
inkl. Architekturumstellung):

- **SEC-15 (Passwort-Reset-Token-Einmaligkeit)** — behoben, siehe Finding unten.
- **SEC-04/Session-Management vollständig umgebaut**: `localStorage`-JWT →
  HttpOnly/Secure/SameSite=Strict-Cookie, serverseitige `sessions`-Tabelle,
  5 Minuten Idle-Timeout + 8 Stunden absolutes Maximum (beides
  serverseitig geprüft), Widerruf bei Passwortänderung/-Reset/MFA-
  Deaktivierung, neuer Self-Service-Endpunkt "alle anderen Geräte
  abmelden". Live gegen die Produktion end-to-end verifiziert (Login,
  Cookie-Attribute, `/api/me`, Logout) mit einem danach wieder gelöschten
  Testaccount.
- **SEC-16 (`workers_dev` deaktiviert)** — nur für den API-Worker (siehe
  Finding: Web-Worker-Erreichbarkeit ist laut README bewusst gewollt).
- **SEC-17 (CSP + HSTS)** — behoben.
- E-Mail-Änderung am eigenen Profil verlangt jetzt Step-up
  (aktuelles Passwort) - vorher ungeschützt trotz E-Mail = Login-Name.

**Nachtrag (2026-08-27, dritter Durchgang):** Auf explizite Nutzerbestätigung
("go for it") zusätzlich umgesetzt:

- ~~SEC-18 (MFA API-seitige Durchsetzung)~~ — **zurückgenommen** (2026-08-27, vierter Durchgang): auf explizite Nutzeranweisung ("Mache MFA nicht verpflichtend, sondern dass dies jeweils aktiv aktiviert werden muss") wieder auf reines Opt-in umgestellt. `requireAuth` erzwingt keine MFA mehr für irgendeine Rolle, das blockierende Frontend-Overlay (`MfaEnforcementOverlay.tsx`) wurde entfernt, `GET /api/me` liefert kein `mfaSetupRequired` mehr. Die zuvor angepassten Tests wurden zurückgebaut (kein `enableMfaForTest()`-Zwang mehr in den Autorisierungstests), ein neuer Test bestätigt stattdessen ausdrücklich, dass Admin-Routen auch ohne aktivierte MFA erreichbar bleiben.
- ~~SEC-19 (PBKDF2-Iterationen)~~ — **teilweise zurückgenommen** (2026-08-27, fünfter Durchgang): ursprünglich von global 100.000 auf 600.000 (OWASP-Empfehlung) angehoben, mit `password_iterations` pro Nutzer (`users.password_iterations`, Migration 0038). In Produktion stellte sich heraus, dass die Cloudflare-Workers-Runtime (`workerd`) `crypto.subtle.deriveBits` mit PBKDF2 oberhalb von 100.000 Iterationen mit `NotSupportedError: iteration counts above 100000 are not supported` ablehnt - jeder Login mit transparentem Rehashing (also praktisch jeder Bestandsaccount) endete in einem 500er und sperrte die Person faktisch aus. `CURRENT_PBKDF2_ITERATIONS` deshalb wieder auf 100.000 (die von der Laufzeit unterstützte Obergrenze) gesetzt und neu deployt. Die Infrastruktur (pro-Nutzer-Iterationszahl, transparentes Rehashing) bleibt bestehen und funktioniert weiter, greift aktuell aber nicht, weil Ziel- und Bestandswert identisch sind - ließe sich nutzen, falls workerd künftig höhere Werte erlaubt oder auf einen anderen KDF (z. B. Argon2id über eine externe Bibliothek) umgestellt wird. MFA-Backup-Codes weiterhin auf einer eigenen, stabilen Konstante (100.000) - unverändert vom Vorfall betroffen. Tests entsprechend angepasst (Legacy-Test nutzt jetzt einen künstlich niedrigeren Wert, um den Rehashing-Mechanismus selbst zu prüfen, unabhängig vom aktuell gültigen Zielwert).
- **SEC-20 (CI-Pipeline)**: `.github/workflows/ci.yml` - läuft bei jedem Push/PR auf main, je ein Job für API-Worker (Typecheck, Lint, 43 Tests) und Frontend-Worker (Lint, Typecheck, Build). Deckte sofort eine echte Lücke auf: `oxlint` war im Worker-Paket nie als Dependency deklariert, lief bisher nur dank einer lokal auflösbaren `npx`-Version - im CI-Runner schlug der erste Durchlauf entsprechend fehl, gefixt durch Nachtragen als devDependency. **Branch Protection bewusst NICHT aktiviert** - Nutzerentscheidung: CI-Status soll nur sichtbar sein, `main` bleibt für direkte Pushes offen (kein PR-Zwang), um den etablierten Arbeitsablauf dieser Session nicht zu brechen.

**Nachtrag (2026-08-27, sechster Durchgang):** Zweite externe Prüfung des
Stands nach Commit `171d16a` (CI grün) kam zum Ergebnis "noch kein
Production-Go" wegen zwei neuer Findings + mehrerer P1s. Auf Bestätigung
umgesetzt:

- 🔴 **"5-Minuten-Idle-Timeout funktioniert real nicht"**: Backend-Logik war
  korrekt, aber die Benachrichtigungsglocke pollt alle 60s
  `GET /api/notifications` im Hintergrund, solange der Tab offen ist - jeder
  Poll hat `last_activity_at` mit-aktualisiert und damit den Idle-Timeout
  faktisch wirkungslos gemacht (Session blieb beliebig lange "aktiv", auch
  wenn niemand am Gerät saß). Fix: `requireAuth` nimmt `GET /api/notifications`
  jetzt explizit von der Aktivitäts-Aktualisierung aus (`isIdleExempt()`,
  `worker/src/index.ts`) - der Idle-Timeout selbst prüft weiterhin gegen die
  letzte ECHTE Aktivität. Neuer Test reproduziert exakt das gemeldete
  Szenario (wiederholtes Polling hält die Sitzung nicht künstlich am Leben).
- 🔴 **Zweite Cross-Tenant-Lücke bei `families`**: `families` hatte keine
  eigene `club_id`, die Mandantengrenze wurde dynamisch über
  `created_by -> user.club_id` berechnet - wechselt die anlegende Person den
  Verein, wäre die Familie (und darüber querverfügbare Notfallkontakte
  verknüpfter Kinder) logisch mitgewandert. Fix (Migration 0039):
  `families.club_id` fest beim Anlegen gesetzt, nicht mehr aus dem aktuellen
  Konto der anlegenden Person abgeleitet; Backfill für die 3 produktiven
  Bestandsfamilien anhand ihrer verknüpften Kinder bzw. ersatzweise des
  aktuellen Vereins der anlegenden Person. Cross-Tenant-Verknüpfung von Kind
  und Familie (`familyId` beim Anlegen/Bearbeiten eines Kindes sowie
  `PUT /api/children/:id/family`) wird jetzt serverseitig gegen `club_id`
  geprüft und abgelehnt. 4 neue Tests in `tenant-isolation.test.ts`.
- 🟠 **Least Privilege bei Notfallkontakten**: `GET /api/children` lieferte
  bisher für JEDES vereinsweit sichtbare Kind auch die entschlüsselten
  Notfallkontakte, unabhängig davon, ob die anfragende Person eine Beziehung
  zur jeweiligen Gruppe hat. Fix: Notfallkontakte werden jetzt nur noch
  ausgeliefert, wenn die Person das Kind bearbeiten darf (eigene/Mit-
  Trainer*innen-Gruppe) oder Jugendleitung ist (braucht den vereinsweiten
  Überblick tatsächlich) - sonst `null` statt Klartext. Bewusst keine
  separaten `ChildSummary`/`ChildDetail`-Endpunkte (größerer Umbau), sondern
  Redaktion pro Element in derselben Liste - alle anderen Felder (Name,
  Gruppe, Alter) bleiben unverändert sichtbar. 3 neue Tests.
- 🟠 **CSRF Defense-in-Depth**: zusätzlich zu `SameSite=Strict` prüft der
  Server jetzt bei `POST`/`PUT`/`DELETE`/`PATCH` explizit `Origin` (Fallback
  `Sec-Fetch-Site`) gegen den eigenen Frontend-Origin, lehnt sonst mit 403 ab
  (`worker/src/index.ts`, `isSameOriginRequest()`). 4 neue Tests.
- 🔴 **Web-Worker weiterhin über `workers.dev` erreichbar**: `workers_dev`
  stand beim Web-Worker (anders als beim API-Worker) noch auf `true`, dazu
  waren Preview-URLs aktiv. Fix: `workers_dev = false` und
  `preview_urls = false` in `turnen/wrangler.toml`, deployt und verifiziert
  (die `workers.dev`-URL ist jetzt nicht mehr erreichbar).
- 🔴 **Retention produktiv aktiviert**: `ARCHIVED_CHILD_RETENTION_DAYS` war
  im Code fertig (s. PRIV-05), in Produktion aber bewusst nicht gesetzt.
  Nutzerentscheidung: 1095 Tage (3 Jahre). Zusätzlich neuer täglicher
  Cleanup für die Security-Tabellen (`sessions`, `login_attempts`,
  `used_password_reset_tokens`), die bisher unbegrenzt wuchsen -
  `SECURITY_LOG_RETENTION_DAYS = 90` (Nutzerentscheidung), abgelaufene/
  widerrufene Sessions werden unabhängig davon sofort entfernt.

**Nachtrag (2026-08-27, siebter Durchgang):** ~~SEC-18 (MFA API-seitige
Durchsetzung)~~ **erneut eingeführt, diesmal dauerhaft gewollt und bewusst
enger gefasst** - Nutzeranweisung "admin muss doch MFA zwingend haben" nach
Rückfrage, für welche Rolle(n): **nur Platform-Admin (`is_admin`), nicht
Jugendleitung.** Anders als beim ersten Durchgang (SEC-18, zurückgenommen
über Commit `971993e`) gilt der Zwang jetzt also nur für die höchste
Zugriffsstufe (vereinsübergreifend), nicht für Jugendleitung (bleibt
weiterhin Opt-in). Umsetzung analog zum ursprünglichen SEC-18:
`requireAuth` blockiert `is_admin`-Accounts ohne aktivierte MFA serverseitig
für alle Routen außer einer Positivliste (`/api/me`, `/api/logout`,
`/api/me/mfa*`, `/api/me/sessions*`, `/api/me/password`), `GET /api/me`
liefert wieder `mfaSetupRequired`, `MfaEnforcementOverlay.tsx` (blockierendes
Setup-Overlay) aus der Git-Historie wiederhergestellt und auf die neue
Formulierung ("Admin-Accounts" statt "Jugendleitung/Admin") angepasst.
Vor dem Deploy geprüft: der einzige produktive Admin-Account hatte MFA
bereits aktiv, kein Lockout-Risiko. 4 neue Tests in `mfa.test.ts`, 2
bestehende Admin-Tests in `authorization.test.ts` angepasst (MFA vorab
einrichten bzw. die erwartete Blockade prüfen statt sie zu umgehen).

**Bewusst weiterhin NICHT umgesetzt (unverändert seit dem letzten Durchgang):**

- **Eigene Origin (`turnen.squora.de` statt `squora.de/turnen-light`)** -
  auf Nutzerentscheidung (2026-08-27) explizit zurückgestellt: eine echte
  DNS-/Zonen-Änderung mit Abstimmungsbedarf mit anderen Projekten auf
  derselben Zone, kein reiner Code-Fix. Bleibt ein offenes P1.
- **MFA-Zwang für Jugendleitung** - weiterhin bewusst Opt-in (nur
  Platform-Admin ist verpflichtend, s. Nachtrag oben). Bei einer strengen
  Security-Bewertung für Jugendleitung als **akzeptiertes Restrisiko** zu
  dokumentieren, nicht als "Best Practice erfüllt".
- **Branch Protection / Required Status Checks** - unverändert bewusst
  nicht aktiviert (Nutzerentscheidung: `main` bleibt für direkte Pushes
  offen).
- **SAST/SCA/Secret-Scan, Action-SHA-Pinning, SBOM** - nicht umgesetzt.
- **Remote-State-Backend für Terraform/OpenTofu** - State liegt weiterhin
  lokal.
- Backup/Restore-Test (Recovery-Drill, RPO/RTO-Definition), externer
  Pentest, DAST, strukturiertes Betriebsmonitoring/Alerting -
  organisatorische Prozesse, nicht code-seitig lösbar ohne dedizierte
  Tools/Beauftragung.

Diese Punkte bleiben **offen und sind nicht vergessen** - sie sind bewusst
zurückgestellt (niedrige Priorität bzw. außerhalb des Code-Scopes), nicht
übersehen.

## Nachtrag: Gesundheitshinweise als Feature entfernt (2026-08-26)

Auf ausdrücklichen Wunsch wurde `children.health_notes` (freies Textfeld für
Allergien/Erkrankungen/Medikamente) **komplett aus der App entfernt**, statt
nur geschützt zu werden - konsequente Datenminimierung (Art. 5(1)(c) DSGVO):
Formularfeld, Datenbankspalte (Migration 0033, `DROP COLUMN`, nach Backfill
und mit vorher deployter Code-Version, die die Spalte nicht mehr braucht),
Anzeige in der Kinder-Detailansicht, Notfallliste (CSV-Export und
Druckansicht) und die entsprechende Erwähnung in Benachrichtigungs-E-Mails.
Notfallkontakte (Name/Telefon) bleiben bestehen und weiterhin verschlüsselt
(PRIV-02). Live verifiziert: API antwortet nach dem Drop weiterhin normal.

Das reduziert den Schutzbedarf der App spürbar - `children` enthält damit
keine besonderen Kategorien nach Art. 9 DSGVO mehr. **Wichtig für die
weiteren Dokumente** (`data-inventory.md`, `dpia-draft.md` etc., noch
ausstehend): Sie sollten diesen Stand (kein `health_notes` mehr) von Anfang
an berücksichtigen, nicht nachträglich korrigiert werden.

## Kontext

Die App verwaltet Kinderturngruppen für einen Verein (aktuell: TuS
Büchenbeuren) und verarbeitet u.a. Gesundheitsdaten von Kindern
(`children.health_notes`) — besondere Kategorie personenbezogener Daten nach
Art. 9 DSGVO. Betroffene sind größtenteils Kinder. Die App ist seit dieser
Session zusätzlich vereinsübergreifend (Multi-Tenancy: mehrere Vereine, neue
plattformweite Admin-Rolle), was den Schutzbedarf für Cross-Tenant-Isolation
erhöht.

Es existiert **keine automatisierte Test-Suite** (kein Test-Framework im
Repo) — alle Aussagen zu Autorisierung beruhen auf Code-Review, nicht auf
verifizierenden Tests. Das ist selbst ein Finding (siehe SEC-08).

## Findings

| # | Finding | Severity | Betroffene Komponente | Risiko | DSGVO/Security-Bezug | Empfohlene Maßnahme | Status |
|---|---|---|---|---|---|---|---|
| PRIV-01 | Gesundheitsdaten (`health_notes`) und Notfallkontakte werden per Klartext-E-Mail an die neue Gruppenleitung/den Anfragen-Empfänger verschickt (`childContactSummary()`, `worker/src/index.ts`, genutzt an zwei Stellen). | **Critical** | Worker: Notifications/E-Mail | Special-Category-Daten verlassen die App unverschlüsselt Richtung Drittanbieter (Cloudflare Email Service) und landen dauerhaft im Postfach/Client des Empfängers, außerhalb der Kontrolle der App. | Art. 9, Art. 5(1)(f) Integrität/Vertraulichkeit | `notifyUser()` um separates `emailBody` erweitert; beide Aufrufstellen verschicken jetzt nur einen Hinweistext + Link statt Gesundheitsdaten/Notfallkontakten per E-Mail. Voller Kontext bleibt im In-App-Postfach. | **Behoben** (2026-08-26) — `notifications.body` in D1 enthält weiterhin Klartext-Health-Daten (unverschlüsselt at rest), das ist PRIV-02 |
| PRIV-02 | Keine Feld-/Applikationsverschlüsselung für Gesundheits-/Notfalldaten. `children.health_notes`, `children.emergency_contact_name`, `children.emergency_contact_phone`, `children.birth_date` liegen als Klartext-`TEXT` in D1 (`migrations/0001_init.sql`, `0006_child_health_contacts.sql`). | **Critical** | D1-Schema | Bei DB-Kompromittierung/Backup-Diebstahl sind alle Gesundheitsdaten sofort lesbar. | Art. 9, Art. 32 (TOMs) | `worker/src/crypto.ts`: AES-256-GCM via native WebCrypto (kein Eigenbau-Krypto), Schlüssel als Workers Secret `ENCRYPTION_KEY` (32 Byte Hex, nicht im Repo). `health_notes`, `emergency_contact_name`, `emergency_contact_phone` werden bei jedem Schreiben verschlüsselt und beim Lesen serverseitig wieder entschlüsselt. Zusätzlich: einmaliger, idempotenter Backfill (`POST /api/admin/backfill-health-encryption`) live ausgeführt - 16 von 38 Kind-Datensätzen hatten noch Klartext, jetzt verschlüsselt; zweiter Lauf bestätigt 0 verbleibend. `birth_date` bewusst **nicht** verschlüsselt (siehe Einschränkung). | **Behoben** (2026-08-26) für die drei Felder. `birth_date` bleibt Klartext (wird SQL-seitig/in Altersberechnungen an vielen Stellen verwendet, Verschlüsselung hätte deutlich höheres Regressionsrisiko) - **LEGAL/PRIVACY REVIEW REQUIRED**, ob das akzeptabel ist |
| PRIV-03 | ~~Kein Consent-Modell.~~ **Korrigiert nach rechtlicher Nachprüfung (2026-08-26):** Für normale Vereins-/Mitgliederdaten (Name, Geburtsdatum, Gruppenzuordnung, Trainingsorganisation) ist nach Einschätzung der Datenschutzaufsicht Rheinland-Pfalz regelmäßig **keine Einwilligung erforderlich** — Art. 6 Abs. 1 lit. b (Vertragsverhältnis Vereinsmitgliedschaft) trägt die Verarbeitung. Ein Consent-Modell wäre hier eher schlechter als eine saubere vertragliche Rechtsgrundlage. Seit Entfernung von `health_notes`/`notes` (siehe unten) gibt es zudem keine laufende Art.-9-Verarbeitung mehr, die eine Einwilligung nahelegen würde. | War **High**, jetzt **niedrig/entfällt** | Gesamte App | — | Art. 6 Abs. 1 lit. b | Kein Consent-Modell bauen. Stattdessen: Rechtsgrundlagenmatrix je Datenkategorie in einem VVT dokumentieren (siehe `docs/privacy/data-inventory.md`, ausstehend) — **konkrete Freigabe der Matrix je Verein: LEGAL/PRIVACY REVIEW REQUIRED.** | **Neubewertet, kein Implementierungsbedarf** (2026-08-26) |
| PRIV-04 | ~~Kein Guardian-Entity/-Modell.~~ **Korrigiert nach rechtlicher Nachprüfung (2026-08-26):** Die DSGVO verlangt keine `Guardian`-Tabelle oder Guardian-Logins — Betroffenenrechte dürfen organisatorisch (über Turnleitung/Jugendleitung/Admin als Ansprechpartner) abgewickelt werden. `emergency_contact_name`/`_phone` als strukturierte, verschlüsselte Felder (nicht mehr Freitext, siehe PRIV-02) sind dafür ausreichend. Ein Guardian-Modell mit eigenem Login kann ein sinnvolles **Produkt-Feature** sein, ist aber **keine gesetzliche Pflicht**. | War **High**, jetzt **kein Pflicht-Finding** | Datenmodell | — | Art. 15–17 (organisatorisch erfüllbar) | Kein Umbau notwendig für DSGVO-Konformität. Falls Guardian-Self-Service als Feature gewünscht wird: separate Produktentscheidung, nicht Compliance-getrieben. | **Neubewertet, kein Implementierungsbedarf** (2026-08-26) |
| PRIV-05 | Unbegrenzte Aufbewahrung. Ausgetretene Kinder (`children.status = 'archived'`) wurden nie automatisch gelöscht/anonymisiert. Kein Retention-Job. | War **High** | D1 (children, audit_log, notifications) | Verstoß gegen Speicherbegrenzung. | Art. 5(1)(e) | **Mechanismus implementiert, Frist bewusst nicht aktiviert:** täglicher Cron-Job (`deleteStaleArchivedChildren()`, `worker/src/index.ts`, nutzt denselben `redactChildTraces()`+`deleteChild()`-Pfad wie die manuelle Löschung) löscht archivierte Kinder, sobald `Env.ARCHIVED_CHILD_RETENTION_DAYS` überschritten ist. Diese Variable ist in `wrangler.toml` **absichtlich auskommentiert** — ohne sie läuft keine automatische Löschung. **Konkrete Frist weiterhin LEGAL/PRIVACY REVIEW REQUIRED**; sobald freigegeben, genügt das Setzen der Variable (kein weiterer Code nötig). Automatisiert getestet (`worker/test/retention.test.ts`, 2 Tests: Fristfilterung, vollständige Löschung inkl. Audit-Redaction mit `actorId: null` für den systemseitigen Akteur). | **Mechanismus behoben** (2026-08-26) — Aktivierung/Frist offen |
| PRIV-07 | `children.notes` (allgemeines Freitextfeld) konnte trotz Entfernung von `health_notes` weiterhin faktisch Art.-9-Daten enthalten ("Hat Asthma", "ADHS, bitte etwas Zeit geben") - der Feldinhalt entscheidet über die Art.-9-Relevanz, nicht der Spaltenname. Fund aus der rechtlichen Nachprüfung 2026-08-26. | War **High** | `children` (Datenmodell) | Gesundheitsdaten durch die Hintertür trotz vermeintlicher Entfernung. | Art. 5(1)(c), Art. 9 | Feld komplett entfernt (analog `health_notes`): Migration 0034 (`DROP COLUMN notes`), Formular/Detailansicht im Frontend, DB/Types/Routen im Worker bereinigt. | **Behoben** (2026-08-26) |
| PRIV-06 | Löschung ist unvollständig. `DELETE /api/children/:id` löscht den `children`-Datensatz (kaskadiert `attendance_entries`, `waitlist_entries` etc. per FK), aber `audit_log.target_label` und `notifications.body` enthalten Name/Kontext des Kindes als Freitext und werden **nicht** mitgelöscht/redigiert. | **High** | Worker: `deleteChild`, Audit-Log, Notifications | Recht auf Löschung technisch nicht vollständig umsetzbar — Reste bleiben unbegrenzt bestehen. | Art. 17 | `audit_log`/`notifications` haben jetzt eine strukturierte `child_id`-Spalte (Migration 0031), an allen kindbezogenen `logAudit`/`notifyUser`-Aufrufen mitgeführt. `DELETE /api/children/:id` ruft vor der eigentlichen Löschung `redactChildTraces()` auf: `audit_log.target_label` wird anonymisiert (Eintrag bleibt für Nachvollziehbarkeit erhalten), `notifications` mit Bezug auf das Kind werden gelöscht. | **Behoben** (2026-08-26) — deckt nur Einträge ab, die die neue `child_id`-Spalte gesetzt haben; ältere Alt-Einträge (vor dieser Migration) enthalten weiterhin unstrukturierten Freitext ohne Redaction-Möglichkeit |
| SEC-01 | Kein Rate Limiting / Brute-Force-Schutz auf `POST /api/login` (`worker/src/index.ts`). Kein Lockout, kein Backoff. | **High** | Auth | Credential Stuffing / Brute Force ungebremst möglich. | Art. 32, OWASP ASVS V2.2 | Neue Tabelle `login_attempts` (Migration 0032) protokolliert jeden Versuch; ab 10 fehlgeschlagenen Versuchen je E-Mail-Adresse innerhalb von 15 Minuten wird mit HTTP 429 gesperrt (E-Mail-basiert statt IP-basiert, da Worker-Requests IPs teilen können). Live gegen die produktive API verifiziert (10× 401, dann 429). | **Behoben** (2026-08-26) |
| SEC-02 | Keine MFA — auch nicht für die plattformweite Admin-Rolle (`is_admin`) oder Jugendleitung, die vereinsübergreifenden bzw. vereinsweiten Zugriff haben. | War **High** | Auth, Admin-Rolle | Kompromittiertes Passwort = voller Zugriff. | Art. 32, OWASP ASVS V2.8 | TOTP-MFA implementiert (`worker/src/totp.ts`, RFC 6238, native WebCrypto HMAC-SHA1, kein externes Paket): Self-Service-Einrichtung in Profil inkl. QR-Code (`qrcode`-Paket) + Secret/`otpauth://`-URI zur manuellen Eingabe, Bestätigung per Code, 8 Backup-Codes einmalig angezeigt und danach nur PBKDF2-gehasht gespeichert. Login zweistufig bei aktiviertem MFA (`POST /api/login` liefert dann nur ein 5 Minuten gültiges Zwischen-Token statt einer Sitzung, `POST /api/login/mfa` prüft den Code/Backup-Code und stellt erst dann die echte Sitzung aus - eigener `typ`-Claim verhindert, dass das Zwischen-Token als volle Sitzung missbraucht wird). Deaktivieren erfordert Passwort-Bestätigung. Alles auditiert (`mfa.enabled`/`mfa.disabled`/`mfa.backup_code_used`). **Bewusst als reines Opt-in belassen, NICHT verpflichtend** (Nutzerentscheidung 2026-08-27): eine zwischenzeitlich eingeführte Durchsetzung (UI-Overlay + API-Hard-Block für Admin/Jugendleitung ohne MFA, s. Git-Historie) wurde auf ausdrücklichen Wunsch wieder zurückgenommen - MFA muss jede Person für ihren eigenen Account aktiv selbst aktivieren, keine Rolle wird dazu gezwungen. 5 automatisierte Tests (`worker/test/mfa.test.ts`). | **Behoben** (2026-08-27) — als Opt-in-Feature, bewusst nicht erzwungen |
| SEC-03 | Neue Admin-Routen (`/api/admin/*`, diese Session) protokollieren nichts in `audit_log`: Vereinswechsel, Vereins-CRUD, Nutzer-Rollen-/Vereins-/Admin-Änderungen, Passwort-Resets, Nutzer-Löschungen sind komplett unprotokolliert. | **High** | Worker: `/api/admin/*` (`index.ts`, diese Session) | Kein Audit-Trail für die mächtigsten Aktionen im System — widerspricht explizit Abschnitt 9 der Anfrage (`ROLE_CHANGE`, `PERMISSION_CHANGE`, `GUARDIAN_RELATIONSHIP_CHANGE` etc. müssen protokolliert werden). | Art. 5(2) Rechenschaftspflicht, Abschnitt 9 der Anfrage | `db.logAudit` an allen `/api/admin/*`-Mutationen ergänzt (Vereinswechsel/-Anlage/-Umbenennung/-Löschung, Nutzer-Update, Passwort-Reset, Nutzer-Löschung) - Passwörter selbst werden nie geloggt, nur "dass ein Reset stattfand". | **Behoben** (2026-08-26) |
| SEC-04 | JWT im `localStorage`, keine serverseitige Session-Invalidierung/Revocation-Liste, kein Idle-/Absolute-Timeout. | War **Medium**, dann Production-Readiness-Prüfung stufte den fehlenden Cookie-Umbau als eigenen P1-Punkt ein | Frontend Auth-Storage, Worker Auth | Gestohlenes Token blieb lange gültig, XSS könnte `localStorage` auslesen, keine Möglichkeit "alle Geräte abmelden". | Art. 32, OWASP ASVS V3, OWASP Session Management Cheat Sheet | **Vollständig umgebaut auf serverseitiges Session-Management** (2026-08-27): neue `sessions`-Tabelle (Migration 0037) statt zustandslosem JWT. Sitzung lebt in einem **HttpOnly-, Secure-, SameSite=Strict-Cookie** (`turnen_session`) statt `localStorage` - für JS (auch bei einem künftigen XSS) nicht auslesbar. Serverseitig durchgesetzt: **5 Minuten Idle-Timeout**, **8 Stunden absolutes Maximum** (beides bei jedem Request per DB-Lookup geprüft, nicht nur ein Client-Timer). Sitzungen aktiv widerrufbar: Passwortänderung/-Reset widerruft andere/alle Sitzungen, MFA-Deaktivierung widerruft andere Sitzungen, neuer Self-Service-Endpunkt "alle anderen Geräte abmelden" (`POST /api/me/sessions/revoke-all`) inkl. Sitzungsanzahl in Profil. `POST /api/logout` widerruft serverseitig statt nur den Client-Token zu löschen. Frontend komplett auf `credentials: "include"` statt Bearer-Header umgestellt, Auth-Status kommt jetzt aus `GET /api/me` statt einem client-seitig dekodierten JWT (`authChecked`-Flag verhindert Redirect-Flackern beim App-Start). 8 neue Tests (`worker/test/session-management.test.ts`: Cookie-Attribute, Logout-Widerruf, Idle-Timeout, Absolute-Timeout, Widerruf bei Passwortänderung/-Reset/"alle Geräte abmelden"). | **Vollständig behoben** (2026-08-27) |
| SEC-15 | Passwort-Reset-Token war ein reines 30-Minuten-JWT ohne Einmaligkeits-Prüfung - innerhalb der Gültigkeit theoretisch mehrfach einlösbar. Fund der externen Production-Readiness-Prüfung 2026-08-27. | War **High** | Auth | Ein abgefangener Reset-Link hätte mehrfach verwendet werden können. | OWASP Forgot Password Cheat Sheet | Jeder Token trägt jetzt eine eindeutige `jti`; `used_password_reset_tokens` (Migration 0037, PRIMARY KEY auf `jti`) verhindert ein zweites Einlösen. Zusätzlich: E-Mail-Änderung am eigenen Profil verlangt jetzt Step-up (aktuelles Passwort), vorher ungeschützt. 3 neue End-to-End-Tests über die echte Route. | **Behoben** (2026-08-27) |
| SEC-16 | Der API-Worker (`turnen-api`) war implizit über seine eigene `workers.dev`-Subdomain direkt öffentlich erreichbar, unabhängig vom Web-Worker und dessen Security-Headern/CSP. | War **Medium** | Cloudflare-Infrastruktur | Alternativer Zugriffspfad ohne CSP/Security-Header, umgeht ggf. Zone-level WAF/Cache-Rules. | Abschnitt zu Cloudflare-Konfiguration | `workers_dev = false` im API-Worker gesetzt (Service Binding funktioniert unabhängig davon weiter). Für `turnen-web` bewusst **nicht** geändert - README dokumentiert die dortige `workers.dev`-Erreichbarkeit ausdrücklich als gewollt ("bleibt zusätzlich aktiv"), das wäre eine Rücknahme einer bestehenden bewussten Entscheidung gewesen. | **Teilweise behoben** (2026-08-27) - nur API-Worker |
| SEC-17 | Keine Content-Security-Policy, kein HSTS-Header. | War **Medium** | `cloudflare/web-router.ts` | Eingeschränkter Schutz gegen XSS/Clickjacking/Protocol-Downgrade. | OWASP ASVS V14 | CSP (`script-src 'self'` ohne `unsafe-inline` - das einzige Inline-Script wurde nach `public/theme-init.js` ausgelagert; `style-src 'unsafe-inline'` bewusst beibehalten wegen echter Laufzeit-`style={{}}`-Werte in mehreren Komponenten) + `Strict-Transport-Security` ergänzt. | **Behoben** (2026-08-27) |
| SEC-05 | Service Worker cacht `GET /api/children` (inkl. `health_notes`, Notfallkontakte, Geburtsdatum) für bis zu 24h im Cache Storage des Geräts (`vite.config.ts`, `runtimeCaching`, `NetworkFirst`, `maxAgeSeconds: 60*60*24`). | War **Medium** | Frontend PWA/Service Worker | Unverschlüsselte lokale Speicherung personenbezogener Daten auf dem Gerät, auch nach Logout ggf. noch im Cache. | Art. 9, Abschnitt 7 der Anfrage | `runtimeCaching` in `vite.config.ts` komplett entfernt (entspricht `NetworkOnly` für alle `/api/*`-Aufrufe) - nur die App-Shell (JS/CSS/Icons) bleibt für Offline-Start gecacht. Zusätzlich löscht `AuthContext.signOut()` aktiv einen evtl. noch vorhandenen alten `api-cache` von vor dieser Änderung. | **Behoben** (2026-08-26) |
| SEC-06 | CSV-Exporte ("Notfallliste als CSV", `Children.tsx`) und Druckansichten (`AttendancePrint.tsx`, Modus `notfall`) enthalten Notfallkontakte als unverschlüsselte lokale Datei bzw. Druck-Vorschau ohne Nachverfolgung nach dem Download. | War **Medium** | Frontend Export/Print | Kontrollverlust über Kopien personenbezogener Daten außerhalb der App. | Art. 32, Abschnitt 13 der Anfrage | Organisatorischer Hinweis direkt im UI ergänzt (Children.tsx-Export-Buttons und AttendancePrint.tsx-Notfallmodus): "sicher verwahren, datenschutzgerecht entsorgen". Signierte/kurzlebige Export-Downloads statt direktem Client-Blob wären der nächste, größere Schritt (Abschnitt 13) - nicht umgesetzt, da eigene Architekturentscheidung (Export-Service). | **UI-Hinweis behoben** (2026-08-26); signierte Downloads weiterhin offen/Folgearbeit |
| SEC-07 | Passwort-Policy minimal: nur Mindestlänge 8 Zeichen, keine Komplexitäts-/Breach-Prüfung. Kein Self-Service-„Passwort vergessen"-Flow — Reset nur durch die Admin-Rolle. | War **Medium** | Auth | Schwache Passwörter möglich; ohne Admin war Account-Recovery blockiert. | OWASP ASVS V2.1 | Have-I-Been-Pwned-Abgleich per k-Anonymity-API (`auth.ts: isPasswordPwned()`, nur die ersten 5 Zeichen des SHA-1-Hash verlassen den Worker, lokaler Suffix-Abgleich; best effort, blockiert bei API-Ausfall nicht) an allen drei Stellen ergänzt, an denen ein Passwort gesetzt wird (`/api/me/password`, `/api/admin/users`, `/api/admin/users/:id/password`). Neuer Self-Service-Flow: `POST /api/password-reset/request` (immer identische generische Antwort, verhindert Account-Enumeration) + `POST /api/password-reset/confirm` mit 30 Minuten gültigem signiertem Token (`typ: "password_reset"`), reiner E-Mail-Versand ohne In-App-Notification-Artefakt (`sendEmailOnly()`). Neue Seite `/passwort-zuruecksetzen`, Link auf der Login-Seite. 3 neue Tests. | **Behoben** (2026-08-26) |
| SEC-08 | Keine automatisierten Tests im Repo (kein Test-Framework konfiguriert). Insbesondere keine negativen Autorisierungstests (Abschnitt 24 der Anfrage: Cross-Guardian, Cross-Coach, Cross-Club, IDOR). | **High** | Gesamtes Repo | Autorisierungs-Regressionen (in dieser Session bereits mehrfach als Bug live aufgetreten, z.B. Instant-Move-Bypass, Co-Leader-Sichtbarkeitslücke) werden nicht automatisiert erkannt. | Abschnitt 24 der Anfrage | `@cloudflare/vitest-pool-workers` eingerichtet (`worker/vitest.config.ts`, `npm run test` in `worker/`) - läuft in echtem Workers-Runtime (workerd) gegen eine isolierte, pro Testlauf frisch migrierte In-Memory-D1, keine Berührung von Produktionsdaten. 12 negative Autorisierungstests in `worker/test/authorization.test.ts`: kein Zugriff ohne/mit ungültigem Token, Rate Limiting greift, Cross-Club-Isolation (Gruppen/Kinder), IDOR bei Kind-Update/-Löschung, Privilege Escalation auf Admin-Routen, sofortiger Zugriffsverlust bei gelöschtem Account. Alle 12 grün. | **Behoben** (2026-08-26) — Grundgerüst und Kernszenarien; weitere Testfälle (Guardian-Modell sobald vorhanden, MFA sobald vorhanden) sind Folgearbeit |
| SEC-09 | Globaler Error-Handler loggt den rohen Error nach `console.error` (`worker/src/index.ts: app.onError`, `worker/src/notifications.ts`). Keine strukturierte Redaction-Schicht. | War **Medium** | Worker Logging | Potenzielles PII-Log-Leak in Cloudflare-Observability bei künftigen Fehlern, die Nutzereingaben spiegeln. | Abschnitt 10 der Anfrage | Zentrale `redactError()`-Funktion (`worker/src/log-redaction.ts`): entfernt E-Mail-Adressen/zusammenhängende Ziffernfolgen (Telefonnummern) per Regex aus Message/Stack, kürzt auf max. Länge. An beiden bestehenden `console.error`-Aufrufen (globaler Error-Handler, E-Mail-Versand-Fehler) eingebaut. Keine automatisierte Lint-Regel für künftige `console.*`-Aufrufe ergänzt (Review-Pflicht bleibt organisatorisch). | **Behoben** (2026-08-26) für bestehende Aufrufe; Lint-Durchsetzung für neue Aufrufe offen |
| SEC-10 | Keine `LOGIN`/`FAILED_LOGIN`-Events im Audit-Log. Nur `users.last_login_at` wird bei Erfolg aktualisiert (`migrations/0028`); fehlgeschlagene Logins werden gar nicht erfasst. | **Medium** | Auth/Audit | Brute-Force/Account-Takeover-Versuche sind nachträglich nicht forensisch nachvollziehbar. | Abschnitt 9 der Anfrage, Art. 32 | Zusammen mit SEC-01 gelöst: neue Tabelle `login_attempts` protokolliert jeden Login-Versuch (E-Mail, Erfolg/Misserfolg, Zeitstempel) - dient sowohl als Audit-Trail als auch als Basis für das Rate Limiting. Kein Passwort-Klartext enthalten. | **Behoben** (2026-08-26) |
| SEC-11 | GitHub Dependabot meldete 3 High-Findings (sharp/libvips CVEs, ws Memory-Exhaustion-DoS, wrangler OS-Command-Injection in `wrangler pages deploy`) - alle transitiv über den in `@cloudflare/vitest-pool-workers@0.8.71` gebündelten alten `wrangler@4.35.0` (reine Test-/Dev-Abhängigkeit, nicht Teil des deployten Workers). | War **High** (Dependabot) | `worker/package.json` (devDependencies) | Dev-/CI-lokal, nicht production-exponiert (kein `wrangler pages deploy` im Einsatz, oberflächliches `wrangler` bereits gepatcht) - dennoch geschlossen. | — | Per npm `overrides` die drei Transitiv-Pakete auf gepatchte Versionen erzwungen (`sharp` ≥0.35.0, `ws` ≥8.21.0, das gebündelte `wrangler` ≥4.59.1), ohne das API-kompatible `vitest-pool-workers@0.8.71` zu wechseln (neuere Versionen haben eine andere Config-API, siehe SEC-08-Historie). `npm audit`: 0 vulnerabilities, 14/14 Tests weiterhin grün. | **Behoben** (2026-08-26) |
| SEC-12 | Der clubbezogene Verlauf (`/verlauf`, `GET /api/audit-log`) war für alle Vereinsmitglieder sichtbar (mit Sichtfilter auf eigene Aktionen für Nicht-Jugendleitung). Nutzerentscheidung: nur die Admin-Rolle soll ihn sehen. | — (Produktentscheidung, kein Compliance-Fund) | Frontend Nav/Route, `GET /api/audit-log` | — | — | Nav-Eintrag, Seiten-Guard (`AuditLog.tsx`) und Backend-Route (`requireAdmin`) jeweils auf die Admin-Rolle beschränkt. | **Umgesetzt** (2026-08-26) |
| INFO-01 | Keine Third-Party-SDKs (kein Sentry/Firebase/Analytics/Crashlytics) im Repo (`package.json` Backend+Frontend geprüft). | Info (positiv) | — | Aktuell kein Telemetrie-Leak-Risiko über Drittanbieter. | Abschnitt 11 der Anfrage | Bei künftiger Integration: **vor** dem Einbau `beforeSend`/Redaction-Schicht verpflichtend mitliefern. | N/A |
| INFO-02 | Keine Secrets im Repository gefunden. `.dev.vars` (echtes `JWT_SECRET`) ist git-ignored, nur `.dev.vars.example` mit Platzhalter ist eingecheckt. `.env.production` enthält nur öffentliche Frontend-Build-Variablen. | Info (positiv) | — | — | Abschnitt 18 der Anfrage | Weiter so; Secret-Scanning in CI ergänzen, um das dauerhaft abzusichern (siehe SEC-08/CI-Abschnitt). | N/A |
| INFO-03 | Passwort-Hashing: PBKDF2-SHA256, zufälliges 16-Byte-Salt pro Nutzer, timing-safe Vergleich (`worker/src/auth.ts`). Kein Klartext-Passwort wird je gespeichert oder geloggt. | Info (positiv) | Auth | — | Art. 32, OWASP ASVS V2 | Erhöhung auf 600k Iterationen (SEC-19) in Produktion an einer Laufzeit-Obergrenze von workerd gescheitert (s. SEC-19) und auf 100k zurückgesetzt. Argon2id bliebe der modernste Standard und würde die 100k-Grenze umgehen, ist aber ein größerer Umbau (externe Library, kein Web-Crypto-Standardverfahren) - kein akuter Handlungsbedarf, aber nicht mehr "erledigt". | Beobachtung, offen |
| REVIEW-01 | Kein Auftragsverarbeitungsvertrag (AVV) mit Cloudflare (D1, Workers, Email Sending) dokumentiert; Verarbeitungsort/Region von D1 aus dem Code nicht verifizierbar. | — | Infrastruktur | Nicht mit Code lösbar. | Art. 28, Art. 44ff. | **LEGAL/PRIVACY REVIEW REQUIRED**: AVV abschließen, Verarbeitungsort klären, in `docs/privacy/third-parties.md` dokumentieren. | Offen |
| REVIEW-02 | Keine Datenschutzerklärung, kein Verarbeitungsverzeichnis, keine dokumentierte Rechtsgrundlage für die Verarbeitung von Kindergesundheitsdaten durch den Verein. | — | Organisatorisch | Nicht mit Code lösbar. | Art. 6, Art. 9, Art. 30 | **LEGAL/PRIVACY REVIEW REQUIRED**: mit Datenschutzbeauftragte:m des Vereins/Verbands klären. | Offen |
| **SEC-13** | **P0 — Cross-Tenant-Isolation-Fehler bei gruppenlosen Kindern.** `listChildrenForUser()` und `isChildWritable()` behandelten "Kind hat keine Gruppe" (`group_id IS NULL` - regulär z.B. bei der Vereins-Warteliste vor Gruppenzuteilung) fälschlich als "für jede*n authentifizierte*n Nutzer*in sichtbar/bearbeitbar, vereinsübergreifend" - eine als Alt-Bestand-Kompatibilität gedachte Öffnung, die auch neu angelegte Kinder ohne Gruppe traf. Fund der externen Production-Readiness-Prüfung 2026-08-27. | **War P0/Critical** | `worker/src/db.ts`, `worker/src/index.ts` | Bei mehr als einem Verein: jeder authentifizierte Nutzer konnte gruppenlose Kinder fremder Vereine sehen und bearbeiten. Zum Auffindungszeitpunkt 0 betroffene Datensätze in Produktion (1 Verein, 0 gruppenlose Kinder). | Art. 25, Art. 32 (Broken Object Level Authorization) | `children.club_id` als primäre, nicht mehr nur über die Gruppe abgeleitete Mandantengrenze eingeführt (Migration 0036, Backfill aller 38 Bestandskinder verifiziert). Wird beim Anlegen immer gesetzt (aus Zielgruppe oder Verein der anlegenden Person, `clubId` jetzt Pflichtfeld in `ChildInput`), bei Gruppenwechsel synchron mitgeführt (`moveChildToGroup()`). Sichtbarkeits-/Schreibprüfung komplett auf `club_id` umgestellt; verbleibende Kompatibilitätszweige nur noch für echten, vereinslosen Alt-Bestand (aktuell 0 Datensätze). Beim Schreiben der SQL-Query zunächst ein LEFT-JOIN-Artefakt eingebaut (NULL-Spalten aus fehlendem Gruppen-Join wurden fälschlich als "verwaiste Gruppe" gewertet) - durch den neuen Test sofort aufgefallen und vor Deployment korrigiert. 4 neue automatisierte Cross-Tenant-Tests (`worker/test/tenant-isolation.test.ts`). | **Behoben** (2026-08-27), remote migriert und deployt |
| **SEC-14** | **BOLA bei der Anwesenheitserfassung.** `PUT /api/attendance/:groupId/:date` prüfte nur, ob der Nutzer die Zielgruppe beschreiben darf, validierte aber nie, ob die im Body übermittelten `childId`-Werte tatsächlich zu dieser Gruppe gehören - ein manipulierter Request hätte Anwesenheit für ein beliebiges (auch fremdes) Kind eintragen können. `ledBy` (Übungsleiter*in) war ebenfalls nur auf UUID-Format geprüft, nicht auf Vereinszugehörigkeit. Fund der externen Production-Readiness-Prüfung 2026-08-27. | **War High** | `worker/src/index.ts` (Attendance-Route) | Anwesenheitsdaten für fremde Kinder eintragbar; beliebige User-ID als Übungsleitung zuschreibbar (Stundenerfassungs-Relevanz). | OWASP API-Security BOLA | Neue `db.listChildIdsInGroup()`: jede übermittelte `childId` wird gegen die tatsächlichen Kinder der Zielgruppe geprüft, sonst 403. `ledBy` (falls abweichend vom anfragenden Nutzer) muss zum selben Verein wie die Gruppe gehören - das Frontend erlaubt bewusst jedes Vereinsmitglied als Übungsleitung ("wer hat geleitet?"), nicht nur Besitz/Mit-Trainerschaft, die Prüfung spiegelt das. 3 neue Tests. | **Behoben** (2026-08-27) |
| **CF-01** | **`D1_DATABASE_WITHOUT_EU_JURISDICTION`** — die vorherige produktive D1-Datenbank `turnen` (`60c1750c-a2c9-4036-b217-1376ea80f216`) lief mit `jurisdiction: null`, nur `running_in_region: WEUR`. | War **High** | Cloudflare D1 (Infrastruktur) | Keine vertraglich/technisch harte EU-Datengrenze. | Art. 44ff. DSGVO | Nutzerentscheidung 2026-08-26: sofortige Migration freigegeben. Neue Datenbank `turnen-eu` mit `jurisdiction = "eu"` angelegt, Schema+Daten migriert (Zeilenzahlen aller 21 Tabellen + `PRAGMA foreign_key_check` vor Cutover verifiziert), `wrangler.toml` umgestellt, deployt, alte Datenbank inkl. Time-Travel-Historie gelöscht. Details: `docs/privacy/cloudflare-data-flow.md`. | **Behoben** (2026-08-26) |
| **CF-02** | `CLOUDFLARE_WORKER_GLOBAL_PROCESSING` — beide Worker (`turnen-web`, `turnen-api`) laufen ohne Cloudflare Regional Services/Data Localization; Anfragen (inkl. Gesundheitsdaten im Request-Body) werden am jeweils nächstgelegenen globalen Edge-Standort verarbeitet, nicht auf die EU beschränkt. | **High** (Gesundheitsdaten Minderjähriger) | Cloudflare Workers (Infrastruktur) | Verarbeitung besonderer Kategorien außerhalb der EU technisch möglich. | Art. 44ff. DSGVO | Regional Services (Business/Enterprise-Feature) aktivieren **oder** architektonisch akzeptieren, dass Health-Daten am Edge verarbeitet werden (Transit, nicht Storage) — Abwägung siehe `docs/privacy/cloudflare-data-flow.md`. **LEGAL/PRIVACY REVIEW REQUIRED.** | Nicht behoben — nur dokumentiert |
| CF-03 | Cache-Verhalten für `/api/*` ist im Worker-Code korrekt auf `Cache-Control: no-store` gesetzt (`worker/src/index.ts`, globale Middleware) — das schützt vor Caching am Origin. Ob eine dashboard-seitige Cloudflare **Cache Rule** ("Cache Everything") dies für die Zone `squora.de` überschreiben könnte, ist aus dem Repo nicht verifizierbar (Cache Rules sind kein Code-Artefakt). | Medium (Verifikationslücke) | Cloudflare Cache/CDN | Falls eine dashboard-Regel existiert, könnten API-Antworten (inkl. Gesundheitsdaten) am Edge gecacht werden, obwohl der Code das verhindern will. | Art. 32 | **VERIFY IN CLOUDFLARE DASHBOARD**: Cache Rules für `squora.de/turnen-light/api/*` prüfen, ggf. explizite „Bypass Cache"-Regel setzen. | Offen — Dashboard-Prüfung nötig |
| CF-04 | Keine R2-Buckets, KV-Namespaces, Durable Objects oder Queues im Repository konfiguriert (`turnen/wrangler.toml`, `turnen/worker/wrangler.toml` vollständig geprüft) — nur D1 + zwei Workers + Email Sending Binding. Cloudflare Pages wird **nicht** verwendet (statische Assets laufen über eine Workers-Assets-Bindung, nicht über ein separates Pages-Projekt). | Info (positiv, reduziert Angriffsfläche) | — | — | Abschnitt zu R2/KV/DO/Queues der Anfrage | Keine Maßnahme nötig, solange keines dieser Produkte eingeführt wird. Bei künftiger Einführung: EU-Jurisdiktion von Anfang an mitplanen (siehe `docs/privacy/cloudflare-data-flow.md`). | N/A |
| CF-05 | Kein Logpush, keine Workers Analytics Engine, kein Cloudflare Access, kein Turnstile im Repo konfiguriert. | Info | — | — | — | **VERIFY IN CLOUDFLARE DASHBOARD**: ob außerhalb des Repos (z.B. im Cloudflare-Dashboard) Logpush/Analytics aktiviert wurden, die Request-Metadaten (URLs, Header) exportieren könnten. | Offen — Dashboard-Prüfung nötig |

## Stand nach der rechtlichen Nachprüfung (2026-08-26)

Nach Entfernung von `health_notes` **und** `notes` verarbeitet `children`
keine besonderen Kategorien nach Art. 9 DSGVO mehr. Die App bewegt sich
damit im Wesentlichen im normalen Bereich von Vereins-/Mitgliederdaten nach
Art. 6 Abs. 1 lit. b — der ursprünglich angenommene Bedarf an einem
Consent-Modell (PRIV-03) und einem eigenen Guardian-Datenmodell (PRIV-04)
entfällt (siehe dort). Übrig sind noch:

**Behoben in dieser Session:** PRIV-01, PRIV-02, PRIV-05 (Mechanismus,
Frist offen), PRIV-06, PRIV-07, SEC-01, SEC-02 (als Opt-in, bewusst nicht
erzwungen), SEC-03, SEC-04 (teilweise), SEC-05, SEC-06 (UI-Hinweis;
signierte Downloads offen), SEC-07, SEC-08, SEC-09 (bestehende Aufrufe),
SEC-10, SEC-11, SEC-12, SEC-19, SEC-20, CF-01.

**Damit sind alle rein technisch lösbaren Findings der ursprünglichen
Gap-Analysis entweder vollständig oder im Kern behoben.** Verbleibende
technische Restarbeit (kein Blocker, kleinere Härtung):
- SEC-06: signierte/kurzlebige Export-Downloads statt direktem Client-Blob (Architekturentscheidung, größerer Umbau)
- SEC-09: Lint-Regel/Review-Pflicht für künftige neue `console.*`-Aufrufe (aktuelle Aufrufe sind bereits redigiert)
- MFA bleibt bewusst reines Opt-in (Nutzerentscheidung) - keine Rolle wird zur Aktivierung gezwungen, weder API- noch UI-seitig

**Offen, organisatorisch/rechtlich (nicht durch Code lösbar):**
- REVIEW-01 (AVV-Kette Verein → SQUORA → Cloudflare, Art. 28)
- REVIEW-02 (Datenschutzerklärung, Verzeichnis der Verarbeitungstätigkeiten nach Art. 30)
- CF-02 (Worker-Verarbeitung ohne Regional-Services-Beschränkung — Abwägung, kein reiner Code-Fix)
- DSFA-Schwellenwertprüfung dokumentieren (voraussichtlich keine volle DSFA nötig, siehe Nachprüfung)

## Nächste Schritte

1. Datenschutzerklärung (Platzhalter-Struktur, Rechtstexte als LEGAL REVIEW markiert) + Link im Login ergänzen; Art.-14-Hinweis für Notfallkontakte in den Aufnahmeprozess.
2. VVT-Entwurf (`docs/privacy/data-inventory.md`) auf Basis des tatsächlichen Codes, Rechtsgrundlagen als Vorschlag markiert.
3. Rückmeldung zu den verbleibenden `LEGAL/PRIVACY REVIEW REQUIRED`-Punkten einholen (Retention-Frist für `ARCHIVED_CHILD_RETENTION_DAYS`, AVV, Datenschutzerklärungstext) — danach genügt für die Retention das Setzen der Wrangler-Variable, kein weiterer Code.

Siehe `docs/privacy/` und `docs/security/threat-model.md` für die Detaildokumentation.
