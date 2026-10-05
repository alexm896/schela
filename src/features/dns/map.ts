import { num } from "@/server/rows";
import type { DnsRecord, DnsZone } from "./types";

export function mapZone(row: Record<string, unknown>): DnsZone {
  return {
    id: num(row.id),
    name: String(row.name),
    serial: num(row.serial),
    status: String(row.status),
  };
}

export function mapRecord(row: Record<string, unknown>): DnsRecord {
  return {
    id: num(row.id),
    zoneId: num(row.zone_id),
    type: String(row.type),
    name: String(row.name),
    value: String(row.value),
    ttl: num(row.ttl),
    priority: row.priority == null ? null : num(row.priority),
  };
}
