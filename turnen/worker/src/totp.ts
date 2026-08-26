// TOTP (RFC 6238) auf Basis von HOTP (RFC 4226) - eigene, minimale
// Implementierung mit nativer WebCrypto (HMAC-SHA1), kein externes Paket.
// Grund: Finding SEC-02 (MFA für Admin/Jugendleitung), Art. 32 DSGVO -
// ein kompromittiertes Passwort allein darf für diese Rollen nicht mehr
// für vollen Zugriff auf alle Vereine/Kinder reichen.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
// Erlaubt +-1 Zeitfenster (Uhrenabweichung Client/Server), nicht mehr -
// jedes zusätzliche Fenster vergrößert das Zeitfenster für Replay/Brute-Force.
const TOTP_WINDOW = 1;

export function generateTotpSecret(): Uint8Array {
  // 20 Byte (160 Bit) - Standardlänge für HMAC-SHA1-basiertes TOTP.
  return crypto.getRandomValues(new Uint8Array(20));
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  // Counter passt in 32 Bit (bis Jahr ~2106 bei 30s-Schritten), obere 4
  // Byte bleiben 0.
  view.setUint32(4, counter, false);

  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const otp = (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
  return otp;
}

export async function generateTotp(secret: Uint8Array, timeMs = Date.now()): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

// Timing-safe String-Vergleich fuer die generierten OTP-Codes.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyTotp(secret: Uint8Array, code: string, timeMs = Date.now()): Promise<boolean> {
  const cleanCode = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const counter = Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const candidate = await hotp(secret, counter + delta);
    if (timingSafeEqual(candidate, cleanCode)) return true;
  }
  return false;
}

export function totpAuthUri(secret: Uint8Array, email: string, issuer = "SQUORA Turnen"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Backup-Codes: einmal im Klartext an den Nutzer ausgegeben, danach nur
// gehasht gespeichert (wie Passwörter) - falls das Gerät mit der
// Authenticator-App verloren geht.
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    codes.push(base32Encode(bytes).slice(0, 8));
  }
  return codes;
}
