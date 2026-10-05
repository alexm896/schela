import type { Sql } from "@/server/db";
import { dnsRecordIp } from "@/server/env";

export function zoneAndHost(fqdn: string): { zone: string; host: string } {
  const clean = fqdn.trim().toLowerCase().replace(/\.$/, "");
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return { zone: clean, host: "@" };
  return { zone: parts.slice(-2).join("."), host: parts.slice(0, -2).join(".") };
}

export function mailboxDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase() : address.toLowerCase();
}

async function bumpSerial(sql: Sql, zoneId: number) {
  await sql`update dns_zones set serial = serial + 1 where id = ${zoneId}`;
}

export async function ensureZone(
  sql: Sql,
  zoneName: string,
): Promise<{ id: number; name: string }> {
  const name = zoneName.trim().toLowerCase();
  const existing = await sql<{ id: number; name: string }>`
    select id, name from dns_zones where name = ${name}
  `;
  if (existing[0]) return existing[0];
  const serial = Number(new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01");
  const rows = await sql<{ id: number; name: string }>`
    insert into dns_zones (name, serial, status) values (${name}, ${serial}, 'active')
    returning id, name
  `;
  const zone = rows[0];
  const ip = dnsRecordIp();
  await sql`
    insert into dns_records (zone_id, type, name, value, ttl, priority)
    values
      (${zone.id}, 'A', '@', ${ip}, 300, null),
      (${zone.id}, 'NS', '@', ${"ns1." + name}, 3600, null)
  `;
  return zone;
}

export async function upsertRecord(
  sql: Sql,
  zoneId: number,
  type: string,
  name: string,
  value: string,
  ttl = 300,
  priority: number | null = null,
) {
  const found = await sql<{ id: number }>`
    select id from dns_records
    where zone_id = ${zoneId} and type = ${type} and name = ${name}
  `;
  if (found[0]) {
    await sql`
      update dns_records
      set value = ${value}, ttl = ${ttl}, priority = ${priority}
      where id = ${found[0].id}
    `;
  } else {
    await sql`
      insert into dns_records (zone_id, type, name, value, ttl, priority)
      values (${zoneId}, ${type}, ${name}, ${value}, ${ttl}, ${priority})
    `;
  }
  await bumpSerial(sql, zoneId);
}

/** A record for a site or app hostname, plus www when it is the apex. */
export async function ensureHostDns(sql: Sql, fqdn: string, bindIp?: string): Promise<void> {
  const { zone, host } = zoneAndHost(fqdn);
  if (!zone) return;
  const z = await ensureZone(sql, zone);
  const ip = bindIp || dnsRecordIp();
  await upsertRecord(sql, z.id, "A", host, ip, 300, null);
  if (host === "@") {
    await upsertRecord(sql, z.id, "A", "www", ip, 300, null);
  }
}

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
