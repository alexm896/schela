import { CRON_PRESETS } from "@/features/cron/cron";
import type { BackupJob } from "./types";

// The backup job dialog's form: every field as the inputs hold it.

export type BackupForm = {
  name: string;
  scope: string;
  targetId: string;
  includeMail: boolean;
  schedule: string;
  custom: string;
  retain: string;
  rsyncEnabled: boolean;
  rsyncDest: string;
  rsyncSshKey: string;
  s3Enabled: boolean;
  s3Bucket: string;
  s3Prefix: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint: string;
};

export const emptyBackupForm = (): BackupForm => ({
  name: "nightly",
  scope: "all",
  targetId: "",
  includeMail: true,
  schedule: CRON_PRESETS[3].value,
  custom: "",
  retain: "7",
  rsyncEnabled: false,
  rsyncDest: "",
  rsyncSshKey: "",
  s3Enabled: false,
  s3Bucket: "",
  s3Prefix: "schela/",
  s3Region: "us-east-1",
  s3AccessKey: "",
  s3SecretKey: "",
  s3Endpoint: "",
});

export function backupFormFromJob(job: BackupJob): BackupForm {
  const known = CRON_PRESETS.some((p) => p.value === job.schedule);
  return {
    name: job.name,
    scope: job.scope,
    targetId: job.targetId ? String(job.targetId) : "",
    includeMail: job.includeMail,
    schedule: known ? job.schedule : CRON_PRESETS[3].value,
    custom: known ? "" : job.schedule,
    retain: String(job.retain),
    rsyncEnabled: job.rsyncEnabled,
    rsyncDest: job.rsyncDest,
    rsyncSshKey: job.rsyncSshKey,
    s3Enabled: job.s3Enabled,
    s3Bucket: job.s3Bucket,
    s3Prefix: job.s3Prefix,
    s3Region: job.s3Region,
    s3AccessKey: job.s3AccessKey,
    s3SecretKey: "",
    s3Endpoint: job.s3Endpoint,
  };
}
