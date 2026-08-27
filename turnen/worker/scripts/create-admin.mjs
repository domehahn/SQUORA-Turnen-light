// Erzeugt einen Login-Nutzer für die Turnen-App und gibt das fertige
// INSERT-Statement aus, das per `wrangler d1 execute` ausgeführt werden kann.
//
// Verwendung:
//   node scripts/create-admin.mjs admin@example.com ["Vorname Nachname"]
// Das Passwort wird interaktiv abgefragt (nicht als CLI-Argument) - ein
// Passwort als Kommandozeilenargument landet sonst in der Shell-History
// bzw. ist über die Prozessliste anderer Nutzer*innen desselben Systems
// einsehbar (Fund aus der externen Production-Readiness-Prüfung 2026-08-27).

import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const [, , email, name] = process.argv;

if (!email) {
  console.error('Nutzung: node scripts/create-admin.mjs <email> ["Anzeigename"]');
  console.error("Das Passwort wird danach interaktiv abgefragt.");
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
// readline hat keine eingebaute Passwort-Maskierung - für ein einmaliges
// lokales Setup-Skript (kein Produktions-Login-Formular) ausreichend, aber
// bewusst nicht mit "sichtbarer Eingabe für ein echtes UI" verwechseln.
const password = await rl.question("Passwort (mind. 8 Zeichen): ");
rl.close();

if (password.length < 8) {
  console.error("Passwort muss mindestens 8 Zeichen lang sein.");
  process.exit(1);
}

// Muss mit CURRENT_PBKDF2_ITERATIONS in worker/src/auth.ts übereinstimmen
// (Passwort-Hashing-Härtung) - dieses Skript kann dessen TS-Export nicht
// direkt importieren, deshalb hier als eigene Konstante dupliziert.
const PBKDF2_ITERATIONS = 600_000;

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
const id = randomUUID();
const normalizedEmail = email.trim().toLowerCase();
const displayName = name ? name.trim() : null;

function sqlString(value) {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

const sql = `INSERT INTO users (id, email, name, password_hash, password_salt, password_iterations) VALUES (${sqlString(id)}, ${sqlString(normalizedEmail)}, ${sqlString(displayName)}, ${sqlString(hash.toString("hex"))}, ${sqlString(salt.toString("hex"))}, ${PBKDF2_ITERATIONS});`;

console.log("\nFühre dieses Kommando aus, um den Nutzer anzulegen:\n");
console.log(`wrangler d1 execute DB --local --command "${sql.replace(/"/g, '\\"')}"`);
console.log(`wrangler d1 execute DB --remote --command "${sql.replace(/"/g, '\\"')}"`);
