import { ApiError } from "./api";
import type { CapacityWarning } from "./types";

// Sentinel statt `undefined`, damit ein bewusster Abbruch durch die Nutzerin
// klar von einem "kein Ergebnis"-Rückgabewert der eigentlichen Aktion zu
// unterscheiden ist.
export const CAPACITY_CANCELLED = Symbol("capacity-confirm-cancelled");

/**
 * Führt `fn(false)` aus. Antwortet die API mit einer Kapazitätswarnung
 * (409, code "capacity_exceeded"), wird der Person die Überschreitung
 * angezeigt und um Bestätigung gebeten ("mit der Jugendleitung
 * abgesprochen"). Bei Zustimmung folgt `fn(true)` (confirmOverCapacity),
 * bei Ablehnung liefert die Funktion `CAPACITY_CANCELLED` statt zu werfen.
 */
export async function withCapacityConfirm<T>(
  fn: (confirmOverCapacity: boolean) => Promise<T>
): Promise<T | typeof CAPACITY_CANCELLED> {
  try {
    return await fn(false);
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && (err.data as CapacityWarning | null)?.code === "capacity_exceeded") {
      const warning = err.data as CapacityWarning;
      const ok = confirm(
        `Die Gruppe „${warning.groupName}“ hat aktuell ${warning.currentCount} von ${warning.maxChildren} Plätzen belegt. ` +
          `Trotzdem fortfahren? Bitte vorher mit der Jugendleitung absprechen.`
      );
      if (!ok) return CAPACITY_CANCELLED;
      return await fn(true);
    }
    throw err;
  }
}
