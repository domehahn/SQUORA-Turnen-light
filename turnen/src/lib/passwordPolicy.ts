// Zentrale Passwort-Policy-Konstante für das Frontend (P1 "PASSWORD POLICY
// FRONTEND/BACKEND KONSISTENT MACHEN", zweiter Production-Readiness-
// Härtungsdurchgang 2026-08-27).
//
// Fund: JEDES Passwortfeld im Frontend zeigte/erzwang weiterhin
// `minLength={8}` und mehrere Backend-Fehlermeldungen sagten noch
// "mind. 8 Zeichen" - obwohl `validPassword()` im Worker
// (worker/src/validation.ts) seit dem vorherigen Durchgang tatsächlich 15
// Zeichen verlangt. Ergebnis: ein Passwort mit 8-14 Zeichen ließ sich im
// Browser anstandslos absenden, wurde vom Server abgelehnt, und die
// zurückgegebene bzw. clientseitig angezeigte Meldung nannte fälschlich
// "8 Zeichen" als Anforderung - widersprüchliche, verwirrende UX und ein
// direkter Verstoß gegen die eigene Policy-Konsistenz-Anforderung.
//
// Backend bleibt Authority (worker/src/validation.ts, MIN_PASSWORD_LENGTH) -
// diese Konstante ist rein für UI-Anzeige/clientseitige Vorabprüfung, kein
// Ersatz für die serverseitige Durchsetzung.
export const MIN_PASSWORD_LENGTH = 15;
export const PASSWORD_POLICY_HINT = `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen. Keine Sonderzeichen-/Zahlen-Pflicht - eine lange Passphrase ist ausreichend und empfohlen.`;
