import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WORKER_PRESETS,
  parseSystemctlShow,
  parseWorkerCommand,
  validateWorker,
  workerUnits,
} from "./workers.ts";

describe("parseWorkerCommand", () => {
  it("splits the Laravel presets into argv", () => {
    assert.deepEqual(parseWorkerCommand(WORKER_PRESETS.queue.command), [
      "php",
      "artisan",
      "queue:work",
      "--sleep=3",
      "--tries=3",
      "--max-time=3600",
    ]);
    assert.deepEqual(parseWorkerCommand("php artisan horizon"), ["php", "artisan", "horizon"]);
    assert.deepEqual(parseWorkerCommand("  php   artisan  schedule:work "), ["php", "artisan", "schedule:work"]);
  });

  it("handles quotes without a shell", () => {
    assert.deepEqual(parseWorkerCommand(`php artisan queue:work "--queue=high,default"`), [
      "php",
      "artisan",
      "queue:work",
      "--queue=high,default",
    ]);
    assert.deepEqual(parseWorkerCommand(`php artisan say 'a | b; $HOME'`), ["php", "artisan", "say", "a | b; $HOME"]);
    assert.deepEqual(parseWorkerCommand(`php artisan say "a \\"b\\" \\\\ c"`), ["php", "artisan", "say", 'a "b" \\ c']);
    assert.deepEqual(parseWorkerCommand(`php artisan x --name="two words"`), ["php", "artisan", "x", "--name=two words"]);
  });

  it("accepts absolute and site-relative executables", () => {
    assert.deepEqual(parseWorkerCommand("/usr/bin/node worker.js"), ["/usr/bin/node", "worker.js"]);
    assert.deepEqual(parseWorkerCommand("bin/worker --once"), ["bin/worker", "--once"]);
  });

  it("rejects shell syntax, control characters and bad executables", () => {
    const bad = [
      "",
      "   ",
      "php artisan queue:work; rm -rf /",
      "php artisan queue:work && whoami",
      "php artisan queue:work | tee x",
      "php artisan queue:work > out.log",
      "php artisan $(whoami)",
      "php artisan `whoami`",
      "php artisan $HOME",
      "php artisan queue:work\nUser=root",
      "php artisan queue:work\rExecStartPre=/bin/sh",
      "php\tartisan",
      "php artisan \u0000",
      "php artisan 'unclosed",
      'php artisan "unclosed',
      "php artisan ''",
      "../evil",
      "/usr/../bin/sh",
      "bin/",
    ];
    for (const raw of bad) {
      assert.throws(() => parseWorkerCommand(raw), Error, JSON.stringify(raw));
    }
  });

  it("treats a bare program name as a path inside the site, not a PATH lookup", () => {
    // apply resolves it to /home/<user>/www/sh, so this cannot reach /bin/sh.
    assert.deepEqual(parseWorkerCommand("sh -c whoami"), ["sh", "-c", "whoami"]);
  });

  it("enforces length and argument limits", () => {
    assert.throws(() => parseWorkerCommand(`php ${"a".repeat(400)}`), /too long/);
    assert.throws(() => parseWorkerCommand(`php ${"a ".repeat(40)}`), /At most 32/);
    assert.throws(() => parseWorkerCommand(`php ${"a".repeat(201)}`), /argument is too long/);
  });
});

describe("validateWorker", () => {
  const base = { preset: "queue", name: "queue", command: "php artisan queue:work", processes: 2, stopTimeout: 3600, memoryMb: 512 };

  it("accepts a valid queue worker", () => {
    const w = validateWorker(base);
    assert.equal(w.processes, 2);
    assert.deepEqual(w.argv, ["php", "artisan", "queue:work"]);
  });

  it("keeps Horizon and the scheduler to one process", () => {
    assert.throws(() => validateWorker({ ...base, preset: "horizon", processes: 2 }), /single process/);
    assert.throws(() => validateWorker({ ...base, preset: "scheduler", processes: 3 }), /single process/);
    assert.equal(validateWorker({ ...base, preset: "scheduler", processes: 1 }).processes, 1);
  });

  it("rejects out-of-range numbers, bad names and unknown presets", () => {
    assert.throws(() => validateWorker({ ...base, processes: 0 }), /Processes/);
    assert.throws(() => validateWorker({ ...base, processes: 9 }), /Processes/);
    assert.throws(() => validateWorker({ ...base, processes: 1.5 }), /Processes/);
    assert.throws(() => validateWorker({ ...base, stopTimeout: 4 }), /Stop timeout/);
    assert.throws(() => validateWorker({ ...base, stopTimeout: 7201 }), /Stop timeout/);
    assert.throws(() => validateWorker({ ...base, memoryMb: 63 }), /Memory/);
    assert.throws(() => validateWorker({ ...base, memoryMb: 8193 }), /Memory/);
    assert.throws(() => validateWorker({ ...base, name: "" }), /Name required/);
    assert.throws(() => validateWorker({ ...base, name: "a%i" }), /Name may use/);
    assert.throws(() => validateWorker({ ...base, name: "x\nUser=root" }), /Name may use/);
    assert.throws(() => validateWorker({ ...base, preset: "root" }), /Unknown worker type/);
  });
});

describe("systemd helpers", () => {
  it("names one template instance per process", () => {
    assert.deepEqual(workerUnits(7, 3), [
      "schela-worker-7@1.service",
      "schela-worker-7@2.service",
      "schela-worker-7@3.service",
    ]);
  });

  it("parses systemctl show output", () => {
    const out = [
      "Id=schela-worker-7@1.service",
      "ActiveState=active",
      "SubState=running",
      "NRestarts=2",
      "ActiveEnterTimestamp=Sat 2026-10-03 17:00:00 UTC",
      "MemoryCurrent=52428800",
      "MainPID=1234",
      "",
      "Id=schela-worker-7@2.service",
      "ActiveState=failed",
      "SubState=failed",
      "NRestarts=10",
      "ActiveEnterTimestamp=n/a",
      "MemoryCurrent=[not set]",
      "MainPID=0",
      "",
    ].join("\n");
    const parsed = parseSystemctlShow(out);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0], {
      unit: "schela-worker-7@1.service",
      activeState: "active",
      subState: "running",
      restarts: 2,
      since: "Sat 2026-10-03 17:00:00 UTC",
      memoryBytes: 52428800,
      mainPid: 1234,
    });
    assert.equal(parsed[1].activeState, "failed");
    assert.equal(parsed[1].since, null);
    assert.equal(parsed[1].memoryBytes, null);
    assert.equal(parsed[1].mainPid, null);
  });
});
