import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { getSql, type Sql } from "@/server/db";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { isVpsApply } from "@/server/env";
import {
  assertRsyncDest,
  assertS3Bucket,
  assertS3Prefix,
  assertSshKey,
  parseBackupScope,
  type BackupJob,
  type BackupRun,
  type BackupScope,
} from "./backup";
import { mapApp } from "@/features/apps/map";
import { mapSite } from "@/features/sites/map";
import { mapBackupJob } from "./map";
import { assertCronSchedule } from "@/features/cron/cron";

function backupRoot(): string {
  if (isVpsApply()) return "/var/lib/schela/backups";
  return path.join(tmpdir(), "schela-files", "backups");
}

function historyPath(): string {
  return path.join(backupRoot(), "history.jsonl");
}

async function listJobRows(sql: Sql): Promise<BackupJob[]> {
  const rows = await sql<Record<string, unknown>>`
    select backup_jobs.*,
      coalesce(sites.domain, node_apps.domain) as target_label
    from backup_jobs
    left join sites on backup_jobs.scope = 'site' and sites.id = backup_jobs.target_id
    left join node_apps on backup_jobs.scope = 'app' and node_apps.id = backup_jobs.target_id
    order by backup_jobs.id desc
  `;
  return rows.map(mapBackupJob);
}

async function readHistory(): Promise<BackupRun[]> {
  const fs = await import("node:fs/promises");
  try {
    const raw = await fs.readFile(historyPath(), "utf8");
    const runs: BackupRun[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const status =
          row.status === "ok" || row.status === "partial" || row.status === "error"
            ? row.status
            : "error";
        runs.push({
          jobId: Number(row.jobId) || 0,
          name: String(row.name || ""),
          status,
          startedAt: String(row.startedAt || ""),
          finishedAt: String(row.finishedAt || ""),
          sizeBytes: Number(row.sizeBytes) || 0,
          localPath: String(row.localPath || ""),
          localOk: row.localOk === true,
          rsyncEnabled: row.rsyncEnabled === true,
          rsyncOk: row.rsyncOk === true,
          s3Enabled: row.s3Enabled === true,
          s3Ok: row.s3Ok === true,
          message: String(row.message || ""),
        });
      } catch {
        /* skip bad line */
      }
    }
    return runs.reverse().slice(0, 40);
  } catch {
    return [];
  }
}

async function appendHistory(run: BackupRun): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(backupRoot(), { recursive: true });
  await fs.appendFile(historyPath(), `${JSON.stringify(run)}\n`);
}

export const listBackups = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const sql = await getSql();
    const jobs = await listJobRows(sql);
    const sites = (await sql<Record<string, unknown>>`select * from sites order by domain`).map(
      mapSite,
    );
    const apps = (await sql<Record<string, unknown>>`select * from node_apps order by name`).map(
      mapApp,
    );
    const runs = await readHistory();
    return { jobs, runs, sites, apps };
  });

const jobInput = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(["all", "sites", "apps", "mail", "site", "app"]),
  targetId: z.number().int().positive().nullable(),
  includeMail: z.boolean().default(true),
  schedule: z.string().min(5).max(80),
  retain: z.number().int().min(1).max(90).default(7),
  enabled: z.boolean().default(true),
  rsyncEnabled: z.boolean().default(false),
  rsyncDest: z.string().max(240).default(""),
  rsyncSshKey: z.string().max(240).default(""),
  s3Enabled: z.boolean().default(false),
  s3Bucket: z.string().max(80).default(""),
  s3Prefix: z.string().max(120).default("schela/"),
  s3Region: z.string().max(40).default("us-east-1"),
  s3AccessKey: z.string().max(128).default(""),
  s3SecretKey: z.string().max(256).default(""),
  s3Endpoint: z.string().max(200).default(""),
});

function normalizeJob(data: z.infer<typeof jobInput>) {
  const scope = parseBackupScope(data.scope);
  const schedule = assertCronSchedule(data.schedule);
  if ((scope === "site" || scope === "app") && !data.targetId) {
    throw new Error("Pick a site or app for this backup");
  }
  const rsyncDest = data.rsyncEnabled ? assertRsyncDest(data.rsyncDest) : data.rsyncDest.trim();
  const rsyncSshKey = data.rsyncEnabled ? assertSshKey(data.rsyncSshKey) : data.rsyncSshKey.trim();
  const s3Bucket = data.s3Enabled ? assertS3Bucket(data.s3Bucket) : data.s3Bucket.trim();
  const s3Prefix = assertS3Prefix(data.s3Prefix);
  if (data.s3Enabled && !data.s3AccessKey.trim()) {
    throw new Error("S3 access key is required");
  }
  return {
    name: data.name.trim(),
    scope,
    targetId: scope === "site" || scope === "app" ? data.targetId : null,
    includeMail: data.includeMail,
    schedule,
    retain: data.retain,
    enabled: data.enabled,
    rsyncEnabled: data.rsyncEnabled,
    rsyncDest,
    rsyncSshKey,
    s3Enabled: data.s3Enabled,
    s3Bucket,
    s3Prefix,
    s3Region: data.s3Region.trim() || "us-east-1",
    s3AccessKey: data.s3AccessKey.trim(),
    s3SecretKey: data.s3SecretKey,
    s3Endpoint: data.s3Endpoint.trim().replace(/\/+$/, ""),
  };
}

