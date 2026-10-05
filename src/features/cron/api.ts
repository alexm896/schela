import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql, type Sql } from "@/server/db";
import { mapApp } from "@/features/apps/map";
import { mapSite } from "@/features/sites/map";
import { assertCronCommand, assertCronSchedule, cronUser } from "./cron";
import { mapCron } from "./map";
import type { CronJob } from "./types";

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
