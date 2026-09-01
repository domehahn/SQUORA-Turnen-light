import { nextTrainingDates } from "./schedule";

const WEEKDAY_SHORT = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
  return `${weekday}, ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
}

// Vorgefertigte Elternnachricht für eine Trainingsabsage (Variante A: fester
// Standardtext). Der/die Trainer:in kann den Text vor dem Versenden per
// WhatsApp noch anpassen.
export function buildCancellationParentMessage(input: {
  groupName: string;
  dateIso: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  reason: string | null;
  weekday: number | null;
}): string {
  const when = formatLongDate(input.dateIso);
  const timePart =
    input.startTime && input.endTime
      ? ` (${input.startTime}–${input.endTime} Uhr${input.location ? `, ${input.location}` : ""})`
      : input.location
        ? ` (${input.location})`
        : "";

  let nextIso: string | null = null;
  if (input.weekday !== null) {
    const [y, m, d] = input.dateIso.split("-").map(Number);
    const dayAfter = new Date(y, m - 1, d + 1);
    nextIso = nextTrainingDates(input.weekday, 1, dayAfter)[0] ?? null;
  }

  const lines = [
    "Hallo zusammen,",
    "",
    `das Training der Gruppe „${input.groupName}“ am ${when}${timePart} muss leider ausfallen.`,
  ];
  if (input.reason) lines.push(`Grund: ${input.reason}`);
  if (nextIso) lines.push(`Nächster regulärer Termin: ${formatLongDate(nextIso)}.`);
  lines.push("", "Viele Grüße");
  return lines.join("\n");
}

// Öffnet WhatsApp mit vorbefülltem Text. Auf dem Handy zuerst der native
// Teilen-Dialog (WhatsApp als Ziel), sonst der wa.me-Link. In eine bestimmte
// Gruppe posten kann keine Schnittstelle - die Zielgruppe wählt der/die
// Nutzer:in im letzten Schritt selbst.
export async function shareViaWhatsApp(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // abgebrochen oder nicht unterstützt -> Fallback unten
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}
