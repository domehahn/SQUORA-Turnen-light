# Cloudflare IaC – Turnen-App

Terraform-Projekt für die tatsächliche Cloudflare-Infrastruktur der
Turnen-App (SQUORA). Angepasst am 2026-08-27 von einem generischen
Platzhalter-Scaffold auf die reale Architektur - siehe
`../PRIVACY_SECURITY_GAP_ANALYSIS.md` für den Hintergrund.

## Reale Architektur

```text
STRATO (nur DNS-Registrar für squora.de)
        |
        v
Cloudflare Zone squora.de (gemeinsam genutzt mit weiteren Projekten,
                            u.a. dem Referenzprojekt tournament-manager)
        |
        +-- Route squora.de/turnen-light* (in turnen/wrangler.toml)
        |         |
        |         v
        |   turnen-web (Cloudflare Worker, KEIN Cloudflare Pages)
        |     +-- Assets-Bindung: statische SPA-Dateien (dist/)
        |     +-- Service-Binding "API" -> turnen-api
        |
        +-- turnen-api (Cloudflare Worker, kein eigenes öffentliches
              Routing, nur per Service Binding erreichbar,
              workers_dev = false)
              +-- D1 "turnen-eu", jurisdiction = eu   <- HIER von Terraform verwaltet
              +-- Email-Sending-Bindung
              +-- täglicher Cron-Trigger
```

Es gibt **keine** separate `api.<domain>`-Subdomain, **kein** Cloudflare
Pages Project und **keinen** `app.<domain>`-Hostname - das war die Annahme
des ursprünglichen generischen Scaffolds, entspricht aber nicht der
tatsächlich gebauten Anwendung. Beide Worker sind im selben Cloudflare-
Account per Service Binding verbunden, nicht per HTTP/DNS.

## Warum nur D1 in Terraform?

Dieses Projekt verwaltet in Terraform **ausschließlich die D1-Datenbank**.
Alles andere - beide Worker-Skripte, die Route, die Assets-Bindung, die
Service-Bindung, die Email-Bindung, der Cron-Trigger und alle Secrets -
bleibt bei Wrangler (`turnen/wrangler.toml`, `turnen/worker/wrangler.toml`,
`wrangler deploy`).

Das ist kein Kompromiss, sondern eine bewusste, geprüfte Entscheidung:

- Der aktuelle Cloudflare-Terraform-Provider (`cloudflare/cloudflare ~> 5`)
  modelliert Worker-Code nicht mehr als einfache Datei-Referenz, sondern
  über `cloudflare_worker_version` mit einem `modules`-Attribut, das den
  kompilierten JS-Code (inkl. aller SPA-Assets für `turnen-web`) inhaltlich
  in die Ressource - und damit in den Terraform-State - einbetten würde.
  Für eine SPA mit vielen statischen Assets ist das unpraktikabel und
  würde den ohnehin schon zu schützenden State-File zusätzlich aufblähen.
- Wrangler ist genau für diesen Zweck gebaut (inkrementelle Asset-Uploads,
  Source Maps, `wrangler dev`, Secrets-Handling) und funktioniert bereits
  zuverlässig für dieses Projekt.
- Zwei Tools, die dieselbe Ressource verwalten (z. B. die Route sowohl in
  `wrangler.toml` als auch in `cloudflare_workers_route`), würden
  gegeneinander driften - bei jedem `wrangler deploy` bzw. `terraform
  apply` könnte das jeweils andere Tool die Änderung des anderen wieder
  zurücksetzen oder einen Konfliktfehler werfen.

D1 ist dagegen ideal für Terraform: die Datenbank selbst (inkl. der nach
der Erstellung nicht mehr änderbaren `jurisdiction`) ist eine langlebige,
von Wrangler nur per `database_id` *referenzierte*, nicht *erzeugte*
Ressource - keine Überschneidung, kein Konflikt.

## Bestehende Datenbank importieren

Die produktive Datenbank `turnen-eu` (`jurisdiction = eu`) existiert
bereits (angelegt am 2026-08-26 per `wrangler d1 create turnen-eu
--jurisdiction eu`, siehe `../docs/privacy/cloudflare-data-flow.md`). Sie
darf **nicht** neu erzeugt werden - das würde eine zweite, leere Datenbank
mit demselben Namen anlegen wollen bzw. einen Fehler werfen. Vor dem
ersten `apply` MUSS sie importiert werden:

