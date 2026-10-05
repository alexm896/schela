import type { Sql } from "@/server/db";
import {
  mapApp,
  mapBackupJob,
  mapRecord,
  mapSite,
  mapWorker,
  mapZone,
} from "@/lib/panel/map";
import { DATABASE_ENGINE_KEYS, isAccessLevel, type DatabaseEngine } from "@/lib/panel/databases";
import { parseWorkerCommand } from "@/lib/panel/workers";
import { mapModule } from "@/features/modules/map";
import { mapRule } from "@/features/firewall/map";
import { isVpsApply } from "./env";

function statePath(): string {
  const fromEnv = process.env.SCHELA_STATE?.trim();
  if (fromEnv) return fromEnv;
  return "/var/lib/schela/state.json";
}

type DatabaseEngineState = {
  databases: { name: string }[];
  users: {
    name: string;
    passwordHash: string;
    grants: { database: string; level: string }[];
  }[];
};

/** What schela-db creates and grants, per engine. Hashes only, never passwords. */
async function databaseState(sql: Sql): Promise<Record<DatabaseEngine, DatabaseEngineState>> {
  const databases = await sql<{ engine: string; name: string }>`
    select engine, name from databases order by name
  `;
  const users = await sql<{ id: number; engine: string; name: string; password_hash: string }>`
    select id, engine, name, password_hash from database_users order by name
  `;
  const grants = await sql<{ user_id: number; database: string; level: string }>`
    select database_grants.user_id, databases.name as database, database_grants.level
    from database_grants
    join databases on databases.id = database_grants.database_id
    order by databases.name
  `;
  const out = {} as Record<DatabaseEngine, DatabaseEngineState>;
  for (const engine of DATABASE_ENGINE_KEYS) {
    out[engine] = {
      databases: databases.filter((d) => d.engine === engine).map((d) => ({ name: d.name })),
      users: users
        .filter((u) => u.engine === engine)
        .map((u) => ({
          name: u.name,
          passwordHash: u.password_hash,
          grants: grants
            .filter((g) => Number(g.user_id) === Number(u.id) && isAccessLevel(g.level))
            .map((g) => ({ database: g.database, level: g.level })),
        })),
    };
  }
  return out;
}

