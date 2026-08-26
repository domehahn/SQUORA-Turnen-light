# Cloudflare IaC – Turnen-App

Baseline-Infrastruktur für eine Anwendung, die personenbezogene Daten von
Minderjährigen und Gesundheitsdaten verarbeitet.

## Zielarchitektur

```text
STRATO
└── Domain-Registrar
    └── Nameserver zeigen auf Cloudflare

Cloudflare Zone / DNS
├── app.<domain>
│   └── Cloudflare Pages
└── api.<domain>
    └── Cloudflare Worker
        ├── D1: jurisdiction = eu
        └── R2 exports: jurisdiction = eu, automatische Löschung
```

## Warum Terraform + Wrangler?

Terraform verwaltet langlebige Infrastruktur:

- D1
- R2
- Cloudflare Pages Project
- DNS
- Worker-Service
- Worker Custom Domain
- TLS/HTTPS-Zoneneinstellungen

Wrangler verwaltet Worker-Code, Bindings und Secrets.

Das verhindert insbesondere, dass Verschlüsselungsschlüssel oder andere
Anwendungs-Secrets als Terraform-Variablen im Terraform-State landen.

## Voraussetzungen

- Domain bleibt bei STRATO registriert.
- Die Domain muss als Zone in Cloudflare vorhanden sein.
- Bei STRATO werden die von Cloudflare vorgegebenen autoritativen Nameserver
  für die Domain hinterlegt.
- Terraform >= 1.7
- Node.js
- Cloudflare Account ID
- Cloudflare Zone ID
- ein minimal berechtigtes Cloudflare API Token

## API Token

Keinen Global API Key benutzen.

Das Token benötigt für diese Baseline mindestens Schreibrechte für die
tatsächlich verwendeten Ressourcen, z. B.:

- D1
- R2
- Pages
- Workers Scripts
- Workers Routes / Custom Domains
- DNS
- Zone Settings

Das Token ausschließlich als Umgebungsvariable übergeben:

```bash
export CLOUDFLARE_API_TOKEN='...'
```

## Installation

```bash
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars

terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

Danach:

```bash
python3 scripts/render-wrangler.py
npm install
npm run cf:types
npm run cf:deploy:api
```

Frontend:

```bash
npm run build
npx wrangler pages deploy dist \
  --project-name="$(terraform output -raw pages_project_name)" \
  --branch=main
```

## Worker Secrets

Secrets **nicht** über Terraform übergeben.

Beispiel für einen Key für Application-/Field-Level Encryption:

```bash
openssl rand -base64 32
npx wrangler secret put FIELD_ENCRYPTION_KEY
```

Der Key muss zusätzlich außerhalb von Cloudflare in einem kontrollierten
Recovery-/Key-Management-Prozess gesichert werden.

Keine Schlüssel in:

- Git
- terraform.tfvars
- wrangler.jsonc
- Frontend Environment Variables
- CI Logs

## EU-Jurisdiction

D1 wird explizit mit:

```hcl
jurisdiction = "eu"
```

erstellt.

R2 wird ebenfalls explizit mit:

```hcl
jurisdiction = "eu"
```

erstellt.

Ein Location Hint wie `weur` ist keine gleichwertige Jurisdiction-Garantie.

WICHTIG: Bestehende D1-Datenbanken ohne Jurisdiction nicht blind ersetzen.
Ein Replacement kann Datenverlust verursachen. Erst Backup/Migrationsplan
erstellen.

## D1

`prevent_destroy = true` ist bewusst gesetzt.

Vor Datenbankmigrationen:

```bash
terraform plan
```

genau prüfen. Keine automatische Replacement-Aktion gegen Produktions-D1
freigeben.

## R2 Exporte

Der optionale Export-Bucket ist nur für kurzlebige Exporte gedacht.

Default:

```text
24 Stunden
```

Danach löscht eine R2 Lifecycle Rule die Objekte.

Der Bucket erhält keine Public-Domain-Konfiguration.

Die Anwendung sollte Downloads nur über serverseitig autorisierte Zugriffe
oder kurzlebige signierte URLs ermöglichen.

## Logging

Cloudflare Worker Observability und Logpush sind zunächst deaktiviert.

Erst aktivieren, wenn garantiert ist, dass folgende Daten niemals in Logs,
Traces oder Telemetrie gelangen:

- Name
- Geburtsdatum
- E-Mail
- Telefonnummer
- Notfallkontakte
- Allergien
- Medikamente
- Erkrankungen
- medizinische Hinweise
- Tokens/Cookies/Authorization Header

Audit Logging für fachliche Zugriffe sollte separat und payload-frei in der
Anwendung implementiert werden.

## HTTP Caching

Für alle Antworten mit personenbezogenen Daten:

```http
Cache-Control: no-store, private
```

Keine Cache Rules anlegen, die `/api`, `/health`, `/children`,
`/emergency`, `/guardian`, `/auth` oder `/exports` zwischenspeichern.

## STRATO

STRATO bleibt in diesem Design nur Registrar.

Es werden dort absichtlich keine:

- Kinderprofile
- Gesundheitsdaten
- Notfallkontakte
- Datenbankinhalte
- Backups

abgelegt.

## Terraform State

Der Terraform-State enthält Infrastrukturmetadaten und muss trotzdem geschützt
werden.

Nicht ins Git Repository committen.

Für CI/CD einen verschlüsselten Remote State mit Zugriffskontrolle verwenden,
z. B. den State-Backend-Mechanismus der eingesetzten CI/CD-Plattform oder ein
separat gebootstrapptes privates Backend.

## Noch nicht enthalten

Bewusst nicht pauschal aktiviert:

- Cloudflare KV
- global replizierte Durable Objects
- Web Analytics
- Logpush
- Zaraz
- Third-party Analytics
- Cloudflare Access für normale App-Benutzer
- Regional Services / Data Localization Suite
- WAF Managed Rules / Rate Limiting Regeln

Diese Funktionen hängen von Plan, Architektur und Anwendungslogik ab und
sollten gezielt ergänzt werden.

Für eine Anwendung mit Gesundheitsdaten von Kindern sind vor Go-live
insbesondere noch zu ergänzen:

1. Authentifizierung
2. RBAC + Object/Relationship-Level Authorization
3. Field-Level Encryption für Gesundheitsdaten
4. Consent-/Widerrufsmodell
5. Audit Events ohne Payload
6. Rate Limiting für Login/Reset/API
7. CSP und weitere Response Security Headers
8. Datenlöschung/Retention
9. Backup-/Restore-Test
10. Datenschutz-Folgenabschätzung
11. AVV/DPA und Transferprüfung für Cloudflare
12. externer Penetrationstest

## Privacy Check

Nach `terraform apply`:

```bash
./scripts/privacy-check.sh
```

Der Check stellt mindestens sicher, dass D1/R2 als EU-Jurisdiction gemeldet
werden und sucht nach offensichtlichem Health-Data-Logging im Worker-Code.

## Wichtiger Architekturhinweis

EU-Jurisdiction von D1/R2 regelt die Ausführung/Speicherung dieser jeweiligen
Datenservices. Sie bedeutet nicht automatisch, dass jeder Worker-Request
ausschließlich in der EU verarbeitet wird.

Wenn Health-Daten im Worker verarbeitet werden, muss separat geprüft werden,
ob Cloudflare Regional Services/Data Localization eingesetzt werden sollen
bzw. welche Transfermechanismen und organisatorischen Maßnahmen erforderlich
sind.
