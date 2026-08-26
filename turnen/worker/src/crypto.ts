// Application-Level-Verschlüsselung für besonders sensible Kind-Felder
// (Gesundheitshinweise, Notfallkontakte) - siehe
// PRIVACY_SECURITY_GAP_ANALYSIS.md, Finding PRIV-02.
//
// Nutzt ausschließlich die native WebCrypto-API des Workers-Runtimes
// (AES-256-GCM) - keine eigene Kryptographie-Implementierung. Der Schlüssel
// liegt als Workers Secret (ENCRYPTION_KEY, 32 Byte Hex) vor, niemals im
// Code oder in wrangler.toml.
//
// Format eines verschlüsselten Werts: "v1:<base64 iv>:<base64 ciphertext>".
// Das "v1:"-Präfix erlaubt decryptField(), zwischen bereits verschlüsselten
// Werten und historischem Klartext (Datensätze von vor dieser Umstellung)
// zu unterscheiden - letztere werden unverändert zurückgegeben, statt einen
// Fehler zu werfen. Ein Backfill bestehender Klartext-Datensätze ist ein
// bewusst separater, manuell auszulösender Schritt (siehe Gap-Analyse) -
// kein automatischer Massen-Update auf Produktionsdaten.

const ENCRYPTED_PREFIX = "v1:";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** null/leerer String bleibt null - kein Verschlüsseln von "nichts". */
export async function encryptField(plaintext: string | null, keyHex: string): Promise<string | null> {
  if (plaintext === null || plaintext === "") return null;
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Entschlüsselt einen mit encryptField() erzeugten Wert. Werte ohne das
 * "v1:"-Präfix gelten als historischer Klartext (vor Einführung der
 * Verschlüsselung) und werden unverändert zurückgegeben - so bricht nichts
 * für Bestandsdaten, bis sie beim nächsten Speichern automatisch
 * verschlüsselt werden oder ein separater Backfill läuft.
 */
export async function decryptField(value: string | null, keyHex: string): Promise<string | null> {
  if (value === null || value === "") return value;
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value; // Legacy-Klartext
  const [, ivB64, ciphertextB64] = value.split(":");
  if (!ivB64 || !ciphertextB64) return value; // Unerwartetes Format - lieber unverändert zurückgeben als crashen
  try {
    const key = await importKey(keyHex);
    const iv = fromBase64(ivB64);
    const ciphertext = fromBase64(ciphertextB64);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    // Falsches/rotiertes Schlüsselmaterial o.ä. - lieber ein sichtbares
    // Artefakt zurückgeben als einen 500er für die ganze Kinderliste.
    return "[Entschlüsselung fehlgeschlagen]";
  }
}
