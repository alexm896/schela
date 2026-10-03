// Site document root: the folder nginx serves, always inside the site's www.

const WEB_ROOT_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;

/**
 * Normalize the document root relative to the site's www directory.
 * "" means www itself; "public" means www/public (Laravel).
 */
export function normalizeWebRoot(raw: string): string {
  const trimmed = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "";
  const parts = trimmed.split("/");
  if (parts.length > 4) throw new Error("Document root can be at most 4 folders deep");
  for (const part of parts) {
    if (!WEB_ROOT_SEGMENT.test(part)) {
      throw new Error("Document root folders may use letters, numbers, dots, dashes and underscores, and cannot start with a dot");
    }
  }
  return parts.join("/");
}

/** Where the site's files live: the file manager and workers use this, not the document root. */
export function siteFilesRoot(systemUser: string): string {
  return `/home/${systemUser}/www`;
}

export function siteRootFor(systemUser: string, webRoot: string): string {
  const base = `/home/${systemUser}/www`;
  return webRoot ? `${base}/${webRoot}` : base;
}

export function webRootFromRoot(systemUser: string, root: string): string {
  const base = `/home/${systemUser}/www`;
  if (root === base) return "";
  return root.startsWith(`${base}/`) ? root.slice(base.length + 1) : "";
}
