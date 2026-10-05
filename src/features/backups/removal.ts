import { assertConfirmed, chosen, option, type RemovalPlan } from "@/lib/removal";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import type { Sql } from "@/server/db";
import { purge } from "@/server/purge";
import type { BackupJobRemovalOption } from "./backups";

// Deleting a backup job: its archives stay unless the admin ticks them.

export async function backupJobById(sql: Sql, id: number): Promise<{ id: number; name: string }> {
  const rows = await sql<{ id: number; name: string }>`select id, name from backup_jobs where id = ${id}`;
  if (!rows[0]) throw new Error("Backup job not found");
  return { id: Number(rows[0].id), name: String(rows[0].name) };
}

export function backupJobRemovalPlan(job: { name: string }): RemovalPlan<BackupJobRemovalOption> {
  return {
    confirm: null,
    alsoRemoved: [],
    options: option("archives", "Archives and run history", [`Every archive of ${job.name} on this server`], false),
    notes: ["Copies already pushed over rsync or to S3 are not touched."],
  };
}

/** Deletes the job with what the admin ticked. Returns what could not be removed. */
export async function removeBackupJob(
  sql: Sql,
  job: { id: number; name: string },
  requested: readonly BackupJobRemovalOption[],
): Promise<string[]> {
  const plan = backupJobRemovalPlan(job);
  assertConfirmed(plan, undefined);
  const picked = chosen(plan, requested);
  await sql`delete from backup_jobs where id = ${job.id}`;
  await logActivity(sql, "backup", `Removed backup job ${job.name}`);
  await applyAfterChange(sql);
  return picked.has("archives") ? purge([{ op: "backups", jobId: job.id }]) : [];
}
