const MAIL_RE = /^[a-z0-9._+-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function isMailAddress(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t || t.length > 120) return false;
  // Rejecting control characters is the point of this check.
  // eslint-disable-next-line no-control-regex
  if (t.includes("..") || /[\s<>"'\\(),;:\x00-\x1f]/.test(t)) return false;
  return MAIL_RE.test(t);
}

export function assertMailAddress(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!isMailAddress(t)) throw new Error("Invalid email address");
  return t;
}

export function assertImapFolder(name: string): string {
  const t = name.trim();
  if (!t || t.length > 80) throw new Error("Invalid folder");
  if (t.includes("..") || t.startsWith("/") || t.startsWith(".")) {
    throw new Error("Invalid folder");
  }
  if (/[\r\n\0\\"']/.test(t)) throw new Error("Invalid folder");
  if (!/^[A-Za-z0-9._/-]+$/.test(t)) throw new Error("Invalid folder");
  return t;
}

export function quoteImap(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error("Invalid IMAP string");
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