export async function dumpAndApply(sql: Sql): Promise<void> {
  if (typeof window !== "undefined") return;
  if (!isVpsApply()) return;

  const settingsRows = await sql<Record<string, unknown>>`
    select * from panel_settings where id = 1
  `;
  const s = settingsRows[0];
  const modules = (await sql<Record<string, unknown>>`select slug, enabled from modules`).map(
    mapModule,
  );
  const sites = (await sql<Record<string, unknown>>`
    select sites.*, ip_addresses.address as ip_address
    from sites
    left join ip_addresses on ip_addresses.id = sites.ip_id
  `).map(mapSite);
  const apps = (await sql<Record<string, unknown>>`
    select node_apps.*, ip_addresses.address as ip_address
    from node_apps
    left join ip_addresses on ip_addresses.id = node_apps.ip_id
  `).map(mapApp);
  const firewall = (await sql<Record<string, unknown>>`select * from firewall_rules`).map(
    mapRule,
  );
  const mailboxRows = await sql<Record<string, unknown>>`
    select address, status, quota_mb, password_hash from mailboxes
  `;
  const zones = (await sql<Record<string, unknown>>`select * from dns_zones`).map(mapZone);
  const records = (await sql<Record<string, unknown>>`select * from dns_records`).map(
    mapRecord,
  );
  let backupRows: Record<string, unknown>[] = [];
  try {
    backupRows = await sql<Record<string, unknown>>`
      select backup_jobs.*,
        coalesce(sites.domain, node_apps.domain) as target_label
      from backup_jobs
      left join sites on backup_jobs.scope = 'site' and sites.id = backup_jobs.target_id
      left join node_apps on backup_jobs.scope = 'app' and node_apps.id = backup_jobs.target_id
    `;
  } catch {
    backupRows = [];
  }
  const cronRows = await sql<Record<string, unknown>>`
    select cron_jobs.*,
      sites.domain as site_domain,
      sites.jail_user as site_user,
      node_apps.name as app_name,
      node_apps.domain as app_domain
    from cron_jobs
    left join sites on cron_jobs.kind = 'site' and sites.id = cron_jobs.target_id
    left join node_apps on cron_jobs.kind = 'app' and node_apps.id = cron_jobs.target_id
  `;

  const workerRows = await sql<Record<string, unknown>>`
    select site_workers.*,
      sites.jail_user as site_user,
      sites.php_version as site_php,
      sites.domain as site_domain,
      sites.status as site_status
    from site_workers
    join sites on sites.id = site_workers.site_id
    order by site_workers.id
  `;
  const workers = workerRows.flatMap((row) => {
    const worker = mapWorker(row);
    let argv: string[];
    try {
      argv = parseWorkerCommand(worker.command);
    } catch (err) {
      console.error(`[schela] skipping worker ${worker.id}:`, err);
      return [];
    }
    return [
      {
        id: worker.id,
        name: worker.name,
        domain: String(row.site_domain),
        user: String(row.site_user),
        phpVersion: String(row.site_php),
        argv,
        processes: worker.processes,
        stopTimeout: worker.stopTimeout,
        memoryMb: worker.memoryMb,
        enabled: worker.enabled && row.site_status === "active",
      },
    ];
  });

  const managedDatabases = await databaseState(sql);

  const moduleMap: Record<string, boolean> = {};
  for (const m of modules) moduleMap[m.slug] = m.enabled;

  const payload = {
    settings: {
      hostname: s ? String(s.hostname) : "localhost",
      isolation: s ? s.isolation === true || s.isolation === "t" : true,
      sshPort: s ? Number(s.ssh_port) : 22,
      autoUpdates: s ? s.auto_updates === true || s.auto_updates === "t" : true,
    },
    modules: moduleMap,
    sites: sites.map((site) => ({
      domain: site.domain,
      systemUser: site.systemUser,
      pool: site.pool,
      phpVersion: site.phpVersion,
      memoryLimit: site.memoryLimit,
      root: site.root,
      status: site.status,
      isolated: site.isolated,
      ssl: site.ssl,
      forceHttps: site.forceHttps,
      ip: site.ipAddress || "",
    })),
    apps: apps.map((app) => ({
      name: app.name,
      domain: app.domain,
      nodeVersion: app.nodeVersion,
      port: app.port,
      entry: app.entry,
      status: app.status,
      ip: app.ipAddress || "",
    })),
    firewall: firewall.map((rule) => ({
      enabled: rule.enabled,
      action: rule.action,
      protocol: rule.protocol,
      port: rule.port,
      source: rule.source,
    })),
    mailboxes: mailboxRows.map((box) => ({
      address: String(box.address),
      status: box.status === "disabled" ? "disabled" : "active",
      quotaMb: Number(box.quota_mb) || 2048,
      passwordHash: String(box.password_hash || ""),
    })),
    backups: backupRows.map((row) => {
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
        rsyncSshKey: job.rsyncSshKey,
        s3Enabled: job.s3Enabled,
        s3Bucket: job.s3Bucket,
        s3Prefix: job.s3Prefix,
        s3Region: job.s3Region,
        s3AccessKey: job.s3AccessKey,
        s3SecretKey: String(row.s3_secret_key || ""),
        s3Endpoint: job.s3Endpoint,
      };
    }),
    cron: cronRows
      .filter((row) => row.enabled === true || row.enabled === "t" || row.enabled === 1)
      .map((row) => {
        const kind = row.kind === "app" ? "app" : "site";
        const appName = String(row.app_name || "");
        const slug = appName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 20);
        const user =
          kind === "site"
            ? String(row.site_user || "")
            : `sa_${slug || "app"}`;
        const cwd =
          kind === "site" ? `/home/${user}/www` : `/home/${user}/app`;
        return {
          enabled: true,
          user,
          schedule: String(row.schedule),
          command: String(row.command),
          cwd,
        };
      }),
    workers,
    databases: managedDatabases,
    dns: {
      zones: zones.map((zone) => ({
        name: zone.name,
        serial: zone.serial,
        records: records
          .filter((r) => r.zoneId === zone.id)
          .map((r) => ({
            type: r.type,
            name: r.name,
            value: r.value,
            ttl: r.ttl,
            priority: r.priority,
          })),
      })),
    },
  };

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dest = statePath();
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(tmp, dest);

  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sudo", ["-n", "/usr/local/sbin/schela-apply"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `schela-apply exited ${code}`));
    });
  });
}

export async function applyAfterChange(sql: Sql): Promise<void> {
  try {
    await dumpAndApply(sql);
  } catch (err) {
    console.error("[schela] apply failed:", err);
    throw new Error(
      err instanceof Error ? err.message : "Could not apply this change on the server",
    );
  }
}
