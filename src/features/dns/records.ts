// Zone and record upkeep shared by sites, apps, IPs and mail: whatever they
// create gets the DNS records it needs.

import type { Sql } from "@/server/db";
import { dnsRecordIp } from "@/server/env";
import { zoneAndHost } from "./dns";

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
