// Parser für den Ferien-Import (siehe src/pages/admin/Club.tsx) - bewusst
// ohne externe Bibliothek, da nur die für Ferien-/Feiertagskalender übliche
// Teilmenge von ICS gebraucht wird (VEVENT mit SUMMARY/DTSTART/DTEND, meist
// ganztägige Termine). CSV als einfacher Fallback für Kalender/Tools, die
// kein ICS exportieren.

export interface ParsedHoliday {
  label: string;
  start: string;
  end: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function addDaysIso(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// "20260101", "20260101T000000Z", "20260101T000000" -> "2026-01-01".
function icsDateToIso(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function parseIcs(text: string): ParsedHoliday[] {
  // Zeilenumbrüche innerhalb eines Feldes ("folding") laut RFC5545: eine
  // Fortsetzungszeile beginnt mit Leerzeichen/Tab.
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n/);

  const events: ParsedHoliday[] = [];
  let current: Record<string, string> | null = null;
  let dtEndIsDateOnly = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "BEGIN:VEVENT") {
      current = {};
      dtEndIsDateOnly = false;
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.DTSTART) {
        const start = icsDateToIso(current.DTSTART);
        let end = current.DTEND ? icsDateToIso(current.DTEND) : start;
        if (start && end) {
          // Bei ganztägigen Terminen ist DTEND laut Spec exklusiv (der
          // Termin endet AM DTEND, nicht danach) - deshalb einen Tag abziehen.
          if (current.DTEND && dtEndIsDateOnly && end > start) end = addDaysIso(end, -1);
          events.push({ label: current.SUMMARY?.trim() || "Import", start, end });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const rawKey = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    const key = rawKey.split(";")[0];
    if (key === "DTEND") dtEndIsDateOnly = !rawKey.includes(";VALUE=DATE-TIME") && !value.includes("T");
    current[key] = value;
  }
  return events;
}

// Deutsches (TT.MM.JJJJ) oder ISO-Datum (JJJJ-MM-TT) erkennen.
function parseAnyDate(value: string): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const de = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (de) return `${de[3]}-${pad2(Number(de[1]))}-${pad2(Number(de[2]))}`;
  return null;
}

function parseCsv(text: string): ParsedHoliday[] {
  const events: ParsedHoliday[] = [];
  for (const rawLine of text.split(/\r\n|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const delimiter = line.includes(";") ? ";" : ",";
    const cols = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;
    const start = parseAnyDate(cols[1]);
    const end = parseAnyDate(cols[2]);
    if (!start || !end) continue; // z.B. Kopfzeile ohne echte Daten - überspringen
    events.push({ label: cols[0] || "Import", start, end: end >= start ? end : start });
  }
  return events;
}

export function parseHolidayFile(filename: string, text: string): ParsedHoliday[] {
  const isIcs = /\.ics$|\.ical$/i.test(filename) || text.trimStart().startsWith("BEGIN:VCALENDAR");
  return isIcs ? parseIcs(text) : parseCsv(text);
}
