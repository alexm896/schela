import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  MAX_TRANSFER_BYTES,
  assertEntryName,
  assertVirtRoot,
  classifyName,
  formatMode,
  mimeFor,
  parseMode,
  splitRel,
  virtNormalize,
  virtParent,
  type FileContents,
  type FileEntry,
  type FileListing,
} from "./file-types.ts";
import { isVpsApply } from "../../server/env.ts";

export type JailSeed = {
  kind: "site" | "app";
  domain: string;
};

export {
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  MAX_TRANSFER_BYTES,
  assertEntryName,
  assertVirtRoot,
  classifyName,
  formatMode,
  formatSize,
  mimeFor,
  parseMode,
  splitRel,
  virtJoin,
  virtNormalize,
  virtParent,
  virtSegments,
} from "./file-types.ts";
export type {
  FileContents,
  FileEntry,
  FileKind,
  FileListing,
  FilePreview,
  FileTarget,
  FileTargetKind,
} from "./file-types.ts";

function isInside(root: string, target: string): boolean {
  const a = path.resolve(root);
  const b = path.resolve(target);
  if (process.platform === "win32") {
    const A = a.toLowerCase();
    const B = b.toLowerCase();
    return B === A || B.startsWith(A + path.sep);
  }
  return b === a || b.startsWith(a + path.sep);
}

export function joinJail(rootAbs: string, rel: string): string {
  const parts = splitRel(rel);
  const root = path.resolve(rootAbs);
  const resolved = path.resolve(root, ...parts);
  if (!isInside(root, resolved)) throw new Error("That path is outside this account");
  return resolved;
}

export function sandboxRoot(): string {
  const env = process.env.SCHELA_FILES_ROOT?.trim();
  if (env) return path.resolve(env);
  return path.join(tmpdir(), "schela-files");
}

