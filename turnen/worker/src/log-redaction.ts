// Zentrale Redaction-Schicht vor jedem Fehler-Log (Finding SEC-09, Art. 32
// DSGVO / Abschnitt 10 der ursprünglichen Anfrage). Cloudflare-Observability-
// Logs sind kein Ort für personenbezogene Daten - aktuell ist kein Fall
// bekannt, in dem eine Fehlermeldung PII spiegelt, aber strukturell nicht
// ausgeschlossen (z.B. ein künftiger Parser-Fehler, der Nutzereingaben in
// die Meldung übernimmt). Neue `console.*`-Aufrufe sollten immer über
// redactError() laufen statt den rohen Error direkt zu loggen.

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Deutsche/internationale Telefonnummern: mind. 6 zusammenhängende Ziffern
// (mit optionalen Trennzeichen) - bewusst grob, lieber einmal zu viel
// redigiert als ein Telefonnummer-Leak übersehen.
const PHONE_PATTERN = /(?:\+?\d[\d\s/-]{5,}\d)/g;

function redactString(value: string, maxLength = 500): string {
  const truncated = value.length > maxLength ? `${value.slice(0, maxLength)}…[gekürzt]` : value;
  return truncated.replace(EMAIL_PATTERN, "[E-Mail entfernt]").replace(PHONE_PATTERN, "[Zahl entfernt]");
}

/**
 * Bereitet einen Error für console.error() auf: nur Name, redigierte
 * Nachricht und redigierter Stack (kein rohes Request-Body-Echo, keine
 * unbegrenzte Länge). Nicht-Error-Werte werden defensiv zu String
 * konvertiert und ebenfalls redigiert.
 */
export function redactError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactString(error.message),
      stack: error.stack ? redactString(error.stack, 1000) : undefined,
    };
  }
  return { name: "UnknownError", message: redactString(String(error)) };
}
