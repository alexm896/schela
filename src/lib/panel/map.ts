import { bool, iso, nullableNum, nullableText, num } from "@/server/rows";
import type { BackupJob, BackupScope } from "./backup";
import { isAccessLevel, type DatabaseEngine } from "./databases";
import type {
  CronJob,
  DatabaseGrant,
  DatabaseUser,
  DnsRecord,
  DnsZone,
  IpAddress,
  Mailbox,
  ManagedDatabase,
  SiteWorker,
} from "./types";

export function mapMailbox(row: Record<string, unknown>): Mailbox {
  return {
    id: num(row.id),
    address: String(row.address),
    quotaMb: num(row.quota_mb),
    usedMb: num(row.used_mb),
    status: row.status === "disabled" ? "disabled" : "active",
    hasPassword: bool(row.has_password) || (typeof row.password_hash === "string" && row.password_hash.length > 0),
    createdAt: iso(row.created_at),
  };
}

export function mapIp(row: Record<string, unknown>): IpAddress {
  return {
    id: num(row.id),
    address: String(row.address),
    label: String(row.label ?? ""),
    siteId: row.site_id == null || row.site_id === "" ? null : num(row.site_id),
    appId: row.app_id == null || row.app_id === "" ? null : num(row.app_id),
    assignedTo: row.assigned_to == null || row.assigned_to === "" ? null : String(row.assigned_to),
    createdAt: iso(row.created_at),
  };
}

export function mapWorker(row: Record<string, unknown>): SiteWorker {
  return {
    id: num(row.id),
    siteId: num(row.site_id),
    name: String(row.name),
    preset: String(row.preset),
    command: String(row.command),
    processes: num(row.processes),
    stopTimeout: num(row.stop_timeout),
    memoryMb: num(row.memory_mb),
    enabled: bool(row.enabled),
    createdAt: iso(row.created_at),
  };
}

function engine(value: unknown): DatabaseEngine {
  return value === "postgresql" ? "postgresql" : "mariadb";
}

export function mapDatabase(row: Record<string, unknown>): ManagedDatabase {
  return {
    id: num(row.id),
    engine: engine(row.engine),
    name: String(row.name),
    siteId: nullableNum(row.site_id),
    siteDomain: nullableText(row.site_domain),
    appId: nullableNum(row.app_id),
    appName: nullableText(row.app_name),
    createdAt: iso(row.created_at),
  };
}

/** `grants` are rows of database_grants joined with the database name. */
export function mapDatabaseUser(
  row: Record<string, unknown>,
  grants: Record<string, unknown>[],
): DatabaseUser {
  const id = num(row.id);
  return {
    id,
    engine: engine(row.engine),
    name: String(row.name),
    grants: grants
      .filter((g) => num(g.user_id) === id)
      .flatMap((g): DatabaseGrant[] =>
        isAccessLevel(g.level)
          ? [{ databaseId: num(g.database_id), databaseName: String(g.database_name), level: g.level }]
          : [],
      ),
    createdAt: iso(row.created_at),
  };
}

export function mapCron(row: Record<string, unknown>): CronJob {
  return {
    id: num(row.id),
    kind: row.kind === "app" ? "app" : "site",
    targetId: num(row.target_id),
    targetLabel: String(row.target_label ?? ""),
    user: String(row.user ?? ""),
    name: String(row.name ?? ""),
    schedule: String(row.schedule),
    command: String(row.command),
    enabled: bool(row.enabled),
    createdAt: iso(row.created_at),
  };
}

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

export function mapZone(row: Record<string, unknown>): DnsZone {
  return {
    id: num(row.id),
    name: String(row.name),
    serial: num(row.serial),
    status: String(row.status),
  };
}

export function mapRecord(row: Record<string, unknown>): DnsRecord {
  return {
    id: num(row.id),
    zoneId: num(row.zone_id),
    type: String(row.type),
    name: String(row.name),
    value: String(row.value),
    ttl: num(row.ttl),
    priority: row.priority == null ? null : num(row.priority),
  };
}
