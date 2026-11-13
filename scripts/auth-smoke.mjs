#!/usr/bin/env node
/**
 * Sign-in smoke test against the built panel (`npm run build` first), run as
 * the schela-panel unit runs it (NODE_ENV=production) with every request
 * carrying the headers nginx-panel.conf sets (X-Real-IP, X-Forwarded-For):
 *
 * - a fresh database gets the admin from SCHELA_ADMIN_PASSWORD; the admin
 *   signs in and holds a session; a wrong password and a second account are
 *   refused;
 * - the sign-in and two-factor rate limits key on X-Real-IP, and a forged
 *   X-Forwarded-For neither escapes nor redirects them;
 * - two-factor: enable (password, then a code), sign-in stops at the code
 *   step, wrong codes are refused, a recovery code works once, disable needs
 *   the password;
 * - each failed sign-in or code writes one "schela-auth: failed sign-in from
 *   <ip>" line and nothing secret;
 * - a database created before two-factor existed keeps its admin, who signs in.
 *
 *   npm run test:auth
 */
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { hashPassword } from "better-auth/crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, ".output/server/index.mjs");
if (!existsSync(entry)) {
  console.error("auth-smoke: no build at .output/server/index.mjs (run npm run build)");
  process.exit(1);
}

const ADMIN_EMAIL = "admin@schela.local";
const PASSWORD = "Admin-Pass-123";
const WRONG_PASSWORD = "not-the-password";
const LOG_LINE = /^schela-auth: failed sign-in from (\S+)$/;

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

/** Start the built panel on `dataDir`; resolves once /login answers. */
async function startPanel(dataDir, extraEnv = {}) {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOST: "127.0.0.1",
      SCHELA_DATA_DIR: dataDir,
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET: "auth-smoke-secret-0123456789abcdef",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const panel = { origin, stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (panel.stdout += d));
  child.stderr.on("data", (d) => (panel.stderr += d));
  const closed = new Promise((r) => child.once("close", r));
  panel.stop = async () => {
    child.kill("SIGTERM");
    // The server can stay up after its graceful stop; do not hang the test.
    const kill = setTimeout(() => child.kill("SIGKILL"), 8000);
    await closed;
    clearTimeout(kill);
  };
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`${origin}/login`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return panel;
    await new Promise((r) => setTimeout(r, 500));
  }
  await panel.stop();
  throw new Error(`panel did not start\n${panel.stdout}${panel.stderr}`);
}

/** Headers nginx-panel.conf sends for a client at `ip` that sent `forwardedFor`. */
function viaNginx(ip, forwardedFor) {
  return {
    "X-Real-IP": ip,
    "X-Forwarded-For": forwardedFor ? `${forwardedFor}, ${ip}` : ip,
  };
}

