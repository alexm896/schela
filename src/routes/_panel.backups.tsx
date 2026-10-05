import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Archive, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  createBackupJob,
  deleteBackupJob,
  listBackups,
  runBackupJob,
  toggleBackupJob,
  updateBackupJob,
} from "@/features/backups/api";
import { BackupJobCard } from "@/features/backups/components/backup-job-card";
import { BackupJobDialog } from "@/features/backups/components/backup-job-dialog";
import { BackupRunList } from "@/features/backups/components/backup-run-list";
import { backupFormFromJob, emptyBackupForm, type BackupForm } from "@/features/backups/form";
import type { BackupJob } from "@/features/backups/types";

export const Route = createFileRoute("/_panel/backups")({
  loader: () => listBackups(),
  component: BackupsPage,
});

function BackupsPage() {
  const { jobs, runs, sites, apps } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<BackupForm>(emptyBackupForm);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<number | null>(null);

  const schedule = form.custom.trim() || form.schedule;
  const targets = form.scope === "site" ? sites : form.scope === "app" ? apps : [];

  function patch(p: Partial<BackupForm>) {
    setForm((f) => ({ ...f, ...p }));
  }

  function payload() {
    return {
      name: form.name,
      scope: form.scope as BackupJob["scope"],
      targetId: form.targetId ? Number(form.targetId) : null,
      includeMail: form.includeMail,
      schedule,
      retain: Number(form.retain) || 7,
      enabled: true,
      rsyncEnabled: form.rsyncEnabled,
      rsyncDest: form.rsyncDest,
      rsyncSshKey: form.rsyncSshKey,
      s3Enabled: form.s3Enabled,
      s3Bucket: form.s3Bucket,
      s3Prefix: form.s3Prefix,
      s3Region: form.s3Region,
      s3AccessKey: form.s3AccessKey,
      s3SecretKey: form.s3SecretKey,
      s3Endpoint: form.s3Endpoint,
    };
  }

  async function onSave() {
    setBusy(true);
    try {
      if (editId) {
        await updateBackupJob({ data: { id: editId, ...payload() } });
        toast.success("Backup job updated");
      } else {
        await createBackupJob({ data: payload() });
        toast.success("Backup job saved — local copy always, remotes if enabled");
      }
      setOpen(false);
      setEditId(null);
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save backup");
    } finally {
      setBusy(false);
    }
  }

  async function onRun(id: number) {
    setRunning(id);
    try {
      const run = await runBackupJob({ data: { id } });
      if (run.status === "ok") toast.success("Backup finished");
      else if (run.status === "partial") toast.message("Local copy ok — a remote push failed");
      else toast.error(run.message || "Backup failed");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setRunning(null);
    }
  }

  const lastByJob = useMemo(() => {
    const map = new Map<number, (typeof runs)[number]>();
    for (const run of runs) {
      if (!map.has(run.jobId)) map.set(run.jobId, run);
    }
    return map;
  }, [runs]);

  return (
    <div>
      <PageHeader
        kicker="Security"
        title="Backups"
        description="Every run writes a tar.gz on this server. Turn on rsync, S3 (or R2/MinIO), or both — the same archive is pushed to every destination that’s on."
        action={
          <Button
            onClick={() => {
              setEditId(null);
              setForm(emptyBackupForm());
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            New backup
          </Button>
        }
      />

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Archive className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No backup jobs yet. Local disk is always kept; remotes are optional.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <BackupJobCard
              key={job.id}
              job={job}
              last={lastByJob.get(job.id)}
              running={running === job.id}
              onToggle={(v) =>
                void toggleBackupJob({ data: { id: job.id, enabled: v } }).then(() =>
                  router.invalidate(),
                )
              }
              onRun={() => void onRun(job.id)}
              onEdit={() => {
                setEditId(job.id);
                setForm(backupFormFromJob(job));
                setOpen(true);
              }}
              onRemove={() =>
                void deleteBackupJob({ data: { id: job.id } }).then(() => router.invalidate())
              }
            />
          ))}
        </div>
      )}

      {runs.length > 0 ? <BackupRunList runs={runs} /> : null}

      <BackupJobDialog
        open={open}
        onOpenChange={setOpen}
        editing={Boolean(editId)}
        form={form}
        onPatch={patch}
        targets={targets}
        busy={busy}
        onSave={() => void onSave()}
      />
    </div>
  );
}
