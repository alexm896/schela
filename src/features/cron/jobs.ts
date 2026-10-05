import type { Sql } from "@/server/db";

// The cron jobs of one site or app. They cannot run once it is gone, so they
// are listed before it is deleted and removed with it.

export type CronOwner = { kind: "site" | "app"; id: number };

export async function cronJobLabels(sql: Sql, owner: CronOwner): Promise<string[]> {
  const rows = await sql<{ name: string; schedule: string; command: string }>`
    select name, schedule, command from cron_jobs
    where kind = ${owner.kind} and target_id = ${owner.id}
    order by id
  `;
  return rows.map((r) => `${r.name || r.command} (${r.schedule})`);
}

export async function deleteCronJobs(sql: Sql, owner: CronOwner): Promise<void> {
  await sql`delete from cron_jobs where kind = ${owner.kind} and target_id = ${owner.id}`;
}
