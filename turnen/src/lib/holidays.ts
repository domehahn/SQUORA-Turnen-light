import { api } from "./api";

/**
 * Schulferien Rheinland-Pfalz. Quelle: schulferien.org / schulferien.eu
 * (amtliche Angaben des Bildungsministeriums RLP), Stand August 2026.
 *
 * Rheinland-Pfalz kennt keine landesweiten Winter- oder Pfingstferien
 * (stattdessen bis zu 6 "bewegliche Ferientage" pro Schule, die hier nicht
 * abgebildet werden können, da sie je Schule unterschiedlich sind).
 *
 * Bei Bedarf für weitere Schuljahre ergänzen - jeweils Start/Ende inklusive,
 * ISO-Datum (yyyy-mm-dd).
 */
export interface HolidayRange {
  label: string;
  start: string;
  end: string;
}

export const RLP_HOLIDAYS: HolidayRange[] = [
  { label: "Herbstferien 2025", start: "2025-10-13", end: "2025-10-24" },
  { label: "Weihnachtsferien 2025/26", start: "2025-12-22", end: "2026-01-07" },
  { label: "Osterferien 2026", start: "2026-03-30", end: "2026-04-10" },
  { label: "Sommerferien 2026", start: "2026-06-29", end: "2026-08-07" },
  { label: "Herbstferien 2026", start: "2026-10-05", end: "2026-10-16" },
  { label: "Weihnachtsferien 2026/27", start: "2026-12-23", end: "2027-01-08" },
  { label: "Osterferien 2027", start: "2027-03-22", end: "2027-04-02" },
  { label: "Sommerferien 2027", start: "2027-06-28", end: "2027-08-06" },
  { label: "Herbstferien 2027", start: "2027-10-04", end: "2027-10-15" },
  { label: "Weihnachtsferien 2027/28", start: "2027-12-23", end: "2028-01-07" },
  { label: "Osterferien 2028", start: "2028-04-10", end: "2028-04-21" },
  { label: "Sommerferien 2028", start: "2028-07-03", end: "2028-08-11" },
  { label: "Herbstferien 2028", start: "2028-10-09", end: "2028-10-20" },
  { label: "Weihnachtsferien 2028/29", start: "2028-12-21", end: "2029-01-08" },
];

// Vereinsspezifische Ferien-/Ausfallzeiträume aus /api/holidays (siehe
// src/pages/admin/Club.tsx), zusätzlich zu den festen RLP_HOLIDAYS oben -
// z.B. bewegliche Ferientage oder Vereine außerhalb Rheinland-Pfalz.
//
// Bewusst als Modul-weiter Zwischenspeicher statt über Props/Context
// durchgereicht: trainingDatesInMonth/-Range in schedule.ts sind an vielen
// Stellen synchron nutzbar (u.a. in useMemo ohne await), ein vollständig
// async-fähiger Umbau aller Aufrufer wäre unverhältnismäßig aufwendig für
// eine Liste, die sich nur selten ändert. loadCustomHolidays() wird einmal
// beim Login (siehe AuthContext.tsx) sowie nach jeder Änderung auf der
// Verein-Seite neu aufgerufen.
let customHolidays: HolidayRange[] = [];

export async function loadCustomHolidays(): Promise<void> {
  try {
    const list = await api.get<{ id: string; label: string; start: string; end: string }[]>("/api/holidays");
    customHolidays = list.map((h) => ({ label: h.label, start: h.start, end: h.end }));
  } catch {
    // Kein Verein zugeordnet, nicht eingeloggt, oder Netzwerkfehler - dann
    // bleiben nur die festen RLP-Ferien wirksam.
  }
}

/** Liefert den Ferienzeitraum, in den das Datum (ISO yyyy-mm-dd) fällt, falls vorhanden. */
export function holidayFor(dateIso: string): HolidayRange | undefined {
  return (
    RLP_HOLIDAYS.find((h) => dateIso >= h.start && dateIso <= h.end) ??
    customHolidays.find((h) => dateIso >= h.start && dateIso <= h.end)
  );
}

export function isSchoolHoliday(dateIso: string): boolean {
  return holidayFor(dateIso) !== undefined;
}
