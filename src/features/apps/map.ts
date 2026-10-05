import { iso, num } from "@/server/rows";
import type { NodeApp } from "./types";

export function mapApp(row: Record<string, unknown>): NodeApp {
  const status = row.status === "stopped" ? "stopped" : "running";
  return {
    id: num(row.id),
    name: String(row.name),
    domain: String(row.domain),
    nodeVersion: String(row.node_version),
    port: num(row.port),
    status,
    entry: String(row.entry),
    instances: num(row.instances),
    memoryMb: num(row.memory_mb),
    ipId: row.ip_id == null || row.ip_id === "" ? null : num(row.ip_id),
    ipAddress: row.ip_address == null || row.ip_address === "" ? null : String(row.ip_address),
    createdAt: iso(row.created_at),
  };
}
