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
  const secret = String(row.s3_secret_key ?? "");
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
    rsyncSshKey: String(row.rsync_ssh_key ?? ""),
    s3Enabled: bool(row.s3_enabled),
    s3Bucket: String(row.s3_bucket ?? ""),
    s3Prefix: String(row.s3_prefix ?? "schela/"),
    s3Region: String(row.s3_region ?? "us-east-1"),
    s3AccessKey: String(row.s3_access_key ?? ""),
    s3HasSecret: secret.length > 0,
    s3Endpoint: String(row.s3_endpoint ?? ""),
    createdAt: iso(row.created_at),
  };
}
