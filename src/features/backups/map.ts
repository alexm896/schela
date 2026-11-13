import { bool, iso, num } from "@/server/rows";
import type { BackupScope } from "./backups";
import type { BackupJob } from "./types";

export function mapBackupJob(row: Record<string, unknown>): BackupJob {
  const scopeRaw = String(row.scope || "all");
  const scope: BackupScope =
    scopeRaw === "sites" ||
    scopeRaw === "apps" ||
    scopeRaw === "mail" ||
    scopeRaw === "site" ||
    scopeRaw === "app"
      ? scopeRaw
      : "all";
  return {
    id: num(row.id),
    name: String(row.name),
    scope,
    targetId: row.target_id == null || row.target_id === "" ? null : num(row.target_id),
    targetLabel: row.target_label == null || row.target_label === "" ? null : String(row.target_label),
    includeMail: bool(row.include_mail),
    schedule: String(row.schedule),
    retain: Math.max(1, num(row.retain) || 7),
    enabled: bool(row.enabled),
    rsyncEnabled: bool(row.rsync_enabled),
    rsyncDest: String(row.rsync_dest ?? ""),
    rsyncKeySet: bool(row.rsync_key_set),
    rsyncKeyHint: String(row.rsync_key_hint ?? ""),
    s3Enabled: bool(row.s3_enabled),
    s3Bucket: String(row.s3_bucket ?? ""),
    s3Prefix: String(row.s3_prefix ?? "schela/"),
    s3Region: String(row.s3_region ?? "us-east-1"),
    s3AccessKey: String(row.s3_access_key ?? ""),
    s3SecretSet: bool(row.s3_secret_set),
    s3SecretHint: String(row.s3_secret_hint ?? ""),
    s3Endpoint: String(row.s3_endpoint ?? ""),
    createdAt: iso(row.created_at),
  };
}

/**
 * A job as schela-backup reads it from state.json. Secrets are only referenced
 * by file name (schela-backup derives the name from the id and checks it).
 */
export function backupStateEntry(row: Record<string, unknown>) {
  const job = mapBackupJob(row);
  return {
    id: job.id,
    name: job.name,
    scope: job.scope,
    targetId: job.targetId,
    targetDomain: String(row.target_label || ""),
    includeMail: job.includeMail,
    schedule: job.schedule,
    retain: job.retain,
    enabled: job.enabled,
    rsyncEnabled: job.rsyncEnabled,
    rsyncDest: job.rsyncDest,
    rsyncKey: job.rsyncKeySet ? `job-${job.id}.ssh` : "",
    s3Enabled: job.s3Enabled,
    s3Bucket: job.s3Bucket,
    s3Prefix: job.s3Prefix,
    s3Region: job.s3Region,
    s3AccessKey: job.s3AccessKey,
    s3Secret: job.s3SecretSet ? `job-${job.id}.s3` : "",
    s3Endpoint: job.s3Endpoint,
  };
}
