# Rollback — Turnen (SQUORA)

## Worker-Code (schnell, kein Datenverlust-Risiko)

Cloudflare Workers versioniert jeden Deploy automatisch:

```sh
cd turnen/worker   # oder turnen/ für den Web-Worker
npx wrangler versions list          # Liste der letzten Versionen mit IDs
npx wrangler rollback               # Rollback auf die vorherige Version
npx wrangler rollback <VERSION_ID>  # Rollback auf eine bestimmte Version
```

Rollback ist unabhängig für API-Worker und Web-Worker - bei einem
fehlerhaften Deploy nur den betroffenen Worker zurückrollen, außer der
Fehler betrifft die Vertrag zwischen beiden (dann beide auf einen
zueinander passenden Stand bringen).

## D1-Migrationen (kein automatisches Rollback)

D1/SQLite-Migrationen sind **nicht** automatisch umkehrbar. Für jede
Migration in `turnen/worker/migrations/` sollte der Rollback-Weg beim
Schreiben der Migration mitgedacht werden (s. Kommentar-Konvention in den
bestehenden Migrationsdateien). Beispiele aus diesem Projekt:

| Migration | Rollback |
|---|---|
| `0039_families_club_id.sql` (`ADD COLUMN club_id`) | `ALTER TABLE families DROP COLUMN club_id` (D1 unterstützt `DROP COLUMN` seit neueren SQLite-Versionen) - **Datenverlust der Backfill-Zuordnung**, nur im Notfall |
| `0040_must_change_password.sql` | `ALTER TABLE users DROP COLUMN must_change_password` - unkritisch, keine Datenabhängigkeit |
| `0041_mfa_pending_secret.sql` | `ALTER TABLE users DROP COLUMN pending_totp_secret` - unkritisch, nur laufende (unbestätigte) MFA-Einrichtungen würden abgebrochen |
| `0042_password_reset_rate_limit.sql` | `DROP TABLE password_reset_requests` - unkritisch, reine Zähl-Tabelle |

**Grundsatz**: additive Migrationen (neue Spalte/Tabelle) sind risikoarm
rückrollbar. Migrationen, die bestehende Daten transformieren oder
Constraints verschärfen (z.B. eine künftige `NOT NULL`-Migration auf
`children.club_id`), brauchen eine dedizierte Rollback-Analyse **vor** der
Ausführung, nicht danach.

## D1-Daten (Point-in-Time-Recovery)

Für Datenkorruption/-verlust (nicht Schema-Rollback): Cloudflare D1 Time
Travel. Siehe `docs/operations/disaster-recovery.md` für den vollständigen
Restore-Prozess und die Warnung zu Migrations-Zustand nach einem Restore.

## Terraform/OpenTofu (IaC)

```sh
cd cloudflare-turnen-iac
tofu plan   # MUSS "No changes" oder die erwartete Änderung zeigen
```

`prevent_destroy = true` auf der D1-Ressource verhindert, dass ein
versehentliches `tofu destroy`/eine geänderte Konfiguration die
Produktionsdatenbank löscht - `tofu apply` würde in diesem Fall mit einem
Fehler abbrechen statt die Datenbank zu zerstören.

## Nach einem Rollback

- Smoke-Test wiederholen (s. `deployment.md`).
- Ursache dokumentieren, Regressionstest ergänzen, bevor erneut deployed
  wird.
