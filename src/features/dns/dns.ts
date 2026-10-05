// DNS record types on offer and how a hostname splits into zone and host.
// Pure, shared by the server functions and the UI.

export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"] as const;

export type DnsType = (typeof DNS_TYPES)[number];

export function zoneAndHost(fqdn: string): { zone: string; host: string } {
  const clean = fqdn.trim().toLowerCase().replace(/\.$/, "");
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return { zone: clean, host: "@" };
  return { zone: parts.slice(-2).join("."), host: parts.slice(0, -2).join(".") };
}
