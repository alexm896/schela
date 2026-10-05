import type { HostingRemovalOption } from "@/features/hosting/hosting";
import { hostingRemovalPlan, removeHostingAccount, type HostingAccount } from "@/features/hosting/removal";
import type { RemovalPlan } from "@/lib/removal";
import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import { appSystemUser } from "./apps";
import { mapApp } from "./map";
import type { NodeApp } from "./types";

// Deleting a Node app: everything a hosting account has.

export async function appById(sql: Sql, id: number): Promise<NodeApp> {
  const rows = await sql<Record<string, unknown>>`select * from node_apps where id = ${id}`;
  if (!rows[0]) throw new Error("App not found");
  return mapApp(rows[0]);
}

function account(app: NodeApp): HostingAccount {
  return { kind: "app", id: app.id, name: app.name, hostname: app.domain, systemUser: appSystemUser(app.name) };
}

export async function appRemovalPlan(sql: Sql, app: NodeApp): Promise<RemovalPlan<HostingRemovalOption>> {
  return hostingRemovalPlan(sql, account(app));
}

/** Deletes the app with what the admin ticked. Returns what could not be removed. */
export async function removeApp(
  sql: Sql,
  app: NodeApp,
  requested: readonly HostingRemovalOption[],
  typed: string | undefined,
): Promise<string[]> {
  const plan = await appRemovalPlan(sql, app);
  return removeHostingAccount(sql, account(app), plan, requested, typed, async () => {
    await sql`delete from node_apps where id = ${app.id}`;
    await logActivity(sql, "node", `Removed app ${app.name}`);
  });
}
