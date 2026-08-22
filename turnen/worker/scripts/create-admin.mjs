// Erzeugt einen Login-Nutzer für die Turnen-App und gibt das fertige
// INSERT-Statement aus, das per `wrangler d1 execute` ausgeführt werden kann.
//
// Verwendung:
//   node scripts/create-admin.mjs admin@example.com "MeinSicheresPasswort" "Vorname Nachname"
//
// Danach das ausgegebene Kommando einmalig laufen lassen, z.B.:
//   wrangler d1 execute turnen --remote --command "INSERT INTO users ..."
// oder --local für die lokale Dev-Datenbank.

import { randomBytes, randomUUID, pbkdf2Sync } from "node:crypto";

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error('Nutzung: node scripts/create-admin.mjs <email> <passwort> ["Anzeigename"]');
  process.exit(1);
}

if (password.length < 8) {
  console.error("Passwort muss mindestens 8 Zeichen lang sein.");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
const id = randomUUID();
const normalizedEmail = email.trim().toLowerCase();
const displayName = name ? name.trim() : null;

function sqlString(value) {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

const sql = `INSERT INTO users (id, email, name, password_hash, password_salt) VALUES (${sqlString(id)}, ${sqlString(normalizedEmail)}, ${sqlString(displayName)}, ${sqlString(hash.toString("hex"))}, ${sqlString(salt.toString("hex"))});`;

console.log("Führe dieses Kommando aus, um den Nutzer anzulegen:\n");
console.log(`wrangler d1 execute turnen --local --command "${sql.replace(/"/g, '\\"')}"`);
console.log(`wrangler d1 execute turnen --remote --command "${sql.replace(/"/g, '\\"')}"`);
