import { bool, iso, num } from "@/server/rows";
import type { SiteWorker } from "./types";

export function mapWorker(row: Record<string, unknown>): SiteWorker {
  return {
    id: num(row.id),
    siteId: num(row.site_id),
    name: String(row.name),
    preset: String(row.preset),
    command: String(row.command),
    processes: num(row.processes),
    stopTimeout: num(row.stop_timeout),
    memoryMb: num(row.memory_mb),
    enabled: bool(row.enabled),
    createdAt: iso(row.created_at),
  };
}
