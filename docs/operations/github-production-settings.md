# GitHub Production Settings — Turnen (SQUORA)

Repository: `domehahn/SQUORA-Turnen-light` (**public**, Default-Branch
`main`).

## Aktuell verifizierter Status (per `gh api`, 2026-08-27, read-only geprüft)

```
$ gh api repos/domehahn/SQUORA-Turnen-light/branches/main/protection
{"message":"Branch not protected", ...} (HTTP 404)
```

**`main` ist aktuell NICHT geschützt.** Direkte Pushes, Force-Pushes und
Branch-Löschung sind uneingeschränkt möglich. Das ist eine **explizite,
wiederholt bestätigte Nutzerentscheidung** aus früheren Durchgängen
("Nur CI-Status sichtbar machen, main bleibt offen") - diese Session
**ändert das nicht ungefragt**, da die aktuelle Anweisung selbst verbietet,
Remote-Repository-Einstellungen ohne klare Berechtigung/kontrollierte
Änderung zu verändern.

## Für einen strengen Production-Go-Live empfohlene Einstellungen

Falls die Entscheidung fällt, `main` zu schützen (erfordert erneute
explizite Nutzerfreigabe, da sie den bisherigen Direkt-Push-Workflow
bricht):

```
Require a pull request before merging
  Required approvals: 1 (empfohlen, nicht zwingend bei Einzelperson)
Require status checks to pass before merging
  Required checks: worker, web, iac, security   (die vier CI-Jobs)
  Require branches to be up to date before merging: ja
Do not allow bypassing the above settings: ja (auch für Admins)
Restrict force pushes: ja (blockieren)
Restrict deletions: ja (blockieren)
```

CLI-Befehl zum Setzen (**nicht ausgeführt** - nur dokumentiert, exakt so
auszuführen, sobald die Freigabe erteilt ist):

```sh
gh api repos/domehahn/SQUORA-Turnen-light/branches/main/protection \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=worker' \
  -f 'required_status_checks[contexts][]=web' \
  -f 'required_status_checks[contexts][]=iac' \
  -f 'required_status_checks[contexts][]=security' \
  -F 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'restrictions=null'
```

## CODEOWNERS (vorbereitet, nicht aktiv ohne Branch Protection)

Empfehlung für `.github/CODEOWNERS`, falls Pull-Request-Reviews künftig
verpflichtend werden:

```
* @domehahn
```

Bei einer Einzelperson als alleiniger Owner*in hat CODEOWNERS aktuell
wenig praktischen Nutzen (niemand sonst könnte reviewen) - relevant erst
bei einem zweiten Mitwirkenden.

## Bis zur Aktivierung

**Production Gate: OPEN** - für eine strenge Production-Bewertung ist ein
ungeschützter `main`-Branch ein P1-Finding (jede Person mit Push-Zugriff
kann ungeprüften Code direkt in Production-relevanten Code einspielen,
ohne dass CI vorher gelaufen ist - CI läuft zwar bei jedem Push, aber
**nachträglich**, nicht als Merge-Gate). Bleibt ein **manuelles Gate** in
`PRODUCTION_GO_LIVE_REPORT.md`, bis explizit freigegeben und umgesetzt.
