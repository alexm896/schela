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
  rsyncSshKey: string;
  s3Enabled: boolean;
  s3Bucket: string;
  s3Prefix: string;
  s3Region: string;
  s3AccessKey: string;
  s3HasSecret: boolean;
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
