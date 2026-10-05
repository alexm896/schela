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

/** Names of the A records a site or app hostname gets: www too for an apex. */
function hostRecordNames(host: string): string[] {
  return host === "@" ? ["@", "www"] : [host];
}

/** A record for a site or app hostname, plus www when it is the apex. */
export async function ensureHostDns(sql: Sql, fqdn: string, bindIp?: string): Promise<void> {
  const { zone, host } = zoneAndHost(fqdn);
  if (!zone) return;
  const z = await ensureZone(sql, zone);
  const ip = bindIp || dnsRecordIp();
  for (const name of hostRecordNames(host)) {
    await upsertRecord(sql, z.id, "A", name, ip, 300, null);
  }
}

export async function zoneByName(sql: Sql, name: string): Promise<{ id: number; name: string } | null> {
  const rows = await sql<{ id: number; name: string }>`select id, name from dns_zones where name = ${name}`;
  return rows[0] ? { id: Number(rows[0].id), name: String(rows[0].name) } : null;
}

export async function deleteRecords(sql: Sql, zoneId: number, ids: readonly number[]): Promise<void> {
  if (!ids.length) return;
  for (const id of ids) {
    await sql`delete from dns_records where zone_id = ${zoneId} and id = ${id}`;
  }
  await bumpSerial(sql, zoneId);
}

/** The A records ensureHostDns keeps for a hostname, as "A <full name>". */
export async function hostDnsLabels(sql: Sql, fqdn: string): Promise<string[]> {
  const { zone, host } = zoneAndHost(fqdn);
  const z = zone ? await zoneByName(sql, zone) : null;
  if (!z) return [];
  const labels: string[] = [];
  for (const name of hostRecordNames(host)) {
    const rows = await sql<{ id: number }>`
      select id from dns_records where zone_id = ${z.id} and type = 'A' and name = ${name}
    `;
    if (rows.length) labels.push(`A ${name === "@" ? z.name : `${name}.${z.name}`}`);
  }
  return labels;
}

/** Undoes ensureHostDns. The zone and its other records stay. */
export async function removeHostDns(sql: Sql, fqdn: string): Promise<void> {
  const { zone, host } = zoneAndHost(fqdn);
  const z = zone ? await zoneByName(sql, zone) : null;
  if (!z) return;
  const names = hostRecordNames(host);
  if (names.includes("@")) await keepNameServerAddresses(sql, z);
  for (const name of names) {
    await sql`delete from dns_records where zone_id = ${z.id} and type = 'A' and name = ${name}`;
  }
  await bumpSerial(sql, z.id);
}

/**
 * Bind refuses a zone whose own name server (ns1.<zone>) has no address, and
 * until now it borrowed the apex A. Before that goes, give each such name
 * server an A record of its own at the same address.
 */
async function keepNameServerAddresses(sql: Sql, zone: { id: number; name: string }): Promise<void> {
  const records = await sql<{ type: string; name: string; value: string }>`
    select type, name, value from dns_records where zone_id = ${zone.id}
  `;
  const apex = records.find((r) => r.type === "A" && r.name === "@")?.value;
  if (!apex) return;
  const suffix = `.${zone.name}`;
  for (const ns of records.filter((r) => r.type === "NS")) {
    const target = ns.value.replace(/\.$/, "");
    if (!target.endsWith(suffix)) continue;
    const host = target.slice(0, -suffix.length);
    if (records.some((r) => r.type === "A" && r.name === host)) continue;
    await upsertRecord(sql, zone.id, "A", host, apex, 300, null);
  }
}
