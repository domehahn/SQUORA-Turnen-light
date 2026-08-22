import type { Group } from "./types";

interface BirthParts {
  year: number;
  month: number; // 1-12
  day: number;
}

function parseBirthDate(birthDate: string): BirthParts {
  const [year, month, day] = birthDate.split("-").map(Number);
  return { year, month, day };
}

/**
 * Volle Lebensjahre am Stichtag (Default: heute).
 *
 * Beispiel: Geburtsdatum 2021-09-15, Stichtag 2026-08-21 -> 4 (Geburtstag im
 * September ist noch nicht erreicht, also erst 4 statt 5 Jahre alt).
 */
export function calculateAgeYears(birthDate: string, atDate: Date = new Date()): number {
  const birth = parseBirthDate(birthDate);
  let age = atDate.getFullYear() - birth.year;
  const hadBirthdayThisYear =
    atDate.getMonth() + 1 > birth.month ||
    (atDate.getMonth() + 1 === birth.month && atDate.getDate() >= birth.day);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/**
 * Datum, an dem ein Kind altersbedingt aus einer Gruppe mit gegebenem
 * `maxAge` herauswächst - der Geburtstag, an dem es `maxAge` Jahre alt wird.
 * Ein Kind mit "Max. Alter" 6 muss also genau an seinem 6. Geburtstag
 * wechseln, nicht erst am 7.
 *
 * Beispiel: Geburtsdatum 2020-08-03, maxAge 6 -> 2026-08-03 (6. Geburtstag).
 */
export function nextGroupSwitchDate(birthDate: string, maxAge: number): Date {
  const birth = parseBirthDate(birthDate);
  return new Date(birth.year + maxAge, birth.month - 1, birth.day);
}

/** Formatiert ein Datum als "August 2027" (deutsches Monatsformat). */
export function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

/**
 * Liefert die Gruppe, deren Altersspanne das übergebene Alter enthält.
 * `maxAge` ist dabei exklusiv zu verstehen: Ein Kind, das `maxAge` bereits
 * erreicht hat, gehört schon in die nächsthöhere Gruppe.
 */
export function groupForAge(age: number, groups: Group[]): Group | undefined {
  return groups.find((g) => age >= g.minAge && age < g.maxAge);
}

/**
 * Liefert die nächsthöhere Gruppe (nächstgrößeres minAge) relativ zur
 * übergebenen Gruppe, sofern eine existiert.
 */
export function nextGroup(current: Group, groups: Group[]): Group | undefined {
  return groups
    .filter((g) => g.minAge > current.minAge)
    .sort((a, b) => a.minAge - b.minAge)[0];
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

export type SwitchUrgency = "next-month" | "next-3-months" | "this-year";

/**
 * Dringlichkeit eines bevorstehenden Gruppenwechsels, exklusiv gestuft
 * (jedes Kind fällt nur in die dringlichste zutreffende Stufe):
 * - "next-month": Wechsel innerhalb des nächsten Monats
 * - "next-3-months": Wechsel innerhalb der nächsten 3 Monate
 * - "this-year": Wechsel noch dieses Kalenderjahr
 *
 * Liegt der Wechsel in der Vergangenheit oder erst nach diesem Jahr, wird
 * `null` zurückgegeben.
 */
export function switchUrgency(switchDate: Date, today: Date = new Date()): SwitchUrgency | null {
  const from = startOfDay(today);
  if (switchDate < from) return null;
  if (switchDate <= addMonths(from, 1)) return "next-month";
  if (switchDate <= addMonths(from, 3)) return "next-3-months";
  if (switchDate.getFullYear() === from.getFullYear()) return "this-year";
  return null;
}
