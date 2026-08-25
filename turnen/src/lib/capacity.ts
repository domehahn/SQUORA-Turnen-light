export type CapacityLevel = "unset" | "ok" | "warn" | "over";

// Gleiche Schwellwerte wie in Groups.tsx/Utilization.tsx: "warn" ab
// Erreichen der Kapazität, "over" ab 15% Überbelegung (Kapazitäts-
// Anfragen können das erlauben, siehe capacityGate im Worker).
export function capacityLevel(count: number, max: number | null): CapacityLevel {
  if (max === null || max === 0) return "unset";
  const ratio = count / max;
  if (ratio <= 1) return "ok";
  if (ratio <= 1.15) return "warn";
  return "over";
}
