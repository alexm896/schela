#!/usr/bin/env node
/**
 * Sign-in smoke test against the built panel (`npm run build` first):
 * a fresh database gets the admin from SCHELA_ADMIN_PASSWORD, the admin can
 * sign in and hold a session, a wrong password and a second account are refused.
 * The installer's password does not linger in admin.env, and
 * `schela reset-admin-password` (its admin-reset.json) sets a new one.
 *
 *   npm run test:auth
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toJSON } from "seroval";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, ".output/server/index.mjs");
if (!existsSync(entry)) {
  console.error("auth-smoke: no build at .output/server/index.mjs (run npm run build)");
  process.exit(1);
}

const port = await new Promise((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const { port: p } = s.address();
    s.close(() => resolve(p));
  });
});
const origin = `http://localhost:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "schela-auth-"));
const adminDir = mkdtempSync(join(tmpdir(), "schela-auth-admin-"));
const password = "Admin-Pass-123";
// As the installer of an older version left it.
writeFileSync(
  join(adminDir, "admin.env"),
  `SCHELA_ADMIN_PASSWORD=${password}\nBETTER_AUTH_SECRET=auth-smoke-secret-0123456789abcdef\n`,
);

const server = spawn(process.execPath, [entry], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    SCHELA_DATA_DIR: dataDir,
    SCHELA_ADMIN_DIR: adminDir,
    SCHELA_ADMIN_PASSWORD: password,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "auth-smoke-secret-0123456789abcdef",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let failed = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const post = (path, body, cookie) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${origin}/login`).then(
      (r) => r.ok,
      () => false,
    );
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error("panel did not start");

  const wrong = await post("/api/auth/sign-in/email", {
    email: "admin@schela.local",
    password: "not-the-password",
  });
  check("wrong password is refused", wrong.status === 401, `HTTP ${wrong.status}`);

  const signIn = await post("/api/auth/sign-in/email", { email: "admin@schela.local", password });
  check("bootstrapped admin signs in", signIn.status === 200, `HTTP ${signIn.status}`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const session = await fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie } })
    .then((r) => r.json())
    .catch(() => null);
  check("signed-in admin has a session", Boolean(session?.user?.email === "admin@schela.local"));

  const second = await post("/api/auth/sign-up/email", {
    email: "second@schela.local",
    password: "Second-Pass-123",
    name: "Second",
  });
  check("a second account is refused", second.status >= 400, `HTTP ${second.status}`);

  check(
    "admin.env keeps no password once the admin exists",
    !readFileSync(join(adminDir, "admin.env"), "utf8").includes("SCHELA_ADMIN_PASSWORD"),
  );

  // schela reset-admin-password: root leaves the new password, the panel's next
  // request sets it and deletes the file.
  const reset = async (newPassword) => {
    writeFileSync(join(adminDir, "admin-reset.json"), JSON.stringify({ password: newPassword }));
    await fetch(`${origin}/login`).then((r) => r.text());
    return !existsSync(join(adminDir, "admin-reset.json"));
  };
  const signInStatus = async (email, pass) =>
    (await post("/api/auth/sign-in/email", { email, password: pass })).status;

  check("reset request is taken and deleted", await reset("Reset-Pass-456"));
  check("reset password signs in", (await signInStatus("admin@schela.local", "Reset-Pass-456")) === 200);
  check("old password is refused after a reset", (await signInStatus("admin@schela.local", password)) === 401);

  // Renaming the admin (Settings) sets its credential account's accountId to
  // the email, which Better Auth's sign-in then rejects. A reset must still
  // leave an admin who can sign in.
  const manifest = readFileSync(join(root, ".output/server/_ssr/ssr.mjs"), "utf8");
  const renameId = manifest.match(
    /"([0-9a-f]{16,})": \{\s*functionName: "updateAdminIdentity_createServerFn_handler"/,
  )?.[1];
  const renamed = await fetch(`${origin}/_serverFn/${renameId}`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "x-tsr-serverFn": "true", Cookie: cookie },
    body: JSON.stringify(toJSON({ data: { username: "boss" } })),
  });
  const renameText = await renamed.text();
  check(
    "admin is renamed",
    renamed.ok && renameText.includes("boss@schela.local"),
    `HTTP ${renamed.status} ${renameText.slice(0, 200)}`,
  );
  await reset("Reset-Pass-789");
  check("reset works after a rename", (await signInStatus("boss@schela.local", "Reset-Pass-789")) === 200);
} catch (err) {
  failed++;
  console.log(`FAIL ${err instanceof Error ? err.message : err}`);
} finally {
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(adminDir, { recursive: true, force: true });
}

if (failed) {
  console.log(log.split("\n").slice(-20).join("\n"));
  process.exit(1);
}