```bash
export CLOUDFLARE_API_TOKEN='...'
terraform init   # oder: tofu init

terraform import cloudflare_d1_database.app \
  <account_id>/da52e146-2dde-47d9-9747-9da8cda1cfdf

terraform plan   # MUSS "No changes" zeigen, bevor irgendetwas applied wird
```

Zeigt `terraform plan` nach dem Import **irgendeine** Änderung an D1 an
(insbesondere an `jurisdiction` oder `read_replication`) - **nicht
applyen**. Das würde bedeuten, dass die hier hinterlegte Konfiguration
nicht exakt der echten Datenbank entspricht, und ein `apply` könnte ein
Replacement (= Datenverlust) auslösen.

## Voraussetzungen

- Terraform >= 1.7 (oder ein kompatibles Tool wie OpenTofu)
- Cloudflare Account ID
- Ein minimal berechtigtes Cloudflare API Token (Schreibrecht auf D1 für
  diesen Account; zusätzlich Zone-Settings-Schreibrecht für die Zone
  squora.de, aber **nur** falls `manage_zone_settings = true` genutzt wird)

## API Token

Keinen Global API Key benutzen. Token ausschließlich als
Umgebungsvariable:

```bash
export CLOUDFLARE_API_TOKEN='...'
```

## Installation (nach dem Import, s.o.)

```bash
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Danach `d1_database_id` aus `terraform output -raw d1_database_id` prüfen -
er muss weiterhin exakt mit `database_id` in
`../turnen/worker/wrangler.toml` übereinstimmen (Terraform ändert diese
Datei nicht automatisch, das bleibt manuell/per PR gepflegt, s.o.).

## Worker deployen (weiterhin über Wrangler)

```bash
cd ../turnen/worker
npm run db:migrate:remote   # falls neue Migrationen anstehen
npm run deploy

cd ../..
cd turnen
npm run build
npm run web:deploy
```

Reihenfolge wichtig: API-Worker vor Web-Worker deployen, siehe
`../README.md` im Hauptprojekt.

## Worker Secrets

Secrets **nicht** über Terraform übergeben - dort landen sie sonst im
State. `JWT_SECRET` und `ENCRYPTION_KEY` weiterhin per:

```bash
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY
```

setzen (aus `turnen/worker/`). Keine Schlüssel in Git, `terraform.tfvars`,
`wrangler.toml` oder CI-Logs.

## Zone-weite Einstellungen (`manage_zone_settings`)

**Standardmäßig deaktiviert.** `squora.de` ist eine von mehreren Projekten
gemeinsam genutzte Zone. Zone-weite Einstellungen (TLS-Minimum, 0-RTT,
Always Online) in `security.tf` wirken auf die **gesamte** Zone, nicht nur
auf `/turnen-light/`. Nur aktivieren, wenn mit den anderen Projekten auf
derselben Zone abgestimmt ist, dass dieses Repository die Quelle der
Wahrheit für diese Einstellungen sein soll.

## Terraform State

Enthält Infrastrukturmetadaten (u.a. die D1-`database_id`) und muss
trotzdem geschützt werden - nicht ins Git-Repository committen (s.
`.gitignore`). Für einen mehrköpfigen/CI-Betrieb einen verschlüsselten
Remote State mit Zugriffskontrolle verwenden.

## Nicht (mehr) enthalten

Der ursprüngliche Scaffold enthielt zusätzlich ein Cloudflare-Pages-
Project, eine Workers-Custom-Domain, einen R2-Export-Bucket und einen
eigenen Platzhalter-Worker-Quellcode - all das entsprach nicht der echten
Anwendung und wurde entfernt, statt es künstlich passend zu biegen. Sollte
künftig tatsächlich ein R2-Bucket für Exporte gebraucht werden: neu
hinzufügen, mit `jurisdiction = "eu"` von Anfang an, analog zum
D1-Vorgehen hier.

## Privacy Check

Nach `terraform apply`:

```bash
./scripts/privacy-check.sh
```

Prüft, dass D1 als EU-Jurisdiktion gemeldet wird, und sucht im echten
Worker-Quellcode (`../turnen/worker/src`) nach offensichtlichem
Health-Data-Logging.
