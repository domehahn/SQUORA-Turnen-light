# Authentication — Turnen (SQUORA)

Orientiert an OWASP Authentication Cheat Sheet, OWASP Forgot Password
Cheat Sheet, NIST SP 800-63B.

## Passwort-Hashing

PBKDF2-HMAC-SHA256, 100.000 Iterationen (die von der Cloudflare-Workers-
Laufzeit `workerd` unterstützte Obergrenze - ein Versuch, auf 600.000
Iterationen nach OWASP-Empfehlung zu erhöhen, führte in Produktion zu
`NotSupportedError` bei jedem Login mit transparentem Rehashing, s.
`PRIVACY_SECURITY_GAP_ANALYSIS.md`, Vorfall vom 27.08.2026). Zufälliges
16-Byte-Salt pro Nutzer, `password_iterations` pro Zeile gespeichert
(nicht global), transparentes Rehashing bei erfolgreichem Login, falls die
gespeicherte Iterationszahl unter der aktuellen liegt.

## Passwort-Policy

Mindestlänge 15 Zeichen für **neu gesetzte** Passwörter (Registrierung,
Änderung, Reset, Admin-Reset) - s. `PRODUCTION_READINESS_ANALYSIS.md`,
P1-05. Keine Komplexitätsregeln, kein erzwungener regelmäßiger Wechsel,
Passphrases ausdrücklich zulässig (NIST SP 800-63B). HIBP-Prüfung
(k-Anonymity, `isPasswordPwned()`) bei jedem neuen Passwort. Bestandsaccounts
mit kürzerem Passwort bleiben einloggbar - keine rückwirkende Aussperrung.

## MFA (TOTP)

Eigene RFC-6238-Implementierung (`worker/src/totp.ts`, native WebCrypto
HMAC-SHA1, keine externe Bibliothek). QR-Code über die `qrcode`-npm-
Bibliothek, clientseitig gerendert. 8 Backup-Codes pro Einrichtung
(einmal verwendbar, separate PBKDF2-Iterationskonstante, entkoppelt von
der Passwort-Iterationszahl - Backup-Codes sind hochentropische
Zufallswerte, ihre Sicherheit kommt aus der Entropie, nicht aus
PBKDF2-Kosten).

**Setup/Rotation-Invariante** (s. P1-01 in `PRODUCTION_READINESS_ANALYSIS.md`,
der schwerwiegendste Neufund dieses Durchgangs): ein Setup-Aufruf schreibt
nur `pending_totp_secret`, nie direkt die aktive `totp_secret`-Spalte.
Erst eine erfolgreiche Code-Bestätigung wechselt atomar. Initial-Setup
verlangt Passwort-Reauth; eine Rotation bei bereits aktiver MFA verlangt
zusätzlich den aktuellen TOTP-/Backup-Code. Ein fehlgeschlagener
Rotationsversuch lässt die alte, funktionierende MFA unangetastet.

**Pflicht vs. Opt-in**: Platform-Admin (`is_admin`) - **verpflichtend**,
serverseitig durchgesetzt (`requireAuth`, Positivliste an Ausnahme-Pfaden
für Selbst-Einrichtung/Abmelden). `member`/`jugendleiter` - **Opt-in**,
explizite Produktentscheidung (mehrfach im Gap-Analysis-Dokument
bestätigt). Bewertung für eine strenge Security-Prüfung: Opt-in-MFA für
diese beiden Rollen ist ein **akzeptiertes Restrisiko**, nicht "Best
Practice vollständig erfüllt" - die Mindest-Passwortlänge (s.o.) ist die
kompensierende Kontrolle.

## Passwort-Reset (Forgot Password)

- Generische Antwort, unabhängig davon, ob die E-Mail-Adresse existiert
  (keine Account-Enumeration).
- Signierter JWT-Token mit `jti`, 30 Minuten gültig.
- Einmaligkeit über `used_password_reset_tokens` (PRIMARY KEY auf `jti`,
  atomarer Insert-Gate - zwei parallele Requests: höchstens einer
  erfolgreich).
- **Verbrauchsreihenfolge korrigiert** (P1-03): der Token wird erst
  konsumiert, nachdem Signatur, Ablauf, Nutzer-Existenz, Passwort-Syntax
  und HIBP-Prüfung erfolgreich waren - ein abgelehntes Passwort verbrennt
  den Link nicht mehr.
- **Rate Limiting** (P1-04, Migration 0042): kombiniert E-Mail (5/15min)
  und IP (20/15min), immer dieselbe generische Antwort.
- Alle Sitzungen der Person werden nach erfolgreichem Reset widerrufen
  (Recovery-Charakter, kein "aktuelle Sitzung ausnehmen" - der Endpunkt
  ist unauthentifiziert).

**Nicht umgesetzt in diesem Durchgang** (aus der ursprünglichen Anfrage,
P1 "TOKEN URL"): `Referrer-Policy: no-referrer` auf der Reset-Seite,
Entfernen des Tokens aus der sichtbaren URL nach dem ersten Lesen
(`history.replaceState`). Als **offenes P2-Finding** dokumentiert - die
bestehende globale `Referrer-Policy: strict-origin-when-cross-origin`
(s. CSP-Header in `web-router.ts`) deckt den Cross-Origin-Fall bereits
ab (kein Token-Leak an fremde Origins über den Referer), die zusätzliche
Härtung (URL-History-Bereinigung) wurde in diesem Durchgang aus Zeitgründen
nicht mehr umgesetzt.

## Admin-Passwort-Reset

`PUT /api/admin/users/:id/password` widerruft seit diesem Durchgang **alle**
Sitzungen der Zielperson (P1-02) - vorher fehlte das komplett, ein
Admin-Reset sicherte ein kompromittiertes Konto also nicht wirklich ab.
`must_change_password` wird gesetzt (die Admin-Person kennt das neue
Passwort). Audit-Log-Eintrag `admin.user_password_reset`, niemals das
Passwort selbst.

## Erzwungener Passwortwechsel

`users.must_change_password` (Migration 0040) - gesetzt bei jedem
admin-vergebenen initialen/zurückgesetzten Passwort
(`scripts/create-admin.mjs`, `POST /api/admin/users`,
`PUT /api/admin/users/:id/password`). Serverseitig durchgesetzt
(`requireAuth`, Positivliste), blockierendes Frontend-Overlay
(`PasswordChangeRequiredOverlay.tsx`). Zurückgesetzt bei jedem selbst
gewählten neuen Passwort, **nicht** beim transparenten PBKDF2-Rehashing.
