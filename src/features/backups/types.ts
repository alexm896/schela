import type { BackupScope } from "./backups";

export type BackupJob = {
  id: number;
  name: string;
  scope: BackupScope;
  targetId: number | null;
  targetLabel: string | null;
  includeMail: boolean;
  schedule: string;
  retain: number;
  enabled: boolean;
  rsyncEnabled: boolean;
  rsyncDest: string;
  /** An SSH private key is stored for this job (root only, never read back). */
  rsyncKeySet: boolean;
  /** Its SHA256 fingerprint, when ssh-keygen could read it. */
  rsyncKeyHint: string;
  s3Enabled: boolean;
  s3Bucket: string;
  s3Prefix: string;
  s3Region: string;
  s3AccessKey: string;
  /** An S3 secret key is stored for this job (root only, never read back). */
  s3SecretSet: boolean;
  /** Its last four characters. */
  s3SecretHint: string;
  s3Endpoint: string;
  createdAt: string;
};

export type BackupRun = {
  jobId: number;
  name: string;
  status: "ok" | "partial" | "error";
  startedAt: string;
  finishedAt: string;
  sizeBytes: number;
  localPath: string;
  localOk: boolean;
  rsyncEnabled: boolean;
  rsyncOk: boolean;
  s3Enabled: boolean;
  s3Ok: boolean;
  message: string;
};
