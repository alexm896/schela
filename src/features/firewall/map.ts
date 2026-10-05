import { bool, num } from "@/server/rows";
import type { FirewallRule } from "./types";

export function mapRule(row: Record<string, unknown>): FirewallRule {
  return {
    id: num(row.id),
    direction: row.direction === "out" ? "out" : "in",
    action: row.action === "deny" ? "deny" : "allow",
    protocol:
      row.protocol === "udp" ? "udp" : row.protocol === "any" ? "any" : "tcp",
    port: String(row.port),
    source: String(row.source),
    comment: String(row.comment ?? ""),
    enabled: bool(row.enabled),
  };
}
