import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { mapApp } from "@/features/apps/map";
import { ensureHostDns } from "@/features/dns/records";
import { mapSite } from "@/features/sites/map";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql, type Sql } from "@/server/db";
import { normalizeIp } from "./ips";
import { mapIp } from "./map";
import type { IpAddress } from "./types";

async function listIpRows(sql: Sql): Promise<IpAddress[]> {
  const rows = await sql<Record<string, unknown>>`
    select
      ip_addresses.*,
      s.id as site_id,
      a.id as app_id,
      coalesce(s.domain, a.domain) as assigned_to
    from ip_addresses
    left join sites s on s.ip_id = ip_addresses.id
    left join node_apps a on a.ip_id = ip_addresses.id
    order by ip_addresses.address
  `;
  return rows.map(mapIp);
}

export const listIps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const ips = await listIpRows(sql);
    const sites = (await sql<Record<string, unknown>>`
      select sites.*, ip_addresses.address as ip_address
      from sites
      left join ip_addresses on ip_addresses.id = sites.ip_id
      order by domain
    `).map(mapSite);
    const apps = (await sql<Record<string, unknown>>`
      select node_apps.*, ip_addresses.address as ip_address
      from node_apps
      left join ip_addresses on ip_addresses.id = node_apps.ip_id
      order by name
    `).map(mapApp);
    return { ips, sites, apps };
  });

export const createIp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      address: z.string().min(3).max(45),
      label: z.string().max(80).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const address = normalizeIp(data.address);
    const label = data.label.trim();
    const rows = await sql<Record<string, unknown>>`
      insert into ip_addresses (address, label) values (${address}, ${label})
      returning *
    `;
    await logActivity(sql, "ip", `Added IP ${address}`);
    await applyAfterChange(sql);
    return mapIp({ ...rows[0], site_id: null, app_id: null, assigned_to: null });
  });

export const deleteIp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    // A site or app bound to it falls back to the main address (on delete set
    // null); its DNS A records follow.
    const bound = await sql<{ domain: string }>`
      select domain from sites where ip_id = ${data.id}
      union all
      select domain from node_apps where ip_id = ${data.id}
    `;
    const rows = await sql<{ address: string }>`
      delete from ip_addresses where id = ${data.id} returning address
    `;
    for (const { domain } of bound) await ensureHostDns(sql, domain);
    if (rows[0]) await logActivity(sql, "ip", `Removed IP ${rows[0].address}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const assignIp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      kind: z.enum(["none", "site", "app"]),
      targetId: z.number().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const ipRows = await sql<Record<string, unknown>>`
      select * from ip_addresses where id = ${data.id}
    `;
    if (!ipRows[0]) throw new Error("IP not found");
    const address = String(ipRows[0].address);

    await sql`update sites set ip_id = null where ip_id = ${data.id}`;
    await sql`update node_apps set ip_id = null where ip_id = ${data.id}`;

    if (data.kind === "site" && data.targetId) {
      const sites = await sql<Record<string, unknown>>`
        select * from sites where id = ${data.targetId}
      `;
      if (!sites[0]) throw new Error("Site not found");
      await sql`update sites set ip_id = ${data.id} where id = ${data.targetId}`;
      const site = mapSite(sites[0]);
      await ensureHostDns(sql, site.domain, address);
      await logActivity(sql, "ip", `Bound ${address} to ${site.domain}`);
    } else if (data.kind === "app" && data.targetId) {
      const apps = await sql<Record<string, unknown>>`
        select * from node_apps where id = ${data.targetId}
      `;
      if (!apps[0]) throw new Error("App not found");
      await sql`update node_apps set ip_id = ${data.id} where id = ${data.targetId}`;
      const app = mapApp(apps[0]);
      await ensureHostDns(sql, app.domain, address);
      await logActivity(sql, "ip", `Bound ${address} to ${app.domain}`);
    } else {
      await logActivity(sql, "ip", `Released ${address}`);
    }
    await applyAfterChange(sql);
    return listIpRows(sql);
  });
