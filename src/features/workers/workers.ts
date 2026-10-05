// Pure helpers for site workers (long-running processes such as Laravel
// queue workers) and the site document root. No I/O: shared by the server
// functions, the state dump, the UI and the tests.

export const WORKER_PRESETS = {
  queue: {
    label: "Queue worker",
    name: "queue",
    command: "php artisan queue:work --sleep=3 --tries=3 --max-time=3600",
    processes: 1,
    stopTimeout: 3600,
    memoryMb: 512,
    singleton: false,
  },
  horizon: {
    label: "Horizon",
    name: "horizon",
    command: "php artisan horizon",
    processes: 1,
    stopTimeout: 3600,
    memoryMb: 1024,
    singleton: true,
  },
  scheduler: {
    label: "Scheduler",
    name: "scheduler",
    command: "php artisan schedule:work",
    processes: 1,
    stopTimeout: 60,
    memoryMb: 256,
    singleton: true,
  },
  custom: {
    label: "Custom",
    name: "worker",
    command: "",
    processes: 1,
    stopTimeout: 60,
    memoryMb: 512,
    singleton: false,
  },
} as const;

export type WorkerPreset = keyof typeof WORKER_PRESETS;
export const WORKER_PRESET_KEYS = Object.keys(WORKER_PRESETS) as WorkerPreset[];

export const WORKER_LIMITS = {
  processes: { min: 1, max: 8 },
  stopTimeout: { min: 5, max: 7200 },
  memoryMb: { min: 64, max: 8192 },
  commandLength: 400,
  args: 32,
  argLength: 200,
} as const;

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
// Characters that only mean something to a shell. Workers run without one, so
// an unquoted pipe or redirect would silently become a literal argument.
const SHELL_ONLY = new Set([";", "&", "|", "<", ">", "`", "$", "(", ")", "\\"]);
const PATH_TOKEN = /^[A-Za-z0-9._/-]+$/;

function hasDotDotSegment(path: string): boolean {
  return path.split("/").some((part) => part === "..");
}

/**
 * Split a worker command into argv without a shell. Supports '…' and "…"
 * quoting (inside double quotes only \" and \\ are escapes). Rejects control
 * characters and unquoted shell syntax so what the admin types is exactly what
 * runs.
 */
export function parseWorkerCommand(raw: string): string[] {
  const input = String(raw ?? "").trim();
  if (!input) throw new Error("Command required");
  if (input.length > WORKER_LIMITS.commandLength) throw new Error("Command is too long");
  if (hasControlChars(input)) throw new Error("Command cannot contain newlines or control characters");

  const args: string[] = [];
  let current = "";
  let inToken = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) {
        current += input[i + 1];
        i++;
      } else current += ch;
      continue;
    }
    if (ch === " ") {
      if (inToken) {
        args.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }
    if (SHELL_ONLY.has(ch)) {
      throw new Error(
        `Workers run without a shell, so "${ch}" is not allowed. Quote it if it is part of an argument.`,
      );
    }
    current += ch;
    inToken = true;
  }
  if (quote) throw new Error("Unclosed quote in command");
  if (inToken) args.push(current);

  if (args.length === 0) throw new Error("Command required");
  if (args.length > WORKER_LIMITS.args) throw new Error(`At most ${WORKER_LIMITS.args} arguments`);
  for (const arg of args) {
    if (arg.length === 0) throw new Error("Empty arguments are not allowed");
    if (arg.length > WORKER_LIMITS.argLength) throw new Error("An argument is too long");
  }

  const exe = args[0];
  if (exe !== "php") {
    if (!PATH_TOKEN.test(exe) || hasDotDotSegment(exe) || exe.endsWith("/")) {
      throw new Error('Start the command with "php", an absolute path, or a path inside the site');
    }
  }
  return args;
}

export function assertWorkerName(raw: string): string {
  const name = String(raw ?? "").trim();
  if (!name) throw new Error("Name required");
  if (name.length > 60) throw new Error("Name is too long");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(name)) {
    throw new Error("Name may use letters, numbers, spaces, dots, dashes and underscores");
  }
  return name;
}

function assertIntInRange(value: unknown, label: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

export type WorkerInput = {
  preset: string;
  name: string;
  command: string;
  processes: number;
  stopTimeout: number;
  memoryMb: number;
};

export type ValidWorker = {
  preset: WorkerPreset;
  name: string;
  command: string;
  argv: string[];
  processes: number;
  stopTimeout: number;
  memoryMb: number;
};

export function validateWorker(input: WorkerInput): ValidWorker {
  const preset = WORKER_PRESET_KEYS.includes(input.preset as WorkerPreset)
    ? (input.preset as WorkerPreset)
    : null;
  if (!preset) throw new Error("Unknown worker type");
  const name = assertWorkerName(input.name);
  const command = String(input.command ?? "").trim();
  const argv = parseWorkerCommand(command);
  const { processes: p, stopTimeout: s, memoryMb: m } = WORKER_LIMITS;
  const processes = assertIntInRange(input.processes, "Processes", p.min, p.max);
  if (WORKER_PRESETS[preset].singleton && processes !== 1) {
    throw new Error(`${WORKER_PRESETS[preset].label} must run as a single process`);
  }
  return {
    preset,
    name,
    command,
    argv,
    processes,
    stopTimeout: assertIntInRange(input.stopTimeout, "Stop timeout", s.min, s.max),
    memoryMb: assertIntInRange(input.memoryMb, "Memory limit", m.min, m.max),
  };
}

export function workerUnits(id: number, processes: number): string[] {
  return Array.from({ length: processes }, (_, i) => `schela-worker-${id}@${i + 1}.service`);
}

export type WorkerInstanceStatus = {
  unit: string;
  activeState: string;
  subState: string;
  restarts: number;
  since: string | null;
  memoryBytes: number | null;
  mainPid: number | null;
};

/** Parse `systemctl show --property=… unit…` output (blocks split by blank lines). */
export function parseSystemctlShow(output: string): WorkerInstanceStatus[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => {
      const props: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const at = line.indexOf("=");
        if (at > 0) props[line.slice(0, at)] = line.slice(at + 1);
      }
      return props;
    })
    .filter((props) => props.Id)
    .map((props) => {
      const memory = Number(props.MemoryCurrent);
      const pid = Number(props.MainPID);
      const restarts = Number(props.NRestarts);
      return {
        unit: props.Id,
        activeState: props.ActiveState || "unknown",
        subState: props.SubState || "",
        restarts: Number.isFinite(restarts) ? restarts : 0,
        since: props.ActiveEnterTimestamp && props.ActiveEnterTimestamp !== "n/a" ? props.ActiveEnterTimestamp : null,
        memoryBytes: Number.isFinite(memory) && memory > 0 && memory < 2 ** 62 ? memory : null,
        mainPid: Number.isFinite(pid) && pid > 0 ? pid : null,
      };
    });
}
