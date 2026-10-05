import { bool, num } from "@/server/rows";
import type { ModuleRow } from "./types";

export function mapModule(row: Record<string, unknown>): ModuleRow {
  return {
    id: num(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    version: String(row.version),
    enabled: bool(row.enabled),
    core: bool(row.core),
    sortOrder: num(row.sort_order),
  };
}
