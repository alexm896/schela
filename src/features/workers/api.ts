import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { getSql, type Sql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { runSudoHelper } from "@/server/sudo-helper";
import { mapWorker } from "./map";
import type { SiteWorker } from "./types";
import {
  parseSystemctlShow,
  validateWorker,
  workerUnits,
  type WorkerInstanceStatus,
} from "./workers";

export type SiteWorkerWithStatus = SiteWorker & {
  instances: WorkerInstanceStatus[];
};

const HELPER = "/usr/local/sbin/schela-workers";
const SHOW_PROPS = "Id,ActiveState,SubState,NRestarts,ActiveEnterTimestamp,MemoryCurrent,MainPID";

async function siteLabel(sql: Sql, siteId: number): Promise<string> {
  const rows = await sql<{ domain: string }>`select domain from sites where id = ${siteId}`;
  if (!rows[0]) throw new Error("Site not found");
  return rows[0].domain;
}

async function workerById(sql: Sql, id: number): Promise<SiteWorker> {
  const rows = await sql<Record<string, unknown>>`select * from site_workers where id = ${id}`;
  if (!rows[0]) throw new Error("Worker not found");
  return mapWorker(rows[0]);
}

/** Unit state is world-readable through systemd, so no privileged helper is needed. */
async function readInstances(workers: SiteWorker[]): Promise<Map<number, WorkerInstanceStatus[]>> {
  const result = new Map<number, WorkerInstanceStatus[]>();
  if (!isVpsApply() || workers.length === 0) return result;
  const units = workers.flatMap((w) => workerUnits(w.id, w.processes));
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)(
      "systemctl",
      ["show", `--property=${SHOW_PROPS}`, "--", ...units],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    const byUnit = new Map(parseSystemctlShow(stdout).map((s) => [s.unit, s]));
    for (const w of workers) {
      result.set(
        w.id,
        workerUnits(w.id, w.processes).map(
          (unit) =>
            byUnit.get(unit) ?? {
              unit,
              activeState: "unknown",
              subState: "",
              restarts: 0,
              since: null,
              memoryBytes: null,
              mainPid: null,
            },
        ),
      );
    }
  } catch (err) {
    console.error("[schela] worker status:", err);
  }
  return result;
}

async function runHelper(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!isVpsApply()) throw new Error("Workers are managed on the server only");
  return runSudoHelper(HELPER, req, { label: "Worker command" });
}

const workerFields = {
  preset: z.string().max(20),
  name: z.string().max(80),
  command: z.string().max(500),
  processes: z.number().int(),
  stopTimeout: z.number().int(),
  memoryMb: z.number().int(),
};

export const listSiteWorkers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ siteId: z.number().int().positive() }))
  .handler(async ({ data }): Promise<SiteWorkerWithStatus[]> => {
    const sql = await getSql();
    const workers = (await sql<Record<string, unknown>>`
      select * from site_workers where site_id = ${data.siteId} order by id
    `).map(mapWorker);
    const instances = await readInstances(workers);
    return workers.map((w) => ({ ...w, instances: instances.get(w.id) ?? [] }));
  });

export const createSiteWorker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ siteId: z.number().int().positive(), ...workerFields }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const domain = await siteLabel(sql, data.siteId);
    const w = validateWorker(data);
    const rows = await sql<Record<string, unknown>>`
      insert into site_workers (site_id, name, preset, command, processes, stop_timeout, memory_mb, enabled)
      values (${data.siteId}, ${w.name}, ${w.preset}, ${w.command}, ${w.processes}, ${w.stopTimeout}, ${w.memoryMb}, true)
      returning *
    `;
    await logActivity(sql, "worker", `Added worker ${w.name} to ${domain}`);
    await applyAfterChange(sql);
    return mapWorker(rows[0]);
  });

export const updateSiteWorker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive(), ...workerFields }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await workerById(sql, data.id);
    const w = validateWorker(data);
    const rows = await sql<Record<string, unknown>>`
      update site_workers
      set name = ${w.name},
          preset = ${w.preset},
          command = ${w.command},
          processes = ${w.processes},
          stop_timeout = ${w.stopTimeout},
          memory_mb = ${w.memoryMb}
      where id = ${data.id}
      returning *
    `;
    await logActivity(sql, "worker", `Updated worker ${w.name} on ${await siteLabel(sql, current.siteId)}`);
    await applyAfterChange(sql);
    return mapWorker(rows[0]);
  });

export const setSiteWorkerEnabled = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await workerById(sql, data.id);
    await sql`update site_workers set enabled = ${data.enabled} where id = ${data.id}`;
    await logActivity(
      sql,
      "worker",
      `${data.enabled ? "Started" : "Stopped"} worker ${current.name} on ${await siteLabel(sql, current.siteId)}`,
    );
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const deleteSiteWorker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await workerById(sql, data.id);
    const domain = await siteLabel(sql, current.siteId);
    await sql`delete from site_workers where id = ${data.id}`;
    await logActivity(sql, "worker", `Removed worker ${current.name} from ${domain}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const restartSiteWorker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await workerById(sql, data.id);
    if (!current.enabled) throw new Error("Start the worker before restarting it");
    await runHelper({ op: "restart", id: current.id });
    await logActivity(sql, "worker", `Restarted worker ${current.name} on ${await siteLabel(sql, current.siteId)}`);
    return { ok: true as const };
  });

export const siteWorkerLogs = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.number().int().positive(), lines: z.number().int().min(10).max(500).default(200) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const current = await workerById(sql, data.id);
    const out = await runHelper({ op: "logs", id: current.id, lines: data.lines });
    return { lines: Array.isArray(out.lines) ? out.lines.map(String) : [] };
  });
