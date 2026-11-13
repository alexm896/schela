#!/usr/bin/env node
/**
 * Panel behind nginx on HTTPS (`npm run build` first): in server mode
 * (SCHELA_VPS=1) session cookies are Secure `__Host-` cookies even when
 * BETTER_AUTH_URL is still the old http:// value, and sign-in is accepted from
 * https://<hostname> and https://<server IP> but not from another origin.
 *
 *   npm run test:auth
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, ".output/server/index.mjs");
if (!existsSync(entry)) {
  console.error("auth-tls-smoke: no build at .output/server/index.mjs (run npm run build)");
  process.exit(1);
}

const IP = "203.0.113.7";
const HOST = "panel.example.com";
const password = "Admin-Pass-123";

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

/** Start the built panel in server mode, run `fn(base)`, stop it. */
async function withPanel(authUrl, fn) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "schela-auth-tls-"));
  const server = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      SCHELA_DATA_DIR: dataDir,
      SCHELA_ADMIN_PASSWORD: password,
      SCHELA_VPS: "1",
      SCHELA_PUBLIC_IP: IP,
      SCHELA_HOSTNAME: HOST,
      BETTER_AUTH_URL: authUrl,
      BETTER_AUTH_SECRET: "auth-tls-smoke-secret-0123456789abcdef",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(`${base}/login`).then(
        (r) => r.ok,
        () => false,
      );
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) throw new Error("panel did not start");
    await fn(base);
  } catch (err) {
    failed++;
    console.log(`FAIL ${err instanceof Error ? err.message : err}`);
    console.log(log.split("\n").slice(-20).join("\n"));
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const signIn = (base, origin) =>
  fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@schela.local", password }),
  });

/** Every Set-Cookie is Secure and `__Host-`; returns a reason when not. */
function insecureCookie(res) {
  const cookies = res.headers.getSetCookie();
  if (cookies.length === 0) return "no Set-Cookie";
  const bad = cookies.find((c) => !c.startsWith("__Host-") || !/;\s*secure(;|$)/i.test(c));
  return bad ? `${bad.split("=")[0]} (${/;\s*secure(;|$)/i.test(bad) ? "" : "not "}Secure)` : "";
}

await withPanel(`http://${IP}`, async (base) => {
  const res = await signIn(base, `https://${IP}`);
  check(
    "stale http BETTER_AUTH_URL: sign-in from https://IP works",
    res.status === 200,
    `HTTP ${res.status}`,
  );
  const why = insecureCookie(res);
  check("stale http BETTER_AUTH_URL: session cookies are Secure __Host-", why === "", why);
});

await withPanel(`https://${IP}`, async (base) => {
  const byHost = await signIn(base, `https://${HOST}`);
  check(
    "sign-in from https://hostname is accepted",
    byHost.status === 200,
    `HTTP ${byHost.status}`,
  );
  const why = insecureCookie(byHost);
  check("session cookies are Secure __Host-", why === "", why);
  const byIp = await signIn(base, `https://${IP}`);
  check("sign-in from https://IP is accepted", byIp.status === 200, `HTTP ${byIp.status}`);
  const evil = await signIn(base, "https://evil.example");
  check("sign-in from another origin is refused", evil.status === 403, `HTTP ${evil.status}`);
});

if (failed) process.exit(1);
