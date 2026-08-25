import { api } from "./api";

export interface HolidayRange {
  label: string;
  start: string;
  end: string;
}

// Ferien-/Ausfallzeiträume kommen ausschließlich aus /api/holidays (siehe
// src/pages/admin/Club.tsx - manuell angelegt oder per ICS/CSV importiert).
// Es ist bewusst nichts hier im Code hinterlegt: welche Ferien gelten,
// hängt vom Bundesland/Verein ab und ändert sich jedes Jahr - das gehört
// in die Datenbank, nicht in den Quellcode.
//
// Modul-weiter Zwischenspeicher statt über Props/Context durchgereicht:
// trainingDatesInMonth/-Range in schedule.ts sind an vielen Stellen
// synchron nutzbar (u.a. in useMemo ohne await), ein vollständig
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
    // gilt niemand als Ferien, bis der nächste Ladeversuch klappt.
  }
}

/** Liefert den Ferienzeitraum, in den das Datum (ISO yyyy-mm-dd) fällt, falls vorhanden. */
export function holidayFor(dateIso: string): HolidayRange | undefined {
  return customHolidays.find((h) => dateIso >= h.start && dateIso <= h.end);
}

export function isSchoolHoliday(dateIso: string): boolean {
  return holidayFor(dateIso) !== undefined;
}
