import type { BackupJob, BackupScope } from "./backup";
import type {
  Activity,
  CronJob,
  DnsRecord,
  DnsZone,
  FirewallRule,
  IpAddress,
  Mailbox,
  ModuleRow,
  NodeApp,
  Site,
  SiteWorker,
} from "./types";

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function bool(value: unknown) {
  return value === true || value === "t" || value === "true" || value === 1;
}

function num(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function mapSite(row: Record<string, unknown>): Site {
  const status = row.status === "stopped" ? "stopped" : "active";
  return {
    id: num(row.id),
    domain: String(row.domain),
    phpVersion: String(row.php_version),
    root: String(row.root),
    ssl: bool(row.ssl),
    forceHttps: bool(row.force_https),
    isolated: bool(row.isolated),
    systemUser: String(row.jail_user),
    pool: String(row.pool),
    status,
    memoryLimit: String(row.memory_limit),
    ipId: row.ip_id == null || row.ip_id === "" ? null : num(row.ip_id),
    ipAddress: row.ip_address == null || row.ip_address === "" ? null : String(row.ip_address),
    createdAt: iso(row.created_at),
  };
}

export function mapApp(row: Record<string, unknown>): NodeApp {
  const status = row.status === "stopped" ? "stopped" : "running";
  return {
    id: num(row.id),
    name: String(row.name),
    domain: String(row.domain),
    nodeVersion: String(row.node_version),
    port: num(row.port),
    status,
    entry: String(row.entry),
    instances: num(row.instances),
    memoryMb: num(row.memory_mb),
    ipId: row.ip_id == null || row.ip_id === "" ? null : num(row.ip_id),
    ipAddress: row.ip_address == null || row.ip_address === "" ? null : String(row.ip_address),
    createdAt: iso(row.created_at),
  };
}

export function mapRule(row: Record<string, unknown>): FirewallRule {
  return {
    id: num(row.id),
    direction: row.direction === "out" ? "out" : "in",
    action: row.action === "deny" ? "deny" : "allow",
    protocol:
      row.protocol === "udp" ? "udp" : row.protocol === "any" ? "any" : "tcp",
    port: String(row.port),
    source: String(row.source),
    comment: String(row.comment ?? ""),
    enabled: bool(row.enabled),
  };
}

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

export function mapModule(row: Record<string, unknown>): ModuleRow {
  return {
    id: num(row.id),
    slug: String(row.slug),
    name: String(row.name),
    description: String(row.description),
    version: String(row.version),
    enabled: bool(row.enabled),
    core: bool(row.core),
    sortOrder: num(row.sort_order),
  };
}

export function mapActivity(row: Record<string, unknown>): Activity {
  return {
    id: num(row.id),
    kind: String(row.kind),
    message: String(row.message),
    createdAt: iso(row.created_at),
  };
}
