import type { HostingRemovalOption } from "@/features/hosting/hosting";
import { hostingRemovalPlan, removeHostingAccount, type HostingAccount } from "@/features/hosting/removal";
import { group, type RemovalPlan } from "@/lib/removal";
import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import { mapSite } from "./map";
import type { Site } from "./types";

// Deleting a site: everything a hosting account has, plus its workers.

export async function siteById(sql: Sql, id: number): Promise<Site> {
  const rows = await sql<Record<string, unknown>>`select * from sites where id = ${id}`;
  if (!rows[0]) throw new Error("Site not found");
  return mapSite(rows[0]);
}

function account(site: Site): HostingAccount {
  return { kind: "site", id: site.id, name: site.domain, hostname: site.domain, systemUser: site.systemUser };
}

export async function siteRemovalPlan(sql: Sql, site: Site): Promise<RemovalPlan<HostingRemovalOption>> {
  const workers = await sql<{ name: string }>`select name from site_workers where site_id = ${site.id} order by id`;
  return hostingRemovalPlan(sql, account(site), group("Workers", workers.map((w) => w.name)));
}

/** Deletes the site with what the admin ticked. Returns what could not be removed. */
export async function removeSite(
  sql: Sql,
  site: Site,
  requested: readonly HostingRemovalOption[],
  typed: string | undefined,
): Promise<string[]> {
  const plan = await siteRemovalPlan(sql, site);
  return removeHostingAccount(sql, account(site), plan, requested, typed, async () => {
    // Its workers go with the row (on delete cascade).
    await sql`delete from sites where id = ${site.id}`;
    await logActivity(sql, "site", `Removed site ${site.domain}`);
  });
}
