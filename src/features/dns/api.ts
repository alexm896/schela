import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { assertConfirmed } from "@/lib/removal";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { dnsRecordIp, isVpsApply } from "@/server/env";
import { mapRecord, mapZone } from "./map";
import { zoneById, zoneRemovalPlan } from "./removal";

export const listDns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const zones = (await sql<Record<string, unknown>>`select * from dns_zones order by name`).map(
      mapZone,
    );
    const records = (await sql<Record<string, unknown>>`select * from dns_records order by type, name`).map(
      mapRecord,
    );
    return { zones, records };
  });

export const createDnsZone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().min(3).max(120) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const name = data.name.trim().toLowerCase();
    const serial = Number(
      new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01",
    );
    const rows = await sql<Record<string, unknown>>`
      insert into dns_zones (name, serial, status) values (${name}, ${serial}, 'active')
      returning *
    `;
    const zone = mapZone(rows[0]);
    const ip = dnsRecordIp();
    const ns = isVpsApply() ? `ns1.${name}` : "ns1.schela.local";
    await sql`
      insert into dns_records (zone_id, type, name, value, ttl, priority)
      values
        (${zone.id}, 'A', '@', ${ip}, 300, null),
        (${zone.id}, 'NS', '@', ${ns}, 3600, null)
    `;
    await logActivity(sql, "dns", `Added zone ${name}`);
    await applyAfterChange(sql);
    return zone;
  });

export const createDnsRecord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      zoneId: z.number(),
      type: z.string(),
      name: z.string().min(1).max(80),
      value: z.string().min(1).max(255),
      ttl: z.number().min(60).max(86400),
      priority: z.number().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      insert into dns_records (zone_id, type, name, value, ttl, priority)
      values (${data.zoneId}, ${data.type}, ${data.name}, ${data.value}, ${data.ttl}, ${data.priority})
      returning *
    `;
    await applyAfterChange(sql);
    return mapRecord(rows[0]);
  });

export const deleteDnsRecord = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from dns_records where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true };
  });

export const getZoneRemoval = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    return zoneRemovalPlan(sql, await zoneById(sql, data.id));
  });

export const deleteDnsZone = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), confirm: z.string().max(255) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const zone = await zoneById(sql, data.id);
    assertConfirmed(await zoneRemovalPlan(sql, zone), data.confirm);
    // Its records go with it (on delete cascade).
    await sql`delete from dns_zones where id = ${zone.id}`;
    await logActivity(sql, "dns", `Removed zone ${zone.name}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });
