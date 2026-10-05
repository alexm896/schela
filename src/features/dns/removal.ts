import { group, type RemovalPlan } from "@/lib/removal";
import type { Sql } from "@/server/db";
import { zoneAndHost } from "./dns";

// Deleting a zone: its records go with it. Sites, apps and mailboxes on the
// zone stay; their names just stop resolving from this server.

export async function zoneById(sql: Sql, id: number): Promise<{ id: number; name: string }> {
  const rows = await sql<{ id: number; name: string }>`select id, name from dns_zones where id = ${id}`;
  if (!rows[0]) throw new Error("Zone not found");
  return { id: Number(rows[0].id), name: String(rows[0].name) };
}

export async function zoneRemovalPlan(sql: Sql, zone: { id: number; name: string }): Promise<RemovalPlan> {
  const records = await sql<{ type: string; name: string }>`
    select type, name from dns_records where zone_id = ${zone.id} order by type, name
  `;
  const inZone = (hostname: string) => zoneAndHost(hostname).zone === zone.name;
  const sites = await sql<{ domain: string }>`select domain from sites order by domain`;
  const apps = await sql<{ domain: string }>`select domain from node_apps order by domain`;
  const boxes = await sql<{ address: string }>`select address from mailboxes order by address`;
  const users = [
    ...sites.filter((s) => inZone(s.domain)).map((s) => `${s.domain} (site)`),
    ...apps.filter((a) => inZone(a.domain)).map((a) => `${a.domain} (app)`),
    ...boxes.filter((b) => b.address.split("@")[1] === zone.name).map((b) => `${b.address} (mailbox)`),
  ];
  return {
    confirm: zone.name,
    alsoRemoved: group(
      "Records",
      records.map((r) => `${r.type} ${r.name === "@" ? zone.name : `${r.name}.${zone.name}`}`),
    ),
    options: [],
    notes: users.length
      ? [`Still on this zone, and no longer resolving from this server: ${users.join(", ")}.`]
      : [],
  };
}
