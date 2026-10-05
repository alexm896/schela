// Backup jobs: scopes, destination checks and labels. Pure, shared by the
// server functions, the UI and the tests.

export const BACKUP_SCOPES = [
  { value: "all", label: "Everything — sites, apps, mail" },
  { value: "sites", label: "All PHP sites" },
  { value: "apps", label: "All Node apps" },
  { value: "mail", label: "Mailboxes only" },
  { value: "site", label: "One site" },
  { value: "app", label: "One Node app" },
] as const;

export type BackupScope = (typeof BACKUP_SCOPES)[number]["value"];

export function assertRsyncDest(raw: string): string {
  const t = raw.trim();
  if (!t) throw new Error("rsync destination required");
  if (/[\n\r]/.test(t) || t.includes(";") || t.includes("|") || t.includes("&") || t.includes("$") || t.includes("`")) {
    throw new Error("rsync destination contains unsafe characters");
  }
  if (t.startsWith("rsync://")) return t;
  if (/^([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:\S+$/.test(t)) return t;
  throw new Error("Use user@host:/path or rsync://host/module/path");
}

export function assertSshKey(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (!t.startsWith("/") || /[\n\r;|&$`\s]/.test(t) || t.includes("..")) {
    throw new Error("SSH key must be an absolute path with no spaces");
  }
  return t;
}

export function assertS3Bucket(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(t)) {
    throw new Error("Invalid S3 bucket name");
  }
  return t;
}

export function assertS3Prefix(raw: string): string {
  let t = raw.trim().replace(/^\/+/, "");
  if (t && !t.endsWith("/")) t += "/";
  if (/[\n\r;|&$`]/.test(t)) throw new Error("Invalid S3 prefix");
  return t || "schela/";
}

export function parseBackupScope(raw: string): BackupScope {
  if (BACKUP_SCOPES.some((s) => s.value === raw)) return raw as BackupScope;
  throw new Error("Unknown backup scope");
}

export function destinationSummary(job: {
  rsyncEnabled: boolean;
  s3Enabled: boolean;
}): string[] {
  const tags = ["local"];
  if (job.rsyncEnabled) tags.push("rsync");
  if (job.s3Enabled) tags.push("s3");
  return tags;
}

/** What may go with a deleted backup job besides its configuration. */
export const BACKUP_JOB_REMOVAL_OPTIONS = ["archives"] as const;
export type BackupJobRemovalOption = (typeof BACKUP_JOB_REMOVAL_OPTIONS)[number];
