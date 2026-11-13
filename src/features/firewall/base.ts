// The rules the firewall always holds besides the panel's own, and the checks
// a new rule must pass. Pure, shared by the server functions, the UI and the
// tests. Mirrors firewall_wanted in installer/schela-apply, which also keeps
// open every port sshd is configured for or listening on (the panel cannot
// see those).
import { z } from "zod";
import type { FirewallRule } from "./types";

export type BaseRule = {
  protocol: "tcp" | "udp";
  port: number;
  label: string;
};

export function baseFirewallRules(
  sshPort: number,
  modules: Record<string, boolean>,
): BaseRule[] {
  const rules: BaseRule[] = [
    { protocol: "tcp", port: sshPort, label: "SSH (setting), plus every port sshd uses" },
    { protocol: "tcp", port: 80, label: "HTTP" },
    { protocol: "tcp", port: 443, label: "HTTPS" },
  ];
  if (modules.mail) {
    rules.push(
      { protocol: "tcp", port: 25, label: "Mail: SMTP" },
      { protocol: "tcp", port: 587, label: "Mail: submission" },
      { protocol: "tcp", port: 993, label: "Mail: IMAPS" },
    );
  }
  if (modules.dns) {
    rules.push(
      { protocol: "tcp", port: 53, label: "DNS" },
      { protocol: "udp", port: 53, label: "DNS" },
    );
  }
  return rules;
}

const sourceSchema = z.union([
  z.literal("any"),
  z.ipv4(),
  z.ipv6(),
  z.cidrv4(),
  z.cidrv6(),
]);

export function isFirewallPort(port: string): boolean {
  return /^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535;
}

export function isFirewallSource(source: string): boolean {
  return sourceSchema.safeParse(source).success;
}

/** ufw reads a /0 range as "any". */
function fromEveryone(source: string): boolean {
  return source === "any" || source.endsWith("/0");
}

type NewRule = Pick<FirewallRule, "action" | "protocol" | "port" | "source">;

/** Why this rule cannot be added, or null when it can. */
export function firewallRuleProblem(
  rule: NewRule,
  base: BaseRule[],
  sshPort: number,
): string | null {
  if (!isFirewallPort(rule.port)) return "Port must be one number from 1 to 65535.";
  if (!isFirewallSource(rule.source)) {
    return "Source must be any, an IP address or a range like 203.0.113.0/24.";
  }
  const port = Number(rule.port);
  if (
    rule.action === "deny" &&
    fromEveryone(rule.source) &&
    port === sshPort &&
    rule.protocol !== "udp"
  ) {
    return `Port ${port} is SSH. Deny specific sources instead of everyone.`;
  }
  if (
    rule.action === "allow" &&
    fromEveryone(rule.source) &&
    base.some((b) => b.port === port && b.protocol === rule.protocol)
  ) {
    return `${rule.protocol}/${port} is already open as a base rule.`;
  }
  return null;
}
