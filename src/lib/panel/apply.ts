import type { Sql } from "@/lib/db";
import {
  mapApp,
  mapBackupJob,
  mapModule,
  mapRecord,
  mapRule,
  mapSite,
  mapWorker,
  mapZone,
} from "./map";
import { parseWorkerCommand } from "./workers";
import type { LiveMetrics } from "./types";

export function isVpsApply(): boolean {
  return process.env.SCHELA_APPLY === "1";
}

function statePath(): string {
  const fromEnv = process.env.SCHELA_STATE?.trim();
  if (fromEnv) return fromEnv;
  return "/var/lib/schela/state.json";
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

const sparkRing: number[] = [];

export async function readHostMetrics(): Promise<LiveMetrics | null> {
  if (!isVpsApply()) return null;
  try {
    const fs = await import("node:fs/promises");
    const { promisify } = await import("node:util");
    const { execFile } = await import("node:child_process");
    const execFileAsync = promisify(execFile);

    const uptimeFile = await fs.readFile("/proc/uptime", "utf8");
    const uptimeSec = Math.floor(Number(uptimeFile.split(" ")[0]) || 0);
    const load = Number((await fs.readFile("/proc/loadavg", "utf8")).split(" ")[0]) || 0;
    const mem = await fs.readFile("/proc/meminfo", "utf8");
    const total = Number(/MemTotal:\s+(\d+)/.exec(mem)?.[1] ?? 1);
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1] ?? 0);
    const ram = Math.round((1 - avail / total) * 1000) / 10;
    const cpuinfo = await fs.readFile("/proc/cpuinfo", "utf8");
    const ncpu = (cpuinfo.match(/^processor/gm) ?? []).length || 1;
    const cpu = Math.round(Math.min(100, (load / ncpu) * 100) * 10) / 10;

    let disk = 0;
    try {
      const { stdout } = await execFileAsync("df", ["-P", "/"]);
      const line = stdout.trim().split("\n")[1] ?? "";
      disk = Number(line.split(/\s+/)[4]?.replace("%", "")) || 0;
    } catch {
      disk = 0;
    }

    sparkRing.push(cpu);
    while (sparkRing.length > 24) sparkRing.shift();
    const spark =
      sparkRing.length >= 24
        ? [...sparkRing]
        : Array.from({ length: 24 }, (_, i) => sparkRing[i] ?? cpu);

    return {
      cpu,
      ram,
      disk,
      load: Math.round(load * 100) / 100,
      uptimeSec,
      spark: spark.map((n) => Math.round(n * 10) / 10),
    };
  } catch (err) {
    console.error("[schela] host metrics:", err);
    return null;
  }
}

export function publicIp(): string {
  return process.env.SCHELA_PUBLIC_IP?.trim() || "127.0.0.1";
}
