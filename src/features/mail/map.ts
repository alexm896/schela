import { bool, iso, num } from "@/server/rows";
import type { Mailbox } from "./types";

export function mapMailbox(row: Record<string, unknown>): Mailbox {
  return {
    id: num(row.id),
    address: String(row.address),
    quotaMb: num(row.quota_mb),
    usedMb: num(row.used_mb),
    status: row.status === "disabled" ? "disabled" : "active",
    hasPassword: bool(row.has_password) || (typeof row.password_hash === "string" && row.password_hash.length > 0),
    createdAt: iso(row.created_at),
  };
}
