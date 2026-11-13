import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { readModules } from "@/features/modules/modules";
import { readSettings } from "@/features/settings/settings";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql, type Sql } from "@/server/db";
import { baseFirewallRules, firewallRuleProblem, type BaseRule } from "./base";
import { mapRule } from "./map";
import type { FirewallRule } from "./types";

async function baseRules(sql: Sql): Promise<{ base: BaseRule[]; sshPort: number }> {
  const settings = await readSettings(sql);
  const modules: Record<string, boolean> = {};
  for (const m of await readModules(sql)) modules[m.slug] = m.enabled;
  return { base: baseFirewallRules(settings.sshPort, modules), sshPort: settings.sshPort };
}

export const listFirewall = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{ base: BaseRule[]; rules: FirewallRule[] }> => {
    const sql = await getSql();
    const rules = (await sql<Record<string, unknown>>`
      select * from firewall_rules order by id
    `).map(mapRule);
    const { base } = await baseRules(sql);
    return { base, rules };
  });

export const createFirewallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      action: z.enum(["allow", "deny"]),
      protocol: z.enum(["tcp", "udp", "any"]),
      port: z.string().trim().min(1).max(20),
      source: z.string().trim().min(1).max(80),
      comment: z.string().max(80),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const { base, sshPort } = await baseRules(sql);
    const problem = firewallRuleProblem(data, base, sshPort);
    if (problem) throw new Error(problem);
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
