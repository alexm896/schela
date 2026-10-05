import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { ensureHostDns } from "@/features/dns/records";
import { normalizeDomain } from "@/lib/utils";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { mapApp } from "./map";

export const listApps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select node_apps.*, ip_addresses.address as ip_address
      from node_apps
      left join ip_addresses on ip_addresses.id = node_apps.ip_id
      order by name
    `).map(mapApp);
  });

export const createApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().min(1).max(80).optional(),
      domain: z.string().min(3).max(120),
      nodeVersion: z.string(),
      port: z.number().min(1024).max(65535).optional(),
      entry: z.string().min(1).max(80),
      instances: z.number().min(1).max(8),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const domain = normalizeDomain(data.domain);
    const name = (data.name?.trim() || domain).slice(0, 80);
    const used = await sql<{ port: number }>`select port from node_apps`;
    const taken = new Set(used.map((r) => r.port));
    let port = data.port ?? 0;
    if (!port) {
      for (let p = 3000; p < 4000; p++) {
        if (!taken.has(p)) {
          port = p;
          break;
        }
      }
    }
    if (!port) throw new Error("No free port in 3000–3999");
    const rows = await sql<Record<string, unknown>>`
      insert into node_apps (name, domain, node_version, port, status, entry, instances, memory_mb)
      values (${name}, ${domain}, ${data.nodeVersion}, ${port}, 'running', ${data.entry}, ${data.instances}, 256)
      returning *
    `;
    await logActivity(sql, "node", `Started ${name} on ${domain} (Node ${data.nodeVersion})`);
    await ensureHostDns(sql, domain);
    await applyAfterChange(sql);
    return mapApp(rows[0]);
  });

export const updateApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.number(),
      nodeVersion: z.string().optional(),
      status: z.enum(["running", "stopped"]).optional(),
      instances: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const currentRows = await sql<Record<string, unknown>>`
      select * from node_apps where id = ${data.id}
    `;
    if (!currentRows[0]) throw new Error("App not found");
    const current = mapApp(currentRows[0]);
    const nodeVersion = data.nodeVersion ?? current.nodeVersion;
    const status = data.status ?? current.status;
    const instances = data.instances ?? current.instances;
    const rows = await sql<Record<string, unknown>>`
      update node_apps
      set node_version = ${nodeVersion}, status = ${status}, instances = ${instances}
      where id = ${data.id}
      returning *
    `;
    await applyAfterChange(sql);
    return mapApp(rows[0]);
  });

export const deleteApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      delete from node_apps where id = ${data.id} returning name
    `;
    if (rows[0]) {
      await logActivity(sql, "node", `Removed app ${String(rows[0].name)}`);
    }
    await applyAfterChange(sql);
    return { ok: true };
  });
