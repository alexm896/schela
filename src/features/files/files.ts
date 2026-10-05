// File manager rules: limits, entry kinds and the virtual paths the UI works
// with. Pure, shared by the server functions, the UI and the tests.

export const MAX_READ_BYTES = 1_048_576;
export const MAX_TRANSFER_BYTES = 4 * 1024 * 1024;
export const MAX_LIST_ENTRIES = 2000;

export type FileKind = "dir" | "file" | "link";
export type FilePreview = "text" | "image" | "none";
export type FileTargetKind = "site" | "app";

export type FileEntry = {
  name: string;
  path: string;
  kind: FileKind;
  size: number;
  mtime: string;
  mode: string;
  hidden: boolean;
  editable: boolean;
  preview: FilePreview;
  unsafe: boolean;
};

export type FileListing = {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  truncated: boolean;
};

export type FileTarget = {
  kind: FileTargetKind;
  id: number;
  label: string;
  domain: string;
  user: string;
  virtRoot: string;
};

export type FileContents = {
  name: string;
  path: string;
  content: string;
  encoding: "utf8" | "base64";
  size: number;
  mime: string;
  editable: boolean;
  preview: FilePreview;
};

const TEXT_EXT = new Set([
  "php",
  "phtml",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "shtml",
  "md",
  "markdown",
  "txt",
  "log",
  "csv",
  "xml",
  "svg",
  "xsl",
  "yml",
  "yaml",
  "env",
  "conf",
  "cnf",
  "ini",
  "toml",
  "sql",
  "sh",
  "bash",
  "zsh",
  "htaccess",
  "htpasswd",
  "map",
  "lock",
  "vue",
  "svelte",
  "twig",
  "gitignore",
  "gitattributes",
  "editorconfig",
  "nvmrc",
  "npmrc",
  "prettierrc",
  "eslintrc",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg"]);

const SPECIAL_TEXT = new Set([
  "dockerfile",
  "makefile",
  "procfile",
  "readme",
  "license",
  "changelog",
  ".htaccess",
  ".htpasswd",
  ".env",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
]);

const MIME: Record<string, string> = {
  php: "text/x-php",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  htm: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  svg: "image/svg+xml",
  xml: "application/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  pdf: "application/pdf",
  zip: "application/zip",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function extOf(name: string): string {
  const base = name.toLowerCase();
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1);
}

export function classifyName(name: string): {
  editable: boolean;
  preview: FilePreview;
} {
  const lower = name.toLowerCase();
  if (SPECIAL_TEXT.has(lower)) return { editable: true, preview: "text" };
  const ext = extOf(name);
  const image = IMAGE_EXT.has(ext);
  const text = TEXT_EXT.has(ext);
  if (text && image) return { editable: true, preview: "image" };
  if (text) return { editable: true, preview: "text" };
  if (image) return { editable: false, preview: "image" };
  return { editable: false, preview: "none" };
}

export function mimeFor(name: string): string {
  const ext = extOf(name);
  return MIME[ext] || "application/octet-stream";
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

export function parseMode(raw: string): number {
  const s = raw.trim().replace(/^0o/, "");
  if (!/^[0-7]{3,4}$/.test(s)) throw new Error("Mode must be octal, like 0644");
  const n = Number.parseInt(s, 8);
  if (n < 0 || n > 0o777) throw new Error("Mode must be octal, like 0644");
  return n;
}

export function splitRel(rel: string): string[] {
  if (typeof rel !== "string") throw new Error("Path required");
  if (rel.includes("\0")) throw new Error("Invalid path");
  const n = rel.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(n)) throw new Error("Absolute path");
  const parts = n.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === ".." || p === "~")) {
    throw new Error("That path is outside this account");
  }
  return parts;
}

export function virtNormalize(rel: string): string {
  const parts = splitRel(rel);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function virtParent(rel: string): string | null {
  const parts = splitRel(rel);
  if (parts.length === 0) return null;
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function virtJoin(base: string, name: string): string {
  const prefix = virtNormalize(base);
  const entry = assertEntryName(name);
  return prefix === "/" ? `/${entry}` : `${prefix}/${entry}`;
}

export function virtSegments(rel: string): string[] {
  return splitRel(rel);
}

export function assertEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  if (trimmed.length > 255) throw new Error("Name is too long");
  if (/[\\/\0]/.test(trimmed)) throw new Error("Name cannot contain slashes");
  if (trimmed === "." || trimmed === "..") throw new Error("Invalid name");
  return trimmed;
}

const VIRT_ROOT_RE = /^\/home\/[a-z_][a-z0-9_-]{0,31}\/(www|app)$/;

export function assertVirtRoot(root: string): string {
  const n = root.replace(/\\/g, "/");
  if (!VIRT_ROOT_RE.test(n)) {
    throw new Error("Home directory is not a site or app path");
  }
  return n;
}

export function appVirtRoot(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return `/home/sa_${slug || "app"}/app`;
}
