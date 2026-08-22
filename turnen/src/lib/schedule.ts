import { isSchoolHoliday } from "./holidays";

// Bewusst NICHT toISOString() (rechnet nach UTC um - in Europe/Berlin kann
// lokale Mitternacht dadurch auf den Vortag fallen), sondern die lokalen
// Datumsanteile direkt formatieren.
function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Alle Donnerstage eines Monats (1-12) als ISO-Daten, unabhängig von Ferien. */
export function thursdaysInMonth(year: number, month: number): string[] {
  const dates: string[] = [];
  const date = new Date(year, month - 1, 1);
  // Zum ersten Donnerstag des Monats vorspulen (0=So ... 4=Do).
  const offset = (4 - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + offset);
  while (date.getMonth() === month - 1) {
    dates.push(toIso(date));
    date.setDate(date.getDate() + 7);
  }
  return dates;
}

/** Trainingstermine eines Monats: jeder Donnerstag außerhalb der RLP-Schulferien. */
export function trainingDatesInMonth(year: number, month: number): string[] {
  return thursdaysInMonth(year, month).filter((d) => !isSchoolHoliday(d));
}

/** Formatiert ein ISO-Datum als kurzes Spaltenlabel, z.B. "21.08.". */
export function formatShortDate(dateIso: string): string {
  const [, month, day] = dateIso.split("-");
  return `${day}.${month}.`;
}