export function physicalFromVirt(virtRoot: string): string {
  const n = assertVirtRoot(virtRoot);
  if (isVpsApply()) return n;
  const rel = n.replace(/^\//, "").split("/");
  return path.join(sandboxRoot(), ...rel);
}

async function fs() {
  return import("node:fs/promises");
}

function toIso(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString();
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function entryFromStat(
  jail: string,
  abs: string,
  name: string,
  virtPath: string,
): Promise<FileEntry> {
  const fsp = await fs();
  const st = await fsp.lstat(abs);
  const classified = classifyName(name);
  const hidden = name.startsWith(".");
  const base: FileEntry = {
    name,
    path: virtPath,
    kind: "file",
    size: st.size,
    mtime: toIso(st.mtimeMs),
    mode: formatMode(st.mode),
    hidden,
    editable: classified.editable,
    preview: classified.preview,
    unsafe: false,
  };
  if (st.isDirectory()) {
    return { ...base, kind: "dir", size: 0, editable: false, preview: "none" };
  }
  if (st.isSymbolicLink()) {
    try {
      const real = await fsp.realpath(abs);
      if (!isInside(jail, real)) {
        return { ...base, kind: "link", unsafe: true, editable: false, preview: "none" };
      }
    } catch {
      return { ...base, kind: "link", unsafe: true, editable: false, preview: "none" };
    }
    return { ...base, kind: "link" };
  }
  return base;
}

async function assertSafeFile(jail: string, abs: string): Promise<void> {
  if (!isInside(jail, abs)) throw new Error("That path is outside this account");
  const fsp = await fs();
  let st;
  try {
    st = await fsp.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    const real = await fsp.realpath(abs);
    if (!isInside(jail, real)) throw new Error("This link points outside the account");
  }
}

export async function localList(jail: string, rel: string): Promise<FileListing> {
  const fsp = await fs();
  const dir = joinJail(jail, rel);
  await assertSafeFile(jail, dir);
  const st = await fsp.lstat(dir);
  if (!st.isDirectory()) throw new Error("Not a directory");
  const names = await fsp.readdir(dir);
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const truncated = names.length > MAX_LIST_ENTRIES;
  const slice = truncated ? names.slice(0, MAX_LIST_ENTRIES) : names;
  const virt = virtNormalize(rel);
  const entries: FileEntry[] = [];
  for (const name of slice) {
    const abs = path.join(dir, name);
    if (!isInside(jail, abs)) continue;
    const virtPath = virt === "/" ? `/${name}` : `${virt}/${name}`;
    entries.push(await entryFromStat(jail, abs, name, virtPath));
  }
  entries.sort((a, b) => {
    if (a.kind === "dir" && b.kind !== "dir") return -1;
    if (a.kind !== "dir" && b.kind === "dir") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return {
    path: virt,
    parent: virtParent(virt),
    entries,
    truncated,
  };
}

export async function localRead(
  jail: string,
  rel: string,
  opts?: { binary?: boolean; limit?: number },
): Promise<FileContents> {
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  await assertSafeFile(jail, abs);
  const st = await fsp.lstat(abs);
  if (st.isDirectory()) throw new Error("Cannot read a directory");
  const limit = opts?.limit ?? (opts?.binary ? MAX_TRANSFER_BYTES : MAX_READ_BYTES);
  if (st.size > limit) {
    throw new Error(
      `File is too large for the panel (${formatMb(limit)} limit). Use SSH for bigger files.`,
    );
  }
  const buf = await fsp.readFile(abs);
  const name = path.basename(abs);
  const classified = classifyName(name);
  const virt = virtNormalize(rel);
  if (opts?.binary) {
    return {
      name,
      path: virt,
      content: buf.toString("base64"),
      encoding: "base64",
      size: buf.length,
      mime: mimeFor(name),
      editable: classified.editable && !looksBinary(buf),
      preview: classified.preview,
    };
  }
  if (looksBinary(buf)) throw new Error("Binary file — download it instead");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new Error("File is not valid UTF-8 — download it instead");
  }
  return {
    name,
    path: virt,
    content: text,
    encoding: "utf8",
    size: buf.length,
    mime: mimeFor(name),
    editable: classified.editable,
    preview: classified.preview,
  };
}

export async function localWrite(
  jail: string,
  rel: string,
  content: string,
  encoding: "utf8" | "base64",
): Promise<{ path: string; size: number }> {
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  const parent = path.dirname(abs);
  if (!isInside(jail, parent)) throw new Error("That path is outside this account");
  await assertSafeFile(jail, parent);
  const buf =
    encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
  if (buf.length > MAX_TRANSFER_BYTES) {
    throw new Error(`File exceeds the ${formatMb(MAX_TRANSFER_BYTES)} panel limit`);
  }
  await fsp.mkdir(parent, { recursive: true });
  await fsp.writeFile(abs, buf);
  return { path: virtNormalize(rel), size: buf.length };
}

export async function localCreate(jail: string, rel: string): Promise<{ path: string }> {
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  assertEntryName(path.basename(abs));
  await fsp.writeFile(abs, Buffer.alloc(0), { flag: "wx" });
  return { path: virtNormalize(rel) };
}

export async function localMkdir(jail: string, rel: string): Promise<{ path: string }> {
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  assertEntryName(path.basename(abs));
  await fsp.mkdir(abs);
  return { path: virtNormalize(rel) };
}

export async function localRename(
  jail: string,
  rel: string,
  toRel: string,
): Promise<{ path: string }> {
  if (virtNormalize(rel) === "/") throw new Error("Cannot rename the home directory");
  const fsp = await fs();
  const src = joinJail(jail, rel);
  const dest = joinJail(jail, toRel);
  await assertSafeFile(jail, src);
  if (!isInside(jail, path.dirname(dest))) throw new Error("That path is outside this account");
  await fsp.rename(src, dest);
  return { path: virtNormalize(toRel) };
}

export async function localDelete(jail: string, rel: string): Promise<{ ok: true }> {
  if (virtNormalize(rel) === "/") throw new Error("Cannot delete the home directory");
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  await assertSafeFile(jail, abs);
  await fsp.rm(abs, { recursive: true, force: false });
  return { ok: true };
}

export async function localChmod(
  jail: string,
  rel: string,
  mode: string,
): Promise<{ mode: string }> {
  const fsp = await fs();
  const abs = joinJail(jail, rel);
  await assertSafeFile(jail, abs);
  const n = parseMode(mode);
  await fsp.chmod(abs, n);
  return { mode: formatMode(n) };
}

export async function localCopy(
  jail: string,
  rel: string,
  toRel: string,
): Promise<{ path: string }> {
  const fsp = await fs();
  const src = joinJail(jail, rel);
  const dest = joinJail(jail, toRel);
  await assertSafeFile(jail, src);
  if (!isInside(jail, path.dirname(dest))) throw new Error("That path is outside this account");
  await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  return { path: virtNormalize(toRel) };
}

export async function localMove(
  jail: string,
  rel: string,
  toRel: string,
): Promise<{ path: string }> {
  return localRename(jail, rel, toRel);
}

function formatMb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

export async function ensureSeed(jail: string, seed: JailSeed): Promise<void> {
  const fsp = await fs();
  await fsp.mkdir(jail, { recursive: true });
  const names = await fsp.readdir(jail);
  if (names.length > 0) return;
  if (seed.kind === "site") {
    const php = `<?php echo htmlspecialchars(${JSON.stringify(seed.domain)}, ENT_QUOTES, "UTF-8");\n`;
    await fsp.writeFile(path.join(jail, "index.php"), php);
    await fsp.mkdir(path.join(jail, "css"));
    await fsp.writeFile(
      path.join(jail, "css", "style.css"),
      `/* ${seed.domain} */\n:root { color-scheme: dark; }\nbody { font-family: system-ui; }\n`,
    );
    await fsp.writeFile(path.join(jail, ".htaccess"), "DirectoryIndex index.php\n");
  } else {
    await fsp.writeFile(
      path.join(jail, "server.js"),
      `const http = require("http");\nconst port = process.env.PORT || 3000;\nhttp.createServer((_, res) => {\n  res.writeHead(200, { "content-type": "text/plain" });\n  res.end(${JSON.stringify(seed.domain)});\n}).listen(port);\n`,
    );
    await fsp.writeFile(
      path.join(jail, "package.json"),
      `${JSON.stringify({ name: seed.domain, private: true, type: "commonjs" }, null, 2)}\n`,
    );
  }
}

type HelperRequest = {
  op: string;
  root: string;
  rel: string;
  to?: string;
  content?: string;
  encoding?: "utf8" | "base64";
  mode?: string;
  binary?: boolean;
};

async function runHelper(req: HelperRequest): Promise<Record<string, unknown>> {
  if (typeof window !== "undefined") {
    throw new Error("File operations run on the server");
  }
  const payload = JSON.stringify(req);
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-n", "/usr/local/sbin/schela-files"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("File operation timed out"));
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!out.trim()) {
        reject(new Error(err.trim() || `schela-files exited ${code}`));
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(out) as Record<string, unknown>;
      } catch {
        reject(new Error(err.trim() || "schela-files returned invalid JSON"));
        return;
      }
      if (parsed.ok === false) {
        reject(new Error(String(parsed.error || "File operation failed")));
        return;
      }
      if (code !== 0) {
        reject(new Error(err.trim() || String(parsed.error || `schela-files exited ${code}`)));
        return;
      }
      resolve(parsed);
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function atJail<T>(
  virtRoot: string,
  seed: JailSeed | undefined,
  run: (jail: string) => Promise<T>,
  helper: HelperRequest,
): Promise<T> {
  const root = assertVirtRoot(virtRoot);
  if (isVpsApply()) {
    const parsed = await runHelper({ ...helper, root });
    return parsed as T;
  }
  const jail = physicalFromVirt(root);
  if (seed) await ensureSeed(jail, seed);
  else {
    const fsp = await fs();
    await fsp.mkdir(jail, { recursive: true });
  }
  return run(jail);
}

export async function listDir(
  virtRoot: string,
  rel: string,
  seed?: JailSeed,
): Promise<FileListing> {
  return atJail(
    virtRoot,
    seed,
    (jail) => localList(jail, rel),
    { op: "list", root: virtRoot, rel },
  );
}

export async function readFileAt(
  virtRoot: string,
  rel: string,
  opts?: { binary?: boolean },
): Promise<FileContents> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localRead(jail, rel, opts),
    {
      op: "read",
      root: virtRoot,
      rel,
      binary: opts?.binary,
    },
  );
}

export async function writeFileAt(
  virtRoot: string,
  rel: string,
  content: string,
  encoding: "utf8" | "base64",
): Promise<{ path: string; size: number }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localWrite(jail, rel, content, encoding),
    { op: "write", root: virtRoot, rel, content, encoding },
  );
}

