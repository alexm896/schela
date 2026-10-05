export type RedisStatus = {
  wanted: boolean;
  installed: boolean;
  running: boolean;
  enabledAtBoot: boolean;
  bind: string;
  port: number;
  version: string;
  usedMemory: string;
  requirepass: string;
  note: string;
};

export function parseRedisInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

export function emptyRedisStatus(wanted: boolean, note: string): RedisStatus {
  return {
    wanted,
    installed: false,
    running: false,
    enabledAtBoot: false,
    bind: "127.0.0.1",
    port: 6379,
    version: "",
    usedMemory: "",
    requirepass: "",
    note,
  };
}
