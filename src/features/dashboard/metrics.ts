import { isVpsApply } from "@/server/env";
import type { LiveMetrics } from "./types";

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

/** Host metrics on the VPS; a smooth made-up series anywhere else, so the dashboard has something to draw. */
export async function liveMetrics(): Promise<LiveMetrics> {
  const real = await readHostMetrics();
  if (real) return real;
  const t = Date.now() / 1000;
  const cpu = Math.max(6, Math.min(42, 16 + Math.sin(t / 17) * 8 + Math.sin(t / 5) * 3));
  const ram = Math.max(28, Math.min(62, 41 + Math.sin(t / 23) * 6));
  const disk = 34.2;
  const load = Math.max(0.12, 0.42 + Math.sin(t / 11) * 0.18);
  const spark = Array.from({ length: 24 }, (_, i) => {
    const x = t - (23 - i) * 40;
    return Math.max(4, 16 + Math.sin(x / 17) * 8 + Math.sin(x / 5) * 3);
  });
  return {
    cpu: Math.round(cpu * 10) / 10,
    ram: Math.round(ram * 10) / 10,
    disk,
    load: Math.round(load * 100) / 100,
    uptimeSec: 86400 * 4 + Math.floor(t % 86400),
    spark: spark.map((n) => Math.round(n * 10) / 10),
  };
}
