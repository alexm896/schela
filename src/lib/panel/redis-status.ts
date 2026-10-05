import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/auth/middleware";
import { getSql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { emptyRedisStatus, parseRedisInfo, type RedisStatus } from "./redis";

async function moduleWanted(): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql<{ enabled: boolean | string }>`
    select enabled from modules where slug = 'redis'
  `;
  const v = rows[0]?.enabled;
  return v === true || v === "t" || v === "true";
}

async function execOut(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(cmd, args, { timeout: 4000, encoding: "utf8" });
    return { code: 0, stdout: stdout || "" };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof e.code === "number" ? e.code : 1, stdout: String(e.stdout || "") };
  }
}

async function redisUnit(): Promise<string> {
  const a = await execOut("systemctl", ["cat", "redis-server.service"]);
  if (a.code === 0) return "redis-server";
  const b = await execOut("systemctl", ["cat", "redis.service"]);
  if (b.code === 0) return "redis";
  return "redis-server";
}

export const getRedisStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<RedisStatus> => {
    const wanted = await moduleWanted();
    if (!isVpsApply()) {
      return {
        wanted,
        installed: wanted,
        running: wanted,
        enabledAtBoot: wanted,
        bind: "127.0.0.1",
        port: 6379,
        version: wanted ? "preview" : "",
        usedMemory: wanted ? "—" : "",
        requirepass: wanted ? "preview-only" : "",
        note: wanted
          ? "Preview — on a VPS, Redis listens on 127.0.0.1:6379 with a local password and starts at boot."
          : "Enable the Redis module to install it on this server. Disable only stops it; the package stays.",
      };
    }

    const which = await execOut("sh", ["-c", "command -v redis-server || true"]);
    const installed = Boolean(which.stdout.trim());
    if (!installed) {
      return emptyRedisStatus(
        wanted,
        wanted
          ? "Package not on disk yet — applying the panel will install redis-server."
          : "Not installed. Turn the module on to install; turning it off later only stops the service.",
      );
    }

    const unit = await redisUnit();
    const active = await execOut("systemctl", ["is-active", unit]);
    const enabled = await execOut("systemctl", ["is-enabled", unit]);
    const running = active.stdout.trim() === "active";
    const enabledAtBoot = enabled.stdout.trim() === "enabled";

    let requirepass = "";
    try {
      const fs = await import("node:fs/promises");
      const raw = (await fs.readFile("/var/lib/schela/redis.pass", "utf8")).trim();
      if (/^[a-f0-9]{32,64}$/.test(raw)) requirepass = raw;
    } catch {
      requirepass = "";
    }

    let version = "";
    let usedMemory = "";
    if (running) {
      const auth = requirepass
        ? (["-a", requirepass, "--no-auth-warning"] as string[])
        : [];
      const info = await execOut("redis-cli", [
        "-h",
        "127.0.0.1",
        "-p",
        "6379",
        ...auth,
        "INFO",
        "server",
      ]);
      const mem = await execOut("redis-cli", [
        "-h",
        "127.0.0.1",
        "-p",
        "6379",
        ...auth,
        "INFO",
        "memory",
      ]);
      const server = parseRedisInfo(info.stdout);
      const memory = parseRedisInfo(mem.stdout);
      version = server.redis_version || "";
      usedMemory = memory.used_memory_human || "";
    }

    let note = "Bound to 127.0.0.1:6379 — not opened on the firewall.";
    if (wanted && running && enabledAtBoot) {
      note = "Running. systemd will start it again after a reboot.";
    } else if (wanted && !running) {
      note = "Module is on but Redis is not running. Apply or restart redis-server.";
    } else if (!wanted && running) {
      note = "Module is off — apply will stop Redis and disable boot start without uninstalling.";
    } else if (!wanted && installed) {
      note = "Stopped. The package is still on disk. Enable the module to start it at boot again.";
    }

    return {
      wanted,
      installed,
      running,
      enabledAtBoot,
      bind: "127.0.0.1",
      port: 6379,
      version,
      usedMemory,
      requirepass,
      note,
    };
  });