/** A minimal cookie jar: Set-Cookie in, Cookie header out. */
class Jar {
  cookies = new Map();
  take(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(fragment) {
    return [...this.cookies.keys()].some((k) => k.includes(fragment));
  }
}

function client(origin, ip, { forwardedFor, jar = new Jar() } = {}) {
  const headers = () => ({
    Origin: origin,
    ...viaNginx(ip, forwardedFor),
    ...(jar.cookies.size ? { Cookie: jar.header() } : {}),
  });
  return {
    jar,
    post: (path, body) =>
      fetch(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => jar.take(r)),
    session: () =>
      fetch(`${origin}/api/auth/get-session`, { headers: headers() })
        .then((r) => jar.take(r).json())
        .catch(() => null),
  };
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), what authenticator apps compute from the URI. */
function totp(totpURI, offsetSteps = 0) {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  const n = (mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
}

/** A 6-digit code that is not valid in the current, previous or next step. */
function wrongTotp(totpURI) {
  const valid = new Set([-1, 0, 1].map((s) => totp(totpURI, s)));
  let n = Number(totp(totpURI));
  let code;
  do {
    n = (n + 1) % 1_000_000;
    code = String(n).padStart(6, "0");
  } while (valid.has(code));
  return code;
}

/** Lines of the panel's stdout that name `ip` in the failed sign-in format. */
function failLines(panel, ip) {
  return panel.stdout.split("\n").filter((l) => LOG_LINE.exec(l)?.[1] === ip).length;
}

async function freshDatabase() {
  const dataDir = mkdtempSync(join(tmpdir(), "schela-auth-"));
  const panel = await startPanel(dataDir, { SCHELA_ADMIN_PASSWORD: PASSWORD });
  const o = panel.origin;
  const secrets = [PASSWORD, WRONG_PASSWORD];
  /** Expected failed sign-in lines per client address. */
  const expectLines = new Map();
  const failedFrom = (ip, n = 1) => expectLines.set(ip, (expectLines.get(ip) ?? 0) + n);
  try {
    // Password sign-in, no two-factor.
    const wrong = await client(o, "192.0.2.10").post("/sign-in/email", {
      email: ADMIN_EMAIL,
      password: WRONG_PASSWORD,
    });
    check("wrong password is refused", wrong.status === 401, `HTTP ${wrong.status}`);
    failedFrom("192.0.2.10");

    const admin = client(o, "192.0.2.11");
    const signIn = await admin.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const signInBody = await signIn.json().catch(() => null);
    check(
      "bootstrapped admin without two-factor signs in directly",
      signIn.status === 200 && !signInBody?.twoFactorRedirect,
      `HTTP ${signIn.status}`,
    );
    const session = await admin.session();
    check("signed-in admin has a session", session?.user?.email === ADMIN_EMAIL);

    const second = await client(o, "192.0.2.12").post("/sign-up/email", {
      email: "second@schela.local",
      password: "Second-Pass-123",
      name: "Second",
    });
    check("a second account is refused", second.status >= 400, `HTTP ${second.status}`);

    // Rate limits: Better Auth's /sign-in rule allows 3 requests per 10 s.
    const bad = { email: ADMIN_EMAIL, password: WRONG_PASSWORD };
    {
      const c = client(o, "192.0.2.30");
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push((await c.post("/sign-in/email", bad)).status);
      check(
        "sign-in is rate limited per X-Real-IP (4th try in 10 s)",
        codes.join() === "401,401,401,429",
        codes.join(),
      );
      failedFrom("192.0.2.30", 3);
    }
    {
      const forged = client(o, "192.0.2.31", { forwardedFor: "203.0.113.7" });
      for (let i = 0; i < 3; i++) await forged.post("/sign-in/email", bad);
      const plain = await client(o, "192.0.2.31").post("/sign-in/email", bad);
      check(
        "a forged X-Forwarded-For does not get an address a second budget",
        plain.status === 429,
        `HTTP ${plain.status}`,
      );
      failedFrom("192.0.2.31", 3);
    }
    {
      const forged = client(o, "192.0.2.32", { forwardedFor: "203.0.113.8" });
      for (let i = 0; i < 3; i++) await forged.post("/sign-in/email", bad);
      // Another client whose request also carries a forwarded chain (a proxy).
      const other = await client(o, "192.0.2.33", { forwardedFor: "10.0.0.5" }).post(
        "/sign-in/email",
        { email: ADMIN_EMAIL, password: PASSWORD },
      );
      check(
        "a forged X-Forwarded-For does not spend another client's budget",
        other.status === 200,
        `HTTP ${other.status}`,
      );
      failedFrom("192.0.2.32", 3);
    }
    {
      const c = client(o, "192.0.2.34", { forwardedFor: "203.0.113.9" });
      const codes = [];
      for (let i = 0; i < 4; i++) {
        codes.push((await c.post("/two-factor/verify-totp", { code: "123456" })).status);
      }
      check(
        "two-factor verification is rate limited per X-Real-IP",
        codes.join() === "401,401,401,429",
        codes.join(),
      );
      failedFrom("192.0.2.34", 3);
    }

    // Enable two-factor from the signed-in session.
    const enableBad = await client(o, "192.0.2.41", { jar: admin.jar }).post("/two-factor/enable", {
      password: WRONG_PASSWORD,
    });
    check(
      "enabling two-factor needs the password",
      enableBad.status === 400,
      `HTTP ${enableBad.status}`,
    );

    const enable = await admin.post("/two-factor/enable", { password: PASSWORD });
    const enabled = await enable.json().catch(() => null);
    const setUp =
      enable.status === 200 &&
      String(enabled?.totpURI).startsWith("otpauth://totp/") &&
      enabled?.backupCodes?.length > 1;
    check(
      "enabling two-factor returns a TOTP key and recovery codes",
      setUp,
      `HTTP ${enable.status}`,
    );
    // Without a setup, go on with stand-ins so every check below still runs
    // (and fails) on its own.
    const totpURI = setUp ? enabled.totpURI : "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP";
    const backupCodes = setUp ? enabled.backupCodes : ["aaaaa-aaaaa", "bbbbb-bbbbb"];
    if (setUp) secrets.push(new URL(totpURI).searchParams.get("secret"), ...backupCodes);

    const confirmBad = await client(o, "192.0.2.49", { jar: admin.jar }).post(
      "/two-factor/verify-totp",
      { code: wrongTotp(totpURI) },
    );
    failedFrom("192.0.2.49");
    const stillOff = await admin.session();
    check(
      "a wrong code does not turn two-factor on",
      confirmBad.status === 401 && stillOff?.user?.twoFactorEnabled === false,
      `HTTP ${confirmBad.status}, twoFactorEnabled=${stillOff?.user?.twoFactorEnabled}`,
    );

    const confirm = await admin.post("/two-factor/verify-totp", { code: totp(totpURI) });
    const nowOn = await admin.session();
    check(
      "a code from the app turns two-factor on",
      confirm.status === 200 && nowOn?.user?.twoFactorEnabled === true,
      `HTTP ${confirm.status}, twoFactorEnabled=${nowOn?.user?.twoFactorEnabled}`,
    );

    // Sign-in with two-factor on.
    const step1 = client(o, "192.0.2.42");
    const pw = await step1.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const pwBody = await pw.json().catch(() => null);
    const noSession = await step1.session();
    check(
      "with two-factor on, the password alone creates no session",
      pw.status === 200 &&
        pwBody?.twoFactorRedirect === true &&
        !step1.jar.has("session_token") &&
        !noSession?.user,
      `HTTP ${pw.status}, body=${JSON.stringify(pwBody)}`,
    );

    const codeStep = client(o, "192.0.2.43", { jar: step1.jar });
    const badCode = await codeStep.post("/two-factor/verify-totp", { code: wrongTotp(totpURI) });
    failedFrom("192.0.2.43");
    check(
      "a wrong code at sign-in is refused",
      badCode.status === 401 &&
        !codeStep.jar.has("session_token") &&
        !(await codeStep.session())?.user,
      `HTTP ${badCode.status}`,
    );
    const goodCode = await codeStep.post("/two-factor/verify-totp", { code: totp(totpURI) });
    const codeSession = await codeStep.session();
    check(
      "the right code at sign-in creates the session",
      goodCode.status === 200 && codeSession?.user?.email === ADMIN_EMAIL,
      `HTTP ${goodCode.status}`,
    );

    // Recovery codes.
    const r1 = client(o, "192.0.2.44");
    await r1.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const useOnce = await r1.post("/two-factor/verify-backup-code", { code: backupCodes[0] });
    check(
      "a recovery code signs in",
      useOnce.status === 200 && (await r1.session())?.user?.email === ADMIN_EMAIL,
      `HTTP ${useOnce.status}`,
    );
    const r2 = client(o, "192.0.2.45");
    await r2.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const reuse = await r2.post("/two-factor/verify-backup-code", { code: backupCodes[0] });
    failedFrom("192.0.2.45");
    check(
      "a used recovery code is refused",
      reuse.status === 401 && !(await r2.session())?.user,
      `HTTP ${reuse.status}`,
    );
    const another = await r2.post("/two-factor/verify-backup-code", { code: backupCodes[1] });
    check(
      "another recovery code still works",
      another.status === 200 && (await r2.session())?.user?.email === ADMIN_EMAIL,
      `HTTP ${another.status}`,
    );

    // Disable.
    const disableBad = await client(o, "192.0.2.46", { jar: r2.jar }).post("/two-factor/disable", {
      password: WRONG_PASSWORD,
    });
    check(
      "turning two-factor off needs the password",
      disableBad.status === 400,
      `HTTP ${disableBad.status}`,
    );
    const disable = await r2.post("/two-factor/disable", { password: PASSWORD });
    check(
      "turning two-factor off with the password works",
      disable.status === 200,
      `HTTP ${disable.status}`,
    );
    const after = client(o, "192.0.2.47");
    const direct = await after.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const directBody = await direct.json().catch(() => null);
    check(
      "with two-factor off, the password signs in directly again",
      direct.status === 200 &&
        !directBody?.twoFactorRedirect &&
        (await after.session())?.user?.email === ADMIN_EMAIL,
      `HTTP ${direct.status}`,
    );
  } catch (err) {
    // Still check the log for what ran.
    check("freshDatabase", false, err instanceof Error ? err.message : String(err));
  } finally {
    await panel.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }

  // The failure log, read once the process has exited and flushed stdout.
  for (const [ip, n] of expectLines) {
    const got = failLines(panel, ip);
    check(`failed sign-ins from ${ip} logged ${n} time(s)`, got === n, `got ${got}`);
  }
  const ours = panel.stdout.split("\n").filter((l) => l.includes("schela-auth"));
  const stray = ours.filter((l) => !LOG_LINE.test(l) || !expectLines.has(LOG_LINE.exec(l)[1]));
  check("no other schela-auth lines", stray.length === 0, stray.join(" | "));
  const output = panel.stdout + panel.stderr;
  const leaked = [...secrets, ADMIN_EMAIL].filter((s) => s && output.includes(s));
  check(
    "the log has no email, password, key or recovery code",
    leaked.length === 0,
    leaked.join(", "),
  );
  return panel;
}

/** A database as the code before two-factor left it: migrations up to 0007 and the admin. */
async function oldDatabase() {
  const dataDir = mkdtempSync(join(tmpdir(), "schela-auth-old-"));
  const db = new PGlite(dataDir);
  await db.exec(
    "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const migrations = readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql") && f < "0008")
    .sort();
  for (const name of migrations) {
    await db.exec(readFileSync(join(root, "migrations", name), "utf8"));
    await db.query("insert into _migrations (name) values ($1)", [name]);
  }
  const id = randomBytes(16).toString("hex");
  await db.query(
    `insert into "user" (id, name, email, "emailVerified") values ($1, 'Admin', $2, false)`,
    [id, ADMIN_EMAIL],
  );
  await db.query(
    `insert into account (id, "accountId", "providerId", "userId", password, "updatedAt")
     values ($1, $2, 'credential', $2, $3, now())`,
    [randomBytes(16).toString("hex"), id, await hashPassword(PASSWORD)],
  );
  await db.close();

  const panel = await startPanel(dataDir);
  try {
    const c = client(panel.origin, "192.0.2.50");
    const res = await c.post("/sign-in/email", { email: ADMIN_EMAIL, password: PASSWORD });
    const body = await res.json().catch(() => null);
    const session = await c.session();
    check(
      "an admin from a database made before two-factor signs in directly",
      res.status === 200 && !body?.twoFactorRedirect && session?.user?.id === id,
      `HTTP ${res.status}`,
    );
  } finally {
    await panel.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
  return panel;
}

const panels = [];
for (const run of [freshDatabase, oldDatabase]) {
  try {
    panels.push(await run());
  } catch (err) {
    failed++;
    console.log(`FAIL ${run.name}: ${err instanceof Error ? err.message : err}`);
  }
}

if (failed) {
  for (const p of panels) console.log((p.stdout + p.stderr).split("\n").slice(-20).join("\n"));
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}
