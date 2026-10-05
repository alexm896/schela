// Column readers for raw database rows. PGLite and node-postgres return
// booleans, numbers and timestamps in different shapes; these normalise them.

export function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

export function bool(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

export function num(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function nullableNum(value: unknown): number | null {
  return value == null || value === "" ? null : num(value);
}

export function nullableText(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}
