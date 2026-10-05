import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { getSql, type Sql } from "@/server/db";
import { logActivity } from "@/server/activity";
import { appSystemUser } from "@/lib/utils";
import { applyAfterChange } from "@/server/apply";
import { ensureHostDns } from "./dns-auto";
import { mapApp, mapCron, mapIp, mapSite } from "./map";
import { assertCronCommand, assertCronSchedule, normalizeIp } from "./net";
import type { CronJob, IpAddress } from "./types";

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
    const rows = await sql<{ address: string }>`
      delete from ip_addresses where id = ${data.id} returning address
    `;
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

function cronUser(kind: "site" | "app", siteUser: string | null, appName: string | null): string {
  if (kind === "site") return siteUser || "";
  return appSystemUser(appName || "app");
}

async function listCronRows(sql: Sql): Promise<CronJob[]> {
  const rows = await sql<Record<string, unknown>>`
    select cron_jobs.*,
      coalesce(sites.domain, node_apps.domain) as target_label,
      sites.jail_user as site_user,
      node_apps.name as app_name
    from cron_jobs
    left join sites on cron_jobs.kind = 'site' and sites.id = cron_jobs.target_id
    left join node_apps on cron_jobs.kind = 'app' and node_apps.id = cron_jobs.target_id
    order by cron_jobs.id desc
  `;
  return rows.map((row) => {
    const kind = row.kind === "app" ? "app" : "site";
    return mapCron({
      ...row,
      user: cronUser(kind, row.site_user ? String(row.site_user) : null, row.app_name ? String(row.app_name) : null),
    });
  });
}

export const listCron = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const jobs = await listCronRows(sql);
    const sites = (await sql<Record<string, unknown>>`select * from sites order by domain`).map(
      mapSite,
    );
    const apps = (await sql<Record<string, unknown>>`select * from node_apps order by name`).map(
      mapApp,
    );
    return { jobs, sites, apps };
  });

export const createCron = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      kind: z.enum(["site", "app"]),
      targetId: z.number().int().positive(),
      name: z.string().max(80).default(""),
      schedule: z.string().min(5).max(80),
      command: z.string().min(1).max(400),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const schedule = assertCronSchedule(data.schedule);
    const command = assertCronCommand(data.command);
    if (data.kind === "site") {
      const rows = await sql<{ id: number }>`select id from sites where id = ${data.targetId}`;
      if (!rows[0]) throw new Error("Site not found");
    } else {
      const rows = await sql<{ id: number }>`select id from node_apps where id = ${data.targetId}`;
      if (!rows[0]) throw new Error("App not found");
    }
    const rows = await sql<Record<string, unknown>>`
      insert into cron_jobs (kind, target_id, name, schedule, command, enabled)
      values (${data.kind}, ${data.targetId}, ${data.name.trim()}, ${schedule}, ${command}, true)
      returning *
    `;
    await logActivity(sql, "cron", `Scheduled ${data.kind} job ${data.name.trim() || schedule}`);
    await applyAfterChange(sql);
    return mapCron({ ...rows[0], target_label: "", user: "" });
  });

export const toggleCron = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`update cron_jobs set enabled = ${data.enabled} where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const deleteCron = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from cron_jobs where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true as const };
  });
