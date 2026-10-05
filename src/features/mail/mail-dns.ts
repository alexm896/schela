// The DNS records a mail domain needs (MX, SPF, DMARC, DKIM), kept in the
// panel's own zones whenever a mailbox is created.

import type { Sql } from "@/server/db";
import { dnsRecordIp } from "@/server/env";
import { ensureZone, upsertRecord } from "@/features/dns/records";
import { mailboxDomain } from "./mail";

export type MailDnsRow = {
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  present: boolean;
  current?: string;
};

export function mailDnsBlueprint(domain: string, ip: string, dkim?: string): MailDnsRow[] {
  return [
    { type: "MX", name: "@", value: `mail.${domain}`, ttl: 300, priority: 10, present: false },
    { type: "A", name: "mail", value: ip, ttl: 300, priority: null, present: false },
    {
      type: "TXT",
      name: "@",
      value: `v=spf1 mx a ip4:${ip} ~all`,
      ttl: 300,
      priority: null,
      present: false,
    },
    {
      type: "TXT",
      name: "_dmarc",
      value: `v=DMARC1; p=quarantine; rua=mailto:postmaster@${domain}`,
      ttl: 300,
      priority: null,
      present: false,
    },
    {
      type: "TXT",
      name: "mail._domainkey",
      value: dkim || "v=DKIM1; k=rsa; p=pending",
      ttl: 300,
      priority: null,
      present: false,
    },
  ];
}

export async function ensureMailDns(sql: Sql, address: string): Promise<void> {
  const domain = mailboxDomain(address);
  if (!domain.includes(".")) return;
  const z = await ensureZone(sql, domain);
  const ip = dnsRecordIp();
  const wanted = mailDnsBlueprint(domain, ip);
  for (const rec of wanted) {
    await upsertRecord(sql, z.id, rec.type, rec.name, rec.value, rec.ttl, rec.priority);
  }
}

export async function describeMailDns(
  sql: Sql,
  domain: string,
): Promise<{ domain: string; records: MailDnsRow[] }> {
  const ip = dnsRecordIp();
  const wanted = mailDnsBlueprint(domain, ip);
  const zone = (
    await sql<{ id: number }>`select id from dns_zones where name = ${domain}`
  )[0];
  if (!zone) return { domain, records: wanted };
  const have = await sql<{ type: string; name: string; value: string }>`
    select type, name, value from dns_records where zone_id = ${zone.id}
  `;
  const records = wanted.map((rec) => {
    const hit = have.find((h) => h.type === rec.type && h.name === rec.name);
    return {
      ...rec,
      present: Boolean(hit),
      current: hit?.value,
    };
  });
  return { domain, records };
}