export async function createFileAt(virtRoot: string, rel: string): Promise<{ path: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localCreate(jail, rel),
    { op: "create", root: virtRoot, rel },
  );
}

export async function mkdirAt(virtRoot: string, rel: string): Promise<{ path: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localMkdir(jail, rel),
    { op: "mkdir", root: virtRoot, rel },
  );
}

export async function renameAt(
  virtRoot: string,
  rel: string,
  to: string,
): Promise<{ path: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localRename(jail, rel, to),
    { op: "rename", root: virtRoot, rel, to },
  );
}

export async function deleteAt(virtRoot: string, rel: string): Promise<{ ok: true }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localDelete(jail, rel),
    { op: "delete", root: virtRoot, rel },
  );
}

export async function chmodAt(
  virtRoot: string,
  rel: string,
  mode: string,
): Promise<{ mode: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localChmod(jail, rel, mode),
    { op: "chmod", root: virtRoot, rel, mode },
  );
}

export async function copyAt(
  virtRoot: string,
  rel: string,
  to: string,
): Promise<{ path: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localCopy(jail, rel, to),
    { op: "copy", root: virtRoot, rel, to },
  );
}

export async function moveAt(
  virtRoot: string,
  rel: string,
  to: string,
): Promise<{ path: string }> {
  return atJail(
    virtRoot,
    undefined,
    (jail) => localMove(jail, rel, to),
    { op: "move", root: virtRoot, rel, to },
  );
}
