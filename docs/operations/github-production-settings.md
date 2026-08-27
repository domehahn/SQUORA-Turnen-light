# GitHub Production Settings — Turnen (SQUORA)

Repository: `domehahn/SQUORA-Turnen-light` (**public**, Default-Branch
`main`).

## Aktuell verifizierter Status (2026-08-27, aktiviert auf explizite Nutzerfreigabe "GO")

```
$ gh api repos/domehahn/SQUORA-Turnen-light/branches/main/protection
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "API-Worker (Typecheck, Lint, Tests)",
      "Frontend-Worker (Typecheck, Lint, Build)",
      "cloudflare-turnen-iac (fmt, validate)",
      "Security (SAST, SCA, Secret-Scan, IaC-Scan, SBOM, Production-Readiness-Check)"
    ]
  },
  "enforce_admins": { "enabled": true },
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false }
}
```

**`main` ist jetzt geschützt.** Direkte Pushes sind nicht mehr möglich -
jede Änderung braucht einen Pull Request, der erst nach grünen
`worker`/`web`/`iac`/`security`-Checks gemergt werden kann (auch für
Admins, `enforce_admins: true`). Force-Pushes und Branch-Löschung sind
blockiert.

**Wichtiger Stolperstein beim Einrichten**: die `required_status_checks.
contexts`-Einträge müssen exakt den **Anzeigenamen** der GitHub-Actions-
Jobs entsprechen (`name:`-Feld im Workflow, z.B. "API-Worker (Typecheck,
Lint, Tests)"), **nicht** den Job-IDs (`worker`, `web`, `iac`,
`security`). Ein erster Versuch mit den Job-IDs als Contexts führte dazu,
dass GitHub die - tatsächlich grünen - Checks nie als "erfüllt" erkannte
(`app_id: null` in der API-Antwort statt der echten GitHub-Actions-
App-ID), der Merge blieb dauerhaft blockiert ("base branch policy
prohibits the merge"), obwohl alle sichtbaren Checks ✅ waren.

**`required_approving_review_count: 0`** (nicht 1) - bewusst, weil dieses
Repository nur eine Person hat und GitHub Self-Approval auf eigene PRs
nicht als gültige Review zählt. Mit einer geforderten Review wäre der
Merge-Weg für die alleinige Person faktisch komplett verschlossen
gewesen (nachträglich korrigiert, nachdem genau das erkannt wurde). Ein
PR ist trotzdem weiterhin zwingend - nur eben ohne zusätzliche
Approval-Pflicht.

## CODEOWNERS (weiterhin nicht angelegt)

```
* @domehahn
```

Bei einer Einzelperson als alleiniger Owner*in hat CODEOWNERS weiterhin
wenig praktischen Nutzen (niemand sonst könnte reviewen) - relevant erst
bei einem zweiten Mitwirkenden. Nicht angelegt.

## Aktueller Workflow für künftige Änderungen

```sh
git checkout -b <feature-branch>
# Änderungen, commit
git push -u origin <feature-branch>
gh pr create --base main --head <feature-branch> --title "..." --body "..."
# CI abwarten (gh pr checks <nr>)
gh pr merge <nr> --squash --delete-branch
```

Direktes `git push origin main` funktioniert nicht mehr (wird von GitHub
mit "protected branch hook declined" abgelehnt).

## Production Gate: GESCHLOSSEN

War zuvor ein offenes P1-Finding (`main` ungeschützt, ungeprüfter Code
konnte direkt in Production-relevanten Code gelangen). Seit 2026-08-27
geschlossen.
