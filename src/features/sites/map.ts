import { bool, iso, num } from "@/server/rows";
import type { Site } from "./types";

export function mapSite(row: Record<string, unknown>): Site {
  const status = row.status === "stopped" ? "stopped" : "active";
  return {
    id: num(row.id),
    domain: String(row.domain),
    phpVersion: String(row.php_version),
    root: String(row.root),
    ssl: bool(row.ssl),
    forceHttps: bool(row.force_https),
    isolated: bool(row.isolated),
    systemUser: String(row.jail_user),
    pool: String(row.pool),
    status,
    memoryLimit: String(row.memory_limit),
    ipId: row.ip_id == null || row.ip_id === "" ? null : num(row.ip_id),
    ipAddress: row.ip_address == null || row.ip_address === "" ? null : String(row.ip_address),
    createdAt: iso(row.created_at),
  };
}