export const createBackupJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(jobInput)
  .handler(async ({ data }) => {
    const job = normalizeJob(data);
    if (job.s3Enabled && !job.s3SecretKey.trim()) {
      throw new Error("S3 secret key is required");
    }
    const sql = await getSql();
    await sql`
      insert into backup_jobs (
        name, scope, target_id, include_mail, schedule, retain, enabled,
        rsync_enabled, rsync_dest, rsync_ssh_key,
        s3_enabled, s3_bucket, s3_prefix, s3_region, s3_access_key, s3_secret_key, s3_endpoint
      ) values (
        ${job.name}, ${job.scope}, ${job.targetId}, ${job.includeMail}, ${job.schedule},
        ${job.retain}, ${job.enabled},
        ${job.rsyncEnabled}, ${job.rsyncDest}, ${job.rsyncSshKey},
        ${job.s3Enabled}, ${job.s3Bucket}, ${job.s3Prefix}, ${job.s3Region},
        ${job.s3AccessKey}, ${job.s3SecretKey.trim()}, ${job.s3Endpoint}
      )
    `;
    await logActivity(sql, "backup", `Created backup ${job.name}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const updateBackupJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(jobInput.extend({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const job = normalizeJob(data);
    const sql = await getSql();
    const current = await sql<{ s3_secret_key: string }>`
      select s3_secret_key from backup_jobs where id = ${data.id}
    `;
    if (!current[0]) throw new Error("Backup job not found");
    const secret = job.s3SecretKey.trim() || current[0].s3_secret_key;
    if (job.s3Enabled && !secret) throw new Error("S3 secret key is required");
    await sql`
      update backup_jobs set
        name = ${job.name},
        scope = ${job.scope},
        target_id = ${job.targetId},
        include_mail = ${job.includeMail},
        schedule = ${job.schedule},
        retain = ${job.retain},
        enabled = ${job.enabled},
        rsync_enabled = ${job.rsyncEnabled},
        rsync_dest = ${job.rsyncDest},
        rsync_ssh_key = ${job.rsyncSshKey},
        s3_enabled = ${job.s3Enabled},
        s3_bucket = ${job.s3Bucket},
        s3_prefix = ${job.s3Prefix},
        s3_region = ${job.s3Region},
        s3_access_key = ${job.s3AccessKey},
        s3_secret_key = ${secret},
        s3_endpoint = ${job.s3Endpoint}
      where id = ${data.id}
    `;
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const toggleBackupJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`update backup_jobs set enabled = ${data.enabled} where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const deleteBackupJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await sql`delete from backup_jobs where id = ${data.id}`;
    await applyAfterChange(sql);
    return { ok: true as const };
  });

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function sandboxRun(job: BackupJob): Promise<BackupRun> {
  const fs = await import("node:fs/promises");
  const startedAt = new Date().toISOString();
  const dir = path.join(backupRoot(), `${job.id}-${job.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}`);
  await fs.mkdir(dir, { recursive: true });
  const localPath = path.join(dir, `schela-${stamp()}.tar.gz`);
  const body = gzipSync(
    Buffer.from(
      `schela sandbox backup\njob=${job.name}\nscope=${job.scope}\nwhen=${startedAt}\n`,
      "utf8",
    ),
  );
  await fs.writeFile(localPath, body);
  const files = (await fs.readdir(dir)).filter((n) => n.endsWith(".tar.gz")).sort();
  while (files.length > job.retain) {
    const old = files.shift();
    if (old) await fs.rm(path.join(dir, old), { force: true });
  }
  const notes = ["local sandbox copy"];
  if (job.rsyncEnabled) notes.push("rsync skipped (not on the VPS)");
  if (job.s3Enabled) notes.push("s3 skipped (not on the VPS)");
  const run: BackupRun = {
    jobId: job.id,
    name: job.name,
    status: "ok",
    startedAt,
    finishedAt: new Date().toISOString(),
    sizeBytes: body.length,
    localPath,
    localOk: true,
    rsyncEnabled: job.rsyncEnabled,
    rsyncOk: false,
    s3Enabled: job.s3Enabled,
    s3Ok: false,
    message: notes.join("; "),
  };
  await appendHistory(run);
  return run;
}

async function vpsRun(jobId: number): Promise<BackupRun> {
  if (typeof window !== "undefined") throw new Error("Backups run on the server");
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-n", "/usr/local/sbin/schela-backup", "run", String(jobId)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Backup timed out (10 minutes)"));
    }, 600_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      out += c;
    });
    child.stderr.on("data", (c: string) => {
      err += c;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() || "";
      try {
        const parsed = JSON.parse(line) as BackupRun & { ok?: boolean; error?: string };
        if (parsed.error && parsed.ok === false) {
          reject(new Error(parsed.error));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error(err.trim() || line || `schela-backup exited ${code}`));
      }
    });
  });
}

export const runBackupJob = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const jobs = await listJobRows(sql);
    const job = jobs.find((j) => j.id === data.id);
    if (!job) throw new Error("Backup job not found");
    await applyAfterChange(sql);
    const run = isVpsApply() ? await vpsRun(job.id) : await sandboxRun(job);
    await logActivity(
      sql,
      "backup",
      run.status === "ok"
        ? `Backup ${job.name} finished`
        : `Backup ${job.name}: ${run.status}`,
    );
    return run;
  });

export type { BackupScope };
