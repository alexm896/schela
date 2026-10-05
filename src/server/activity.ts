import type { Sql } from "./db";
import { iso, num } from "./rows";

// The panel's activity log: one line per change, shown on the dashboard.

export type Activity = {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
};

export async function logActivity(sql: Sql, kind: string, message: string) {
  await sql`insert into activity (kind, message) values (${kind}, ${message})`;
}

export function mapActivity(row: Record<string, unknown>): Activity {
  return {
    id: num(row.id),
    kind: String(row.kind),
    message: String(row.message),
    createdAt: iso(row.created_at),
  };
}
