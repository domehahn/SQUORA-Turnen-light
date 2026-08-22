const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function normalizedEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@") || trimmed.length > 254) return undefined;
  return trimmed;
}

export function requiredText(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

export function optionalText(value: unknown, maxLength = 500): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return undefined;
  return trimmed || null;
}

export function validPassword(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 8 || value.length > 200) return undefined;
  return value;
}

export function validDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !DATE_RE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return value;
}

export function validId(value: unknown): string | undefined {
  if (typeof value !== "string" || !ID_RE.test(value)) return undefined;
  return value;
}

export function optionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return validId(value);
}

export function validAge(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 25) return undefined;
  return value;
}

export function validAgeRange(minAge: unknown, maxAge: unknown): { minAge: number; maxAge: number } | undefined {
  const min = validAge(minAge);
  const max = validAge(maxAge);
  if (min === undefined || max === undefined || min > max) return undefined;
  return { minAge: min, maxAge: max };
}

export function validSortOrder(value: unknown): number | undefined {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value;
}

export function validBool(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") return undefined;
  return value;
}
