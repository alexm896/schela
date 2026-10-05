import type { Sql } from "@/server/db";

// The backup jobs of one site or app. They have nothing to archive once it is
// gone, so they are listed before it is deleted and removed with it.

export type BackupOwner = { scope: "site" | "app"; id: number };

export async function backupJobsOf(sql: Sql, owner: BackupOwner): Promise<{ id: number; name: string }[]> {
  const rows = await sql<{ id: number; name: string }>`
    select id, name from backup_jobs
    where scope = ${owner.scope} and target_id = ${owner.id}
    order by id
  `;
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
}

export async function deleteBackupJobs(sql: Sql, ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    await sql`delete from backup_jobs where id = ${id}`;
  }
}
