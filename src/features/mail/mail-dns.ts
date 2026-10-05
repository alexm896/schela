// The DNS records a mail domain needs (MX, SPF, DMARC, DKIM), kept in the
// panel's own zones whenever a mailbox is created.

import { deleteRecords, ensureZone, upsertRecord, zoneByName } from "@/features/dns/records";
import type { Sql } from "@/server/db";
import { dnsRecordIp } from "@/server/env";
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

/** The records ensureMailDns wrote for a domain; other TXT records on @ are not mail's. */
async function mailDnsRecords(
  sql: Sql,
  domain: string,
): Promise<{ zoneId: number; records: { id: number; label: string }[] } | null> {
  const zone = await zoneByName(sql, domain);
  if (!zone) return null;
  const rows = await sql<{ id: number; type: string; name: string; value: string }>`
    select id, type, name, value from dns_records where zone_id = ${zone.id} order by id
  `;
  const blueprint = mailDnsBlueprint(domain, "");
  const records = rows
    .filter((r) => blueprint.some((b) => b.type === r.type && b.name === r.name))
    .filter((r) => !(r.type === "TXT" && r.name === "@" && !r.value.startsWith("v=spf1")))
    .map((r) => ({ id: Number(r.id), label: `${r.type} ${r.name === "@" ? domain : `${r.name}.${domain}`}` }));
  return { zoneId: zone.id, records };
}

export async function mailDnsLabels(sql: Sql, domain: string): Promise<string[]> {
  return (await mailDnsRecords(sql, domain))?.records.map((r) => r.label) ?? [];
}

/** Undoes ensureMailDns. The zone and its other records stay. */
export async function removeMailDns(sql: Sql, domain: string): Promise<void> {
  const found = await mailDnsRecords(sql, domain);
  if (found) await deleteRecords(sql, found.zoneId, found.records.map((r) => r.id));
}
