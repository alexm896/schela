import { iso, num } from "@/server/rows";
import type { IpAddress } from "./types";

export function mapIp(row: Record<string, unknown>): IpAddress {
  return {
    id: num(row.id),
    address: String(row.address),
    label: String(row.label ?? ""),
    siteId: row.site_id == null || row.site_id === "" ? null : num(row.site_id),
    appId: row.app_id == null || row.app_id === "" ? null : num(row.app_id),
    assignedTo: row.assigned_to == null || row.assigned_to === "" ? null : String(row.assigned_to),
    createdAt: iso(row.created_at),
  };
}
