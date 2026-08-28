/**
/**
 * Hilfsklasse zur Generierung von WhatsApp Click-to-Chat-Links (wa.me)
 * für den Elternkontakt.
 */

export function sanitizePhoneNumber(phone: string): string {
  // Entferne alle Nicht-Ziffern ausser ein führendes Plus
  let cleaned = phone.trim().replace(/[^\d+]/g, "");

  if (cleaned.startsWith("+")) {
    return cleaned.slice(1);
  }

  // Wenn Nummer mit deutscher 0 beginnt (z. B. 01701234567 -> 491701234567)
  if (cleaned.startsWith("0")) {
    return "49" + cleaned.slice(1);
  }

  return cleaned;
}

export function buildDropoutWhatsAppUrl(input: {
  phone: string;
  childFirstName: string;
  contactName?: string | null;
  quote?: number | null;
}): string {
  const cleanNumber = sanitizePhoneNumber(input.phone);
  const greeting = input.contactName ? `Hallo ${input.contactName}` : "Hallo";
  const quoteText = input.quote !== undefined && input.quote !== null ? ` (Anwesenheit: ${input.quote}%)` : "";

  const text = `${greeting}, ich melde mich vom Turnverein bezüglich ${input.childFirstName}. Wir haben bemerkt, dass ${input.childFirstName} in letzter Zeit seltener beim Turnen war${quoteText}. Wir wollten kurz nachhören, ob ${input.childFirstName} weiterhin zum Training kommt oder abgemeldet werden soll? Liebe Grüße!`;

  return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(text)}`;
}
