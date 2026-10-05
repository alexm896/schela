import { bool, iso, num } from "@/server/rows";
import type { CronJob } from "./types";

export function mapCron(row: Record<string, unknown>): CronJob {
  return {
    id: num(row.id),
    kind: row.kind === "app" ? "app" : "site",
    targetId: num(row.target_id),
    targetLabel: String(row.target_label ?? ""),
    user: String(row.user ?? ""),
    name: String(row.name ?? ""),
    schedule: String(row.schedule),
    command: String(row.command),
    enabled: bool(row.enabled),
    createdAt: iso(row.created_at),
  };
}
