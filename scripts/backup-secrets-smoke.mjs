#!/usr/bin/env node
/**
 * Backup secrets against the built panel (`npm run build` first), run as on the
 * server (SCHELA_APPLY=1) with `sudo` stubbed: schela-apply does nothing and
 * schela-backup-keys keeps its store in a temp folder. The real helper and
 * schela-backup are covered by installer/test/secrets.sh.
 *
 * Checks that the S3 secret and the SSH key never reach the database,
 * state.json or the panel's answers; that older panels' secrets are moved out
 * of both; that editing without a secret keeps it; that deleting removes it.
 *
 *   npm run test:auth
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { toJSON } from "seroval";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, ".output/server/index.mjs");
if (!existsSync(entry)) {
  console.error("backup-secrets-smoke: no build at .output/server/index.mjs (run npm run build)");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "schela-backup-secrets-"));
const dataDir = join(tmp, "pglite");
const keysDir = join(tmp, "keys");
const binDir = join(tmp, "bin");
const statePath = join(tmp, "state.json");
const helperLog = join(tmp, "helper.jsonl");
const applyLog = join(tmp, "apply.log");
mkdirSync(keysDir);
mkdirSync(binDir);

// The stand-in for `sudo -n /usr/local/sbin/<helper>`.
writeFileSync(
  join(binDir, "sudo-stub.mjs"),
  `import { appendFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
const helper = process.argv[3] || "";
if (helper.endsWith("/schela-backup-keys")) {
  const req = JSON.parse(readFileSync(0, "utf8"));
  appendFileSync(${JSON.stringify(helperLog)}, JSON.stringify(req) + "\\n");
  const dir = ${JSON.stringify(keysDir)};
  const file = (job, kind) => dir + "/job-" + job + "." + kind;
  let hint = "";
  if (req.op === "set" && req.value === "stuck-secret-0000") {
    process.stdout.write(JSON.stringify({ ok: false, error: "refused" }) + "\\n");
    process.exit(1);
  }
  if (req.op === "set") {
    writeFileSync(file(req.job, req.kind), req.value);
    hint = req.kind === "s3" ? req.value.slice(-4) : "SHA256:stub";
  } else if (req.op === "import") {
    writeFileSync(file(req.job, "ssh"), readFileSync(req.path));
    hint = "SHA256:stub";
  } else if (req.op === "delete") {
    for (const job of req.jobs) for (const kind of req.kind ? [req.kind] : ["s3", "ssh"]) {
      if (existsSync(file(job, kind))) unlinkSync(file(job, kind));
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, hint }) + "\\n");
} else if (helper.endsWith("/schela-apply")) {
  appendFileSync(${JSON.stringify(applyLog)}, "apply\\n");
  process.exit(0);
} else {
  process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
}
`,
);
writeFileSync(join(binDir, "sudo"), `#!/bin/sh\nexec "${process.execPath}" "${join(binDir, "sudo-stub.mjs")}" "$@"\n`);
chmodSync(join(binDir, "sudo"), 0o755);

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const { port: p } = s.address();
    s.close(() => resolve(p));
  });
});
const origin = `http://localhost:${port}`;
const password = "Admin-Pass-123";

let log = "";
let server = null;
async function start() {
  server = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      PORT: String(port),
      HOST: "127.0.0.1",
      SCHELA_DATA_DIR: dataDir,
      SCHELA_ADMIN_DIR: tmp,
      SCHELA_ADMIN_PASSWORD: password,
      SCHELA_APPLY: "1",
      SCHELA_STATE: statePath,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "backup-smoke-secret-0123456789abcdef",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${origin}/login`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("panel did not start");
}
async function stop() {
  if (!server) return;
  const s = server;
  server = null;
  s.kill("SIGTERM");
  await new Promise((r) => s.once("exit", r));
}
async function withDb(fn) {
  const db = new PGlite(dataDir);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(name, false, err instanceof Error ? err.message : String(err));
  }
}

// Server functions by name, from the build's manifest.
const manifest = readFileSync(join(root, ".output/server/_ssr/ssr.mjs"), "utf8");
function serverFnId(name) {
  const m = manifest.match(new RegExp(`"([0-9a-f]{16,})": \\{\\s*functionName: "${name}_createServerFn_handler"`));
  if (!m) throw new Error(`server function ${name} not in the build`);
  return m[1];
}
let cookie = "";
async function callFn(name, data, method = "POST") {
  const id = serverFnId(name);
  const headers = { Origin: origin, "x-tsr-serverFn": "true", Cookie: cookie };
  let res;
  if (method === "GET") {
    res = await fetch(`${origin}/_serverFn/${id}`, { headers });
  } else {
    res = await fetch(`${origin}/_serverFn/${id}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(toJSON({ data })),
    });
  }
  const text = await res.text();
  if (!res.ok || text.includes('"Error"')) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text;
}
const readState = () => (existsSync(statePath) ? readFileSync(statePath, "utf8") : "");
const stateJob = (id) => (JSON.parse(readState()).backups || []).find((j) => j.id === id);
const keyFile = (id, kind) => join(keysDir, `job-${id}.${kind}`);
const readKey = (id, kind) => (existsSync(keyFile(id, kind)) ? readFileSync(keyFile(id, kind), "utf8") : null);

const SSH_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
  "QyNTUxOQAAACBsmokeKEYbodyNOTREALxxxxxxxxxxxxxxxxxxxxxxxxxxAAAA",
  "-----END OPENSSH PRIVATE KEY-----",
  "",
].join("\n");
const KEY_BODY = "QyNTUxOQAAACBsmokeKEYbodyNOTREAL";

function job(name, extra = {}) {
  return {
    name,
    scope: "all",
    targetId: null,
    includeMail: false,
    schedule: "0 3 * * *",
    retain: 3,
    enabled: true,
    rsyncEnabled: false,
    rsyncDest: "",
    rsyncSshKey: "",
    s3Enabled: false,
    s3Bucket: "",
    s3Prefix: "schela/",
    s3Region: "us-east-1",
    s3AccessKey: "",
    s3SecretKey: "",
    s3Endpoint: "",
    ...extra,
  };
}
const s3 = (secret) => ({
  s3Enabled: true,
  s3Bucket: "schela-smoke",
  s3AccessKey: "AKIASMOKE",
  s3SecretKey: secret,
});
async function jobId(name) {
  const rows = await withDbOnline(`select id from backup_jobs where name = '${name}'`);
  return Number(rows[0]?.id);
}
// The panel holds the database open; read it through a copy of what it wrote.
async function withDbOnline(query) {
  await stop();
  try {
    return await withDb(async (db) => (await db.query(query)).rows);
  } finally {
    await start();
    await signIn();
  }
}
async function signIn() {
  const res = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@schela.local", password }),
  });
  if (res.status !== 200) throw new Error(`sign-in HTTP ${res.status}`);
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

try {
  // An older panel's data: the S3 secret in the database and state.json, the
  // path of an SSH key file.
  await start();
  await stop();
  const legacyKey = join(tmp, "legacy_ed25519");
  writeFileSync(legacyKey, SSH_KEY, { mode: 0o600 });
  await withDb(async (db) => {
    await db.query(
      `insert into backup_jobs (name, rsync_enabled, rsync_dest, rsync_ssh_key,
         s3_enabled, s3_bucket, s3_access_key, s3_secret_key)
       values ('legacy', true, 'backup@offsite.example:/srv', $1, true, 'schela-old', 'AKIAOLD', 'legacy-secret-1234')`,
      [legacyKey],
    );
  });
  writeFileSync(
    statePath,
    JSON.stringify({ backups: [{ id: 1, name: "legacy", s3SecretKey: "legacy-secret-1234", rsyncSshKey: legacyKey }] }),
  );
  await start();
  await fetch(`${origin}/login`).then((r) => r.text());
  // The login page starts the move in the background: wait for its apply.
  for (let i = 0; i < 60 && readState().includes("legacy-secret-1234"); i++) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await stop();

  await step("older panel: S3 secret and key path are gone from the database", async () => {
    const rows = await withDb(
      async (db) => (await db.query("select id, s3_secret_key, rsync_ssh_key from backup_jobs where name = 'legacy'")).rows,
    );
    check(
      "older panel: S3 secret and key path are gone from the database",
      rows.length === 1 && rows[0].s3_secret_key === "" && rows[0].rsync_ssh_key === "",
      JSON.stringify(rows),
    );
  });
  await step("older panel: state.json no longer holds the S3 secret", async () => {
    const state = readState();
    check(
      "older panel: state.json no longer holds the S3 secret",
      !state.includes("legacy-secret-1234") && !state.includes("s3SecretKey"),
      state.slice(0, 300),
    );
  });
  await step("older panel: secrets moved to the key files", async () => {
    const rows = await withDb(async (db) => (await db.query("select id from backup_jobs where name = 'legacy'")).rows);
    const id = Number(rows[0]?.id);
    check(
      "older panel: secrets moved to the key files",
      readKey(id, "s3") === "legacy-secret-1234" && readKey(id, "ssh")?.includes(KEY_BODY) === true,
      `s3=${readKey(id, "s3")} ssh=${Boolean(readKey(id, "ssh"))}`,
    );
  });

  // A secret the helper refuses stays behind. The login page is public: it may
  // start one move per panel process, never one apply per request.
  await withDb(async (db) => {
    await db.query(
      `insert into backup_jobs (name, s3_enabled, s3_bucket, s3_access_key, s3_secret_key)
       values ('stuck', true, 'schela-stuck', 'AKIASTUCK', 'stuck-secret-0000')`,
    );
  });
  writeFileSync(applyLog, "");
  await start();
  for (let i = 0; i < 3; i++) await fetch(`${origin}/login`).then((r) => r.text());
  await new Promise((r) => setTimeout(r, 2000));
  await step("a secret left behind starts one apply per panel start, not one per login page", async () => {
    const applies = readFileSync(applyLog, "utf8").split("\n").filter(Boolean).length;
    check(
      "a secret left behind starts one apply per panel start, not one per login page",
      applies === 1,
      `applies=${applies}`,
    );
  });
  await stop();
  await withDb(async (db) => db.query("delete from backup_jobs where name = 'stuck'"));
  await start();
  await signIn();

  await step("new S3 secret is kept only in its key file", async () => {
    await callFn("createBackupJob", job("s3-only", s3("smoke-secret-WXYZ")));
    const listed = await callFn("listBackups", undefined, "GET");
    const id = await jobId("s3-only");
    const state = readState();
    const rows = await withDbOnline(`select * from backup_jobs where id = ${id}`);
    check("new S3 secret: not in state.json", !state.includes("smoke-secret-WXYZ"));
    check("new S3 secret: state.json references its key file", stateJob(id)?.s3Secret === `job-${id}.s3`, JSON.stringify(stateJob(id)));
    check("new S3 secret: not in the database", !JSON.stringify(rows).includes("smoke-secret-WXYZ"));
    check("new S3 secret: not in the panel's answers", !listed.includes("smoke-secret-WXYZ") && listed.includes("WXYZ"));
    check("new S3 secret: in its key file", readKey(id, "s3") === "smoke-secret-WXYZ", String(readKey(id, "s3")));
  });

  await step("new SSH key is kept only in its key file", async () => {
    await callFn("createBackupJob", job("ssh-only", { rsyncEnabled: true, rsyncDest: "backup@offsite.example:/srv", rsyncSshKey: SSH_KEY }));
    const listed = await callFn("listBackups", undefined, "GET");
    const id = await jobId("ssh-only");
    const rows = await withDbOnline(`select * from backup_jobs where id = ${id}`);
    check("new SSH key: not in state.json", !readState().includes(KEY_BODY));
    check("new SSH key: state.json references its key file", stateJob(id)?.rsyncKey === `job-${id}.ssh`, JSON.stringify(stateJob(id)));
    check("new SSH key: not in the database", !JSON.stringify(rows).includes(KEY_BODY));
    check("new SSH key: not in the panel's answers", !listed.includes(KEY_BODY));
    check("new SSH key: in its key file", readKey(id, "ssh")?.includes(KEY_BODY) === true);
  });

  await step("editing without the secrets keeps them", async () => {
    await callFn("createBackupJob", job("edit-keep", { ...s3("keep-secret-1111"), rsyncEnabled: true, rsyncDest: "b@h:/x", rsyncSshKey: SSH_KEY }));
    const id = await jobId("edit-keep");
    await callFn("updateBackupJob", { id, ...job("edit-keep", { ...s3(""), rsyncEnabled: true, rsyncDest: "b@h:/y", retain: 5 }) });
    const entry = stateJob(id);
    check(
      "editing without the secrets keeps them",
      readKey(id, "s3") === "keep-secret-1111" &&
        readKey(id, "ssh")?.includes(KEY_BODY) === true &&
        entry?.s3Secret === `job-${id}.s3` &&
        entry?.rsyncKey === `job-${id}.ssh` &&
        entry?.rsyncDest === "b@h:/y",
      JSON.stringify(entry),
    );
  });

  await step("removing the SSH key deletes its file", async () => {
    await callFn("createBackupJob", job("drop-key", { rsyncEnabled: true, rsyncDest: "b@h:/x", rsyncSshKey: SSH_KEY }));
    const id = await jobId("drop-key");
    const before = readKey(id, "ssh") !== null;
    await callFn("updateBackupJob", { id, ...job("drop-key", { rsyncEnabled: true, rsyncDest: "b@h:/x", rsyncKeyRemove: true }) });
    check("removing the SSH key deletes its file", before && readKey(id, "ssh") === null && stateJob(id)?.rsyncKey === "", `before=${before}`);
  });

  await step("deleting a job deletes its key files", async () => {
    await callFn("createBackupJob", job("to-delete", { ...s3("gone-secret-2222"), rsyncEnabled: true, rsyncDest: "b@h:/x", rsyncSshKey: SSH_KEY }));
    const id = await jobId("to-delete");
    const before = readKey(id, "s3") !== null && readKey(id, "ssh") !== null;
    await callFn("deleteBackupJob", { id, remove: [] });
    check(
      "deleting a job deletes its key files",
      before && readKey(id, "s3") === null && readKey(id, "ssh") === null,
      `before=${before}`,
    );
  });
} catch (err) {
  failed++;
  console.log(`FAIL ${err instanceof Error ? err.message : err}`);
} finally {
  await stop();
  rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log(log.split("\n").slice(-20).join("\n"));
  process.exit(1);
}
