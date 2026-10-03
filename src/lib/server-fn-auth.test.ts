import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Every server function is reachable by anyone who can reach the panel, so
// each one must check the caller. This scans the source so a new function
// without authMiddleware fails the build instead of shipping.

const LIB = fileURLToPath(new URL(".", import.meta.url));

/** Panel functions that must work before sign-in, and why. */
const PUBLIC_PANEL_FNS: Record<string, string> = {
  adminStatus: "login page: tells whether an admin exists",
  sessionUser: "returns the caller's own session, or null",
  getLoginInfo: "login page: hostname and first-boot admin bootstrap",
  completeSetup: "first-run setup; refuses once setup is complete",
};

/** Webmail has its own mailbox session; these run before it exists or end it. */
const WEBMAIL_SESSIONLESS = new Set(["webmailLogin", "webmailLogout", "webmailWhoami"]);

type ServerFn = { name: string; file: string; chain: string; body: string };

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function serverFns(): ServerFn[] {
  const found: ServerFn[] = [];
  for (const file of sourceFiles(LIB)) {
    const text = readFileSync(file, "utf8");
    const starts = [...text.matchAll(/export const (\w+) = createServerFn\(/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
      const block = text.slice(m.index, end);
      const at = block.indexOf(".handler(");
      found.push({
        name: m[1],
        file: relative(LIB, file),
        chain: at === -1 ? block : block.slice(0, at),
        body: at === -1 ? "" : block.slice(at),
      });
    });
  }
  return found;
}

describe("server function auth coverage", () => {
  const fns = serverFns();

  it("finds the panel's server functions", () => {
    assert.ok(fns.length > 50, `only found ${fns.length}`);
    for (const name of ["listSites", "getDashboard", "createSite", "listFiles", "getLoginInfo"]) {
      assert.ok(fns.some((f) => f.name === name), `${name} not found`);
    }
  });

  it("requires authMiddleware on every panel function outside the public list", () => {
    const missing = fns
      .filter((f) => !f.file.startsWith("webmail/"))
      .filter((f) => !(f.name in PUBLIC_PANEL_FNS))
      .filter((f) => !/\.middleware\(\[\s*authMiddleware\b/.test(f.chain))
      .map((f) => `${f.file}: ${f.name}`);
    assert.deepEqual(missing, []);
  });

  it("keeps the public list honest", () => {
    for (const name of Object.keys(PUBLIC_PANEL_FNS)) {
      assert.ok(fns.some((f) => f.name === name), `${name} is allow-listed but no longer exists`);
    }
  });

  it("requires a mailbox session in every webmail function that reads or changes mail", () => {
    const missing = fns
      .filter((f) => f.file.startsWith("webmail/"))
      .filter((f) => !WEBMAIL_SESSIONLESS.has(f.name))
      .filter((f) => !/\bsessionOrThrow\(\)/.test(f.body))
      .map((f) => `${f.file}: ${f.name}`);
    assert.deepEqual(missing, []);
  });
});
