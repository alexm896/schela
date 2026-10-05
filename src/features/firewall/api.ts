import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql } from "@/server/db";
import { mapRule } from "./map";

export const listFirewall = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    return (await sql<Record<string, unknown>>`
      select * from firewall_rules order by id
    `).map(mapRule);
  });

export const createFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      action: z.enum(["allow", "deny"]),
      protocol: z.enum(["tcp", "udp", "any"]),
      port: z.string().min(1).max(20),
      source: z.string().min(1).max(80),
      comment: z.string().max(80),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      insert into firewall_rules (direction, action, protocol, port, source, comment, enabled)
      values ('in', ${data.action}, ${data.protocol}, ${data.port}, ${data.source}, ${data.comment}, true)
      returning *
    `;
    await logActivity(
      sql,
      "firewall",
      `${data.action} ${data.protocol}/${data.port} from ${data.source}`,
    );
    await applyAfterChange(sql);
    return mapRule(rows[0]);
  });

export const toggleFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql<Record<string, unknown>>`
      update firewall_rules set enabled = ${data.enabled} where id = ${data.id} returning *
    `;
    await applyAfterChange(sql);
    return rows[0] ? mapRule(rows[0]) : null;
  });

export const deleteFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from firewall_rules where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true };
  });
