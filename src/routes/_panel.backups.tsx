import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Archive, Play, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BACKUP_SCOPES, destinationSummary, type BackupJob } from "@/lib/panel/backup";
import {
  createBackupJob,
  deleteBackupJob,
  listBackups,
  runBackupJob,
  toggleBackupJob,
  updateBackupJob,
} from "@/lib/panel/backups";
import { CRON_PRESETS } from "@/features/cron/cron";
import { formatSize } from "@/lib/panel/file-types";

export const Route = createFileRoute("/_panel/backups")({
  loader: () => listBackups(),
  component: BackupsPage,
});

type FormState = {
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

const emptyForm = (): FormState => ({
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

function formFromJob(job: BackupJob): FormState {
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

function BackupsPage() {
  const { jobs, runs, sites, apps } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState<number | null>(null);

  const schedule = form.custom.trim() || form.schedule;
  const targets = form.scope === "site" ? sites : form.scope === "app" ? apps : [];

  function patch(p: Partial<FormState>) {
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
              setForm(emptyForm());
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
          {jobs.map((job) => {
            const last = lastByJob.get(job.id);
            const tags = destinationSummary(job);
            return (
              <Card key={job.id}>
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{job.name}</p>
                      {tags.map((t) => (
                        <Badge key={t} variant={t === "local" ? "ok" : "outline"}>
                          {t}
                        </Badge>
                      ))}
                      <Badge variant={job.enabled ? "ok" : "default"}>
                        {job.enabled ? "scheduled" : "paused"}
                      </Badge>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {job.schedule} · keep {job.retain} · {job.scope}
                      {job.targetLabel ? ` · ${job.targetLabel}` : ""}
                    </p>
                    {last ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last {last.status}
                        {last.sizeBytes ? ` · ${formatSize(last.sizeBytes)}` : ""}
                        {last.message ? ` · ${last.message}` : ""}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={job.enabled}
                      onCheckedChange={(v) =>
                        void toggleBackupJob({ data: { id: job.id, enabled: v } }).then(() =>
                          router.invalidate(),
                        )
                      }
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={running === job.id}
                      onClick={() => void onRun(job.id)}
                    >
                      <Play className="size-4" />
                      {running === job.id ? "Running…" : "Run now"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditId(job.id);
                        setForm(formFromJob(job));
                        setOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void deleteBackupJob({ data: { id: job.id } }).then(() =>
                          router.invalidate(),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {runs.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Recent runs
          </h2>
          <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
            <ul className="divide-y divide-border">
              {runs.slice(0, 12).map((run, i) => (
                <li key={`${run.jobId}-${run.startedAt}-${i}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{run.name}</p>
                    <Badge
                      variant={
                        run.status === "ok" ? "ok" : run.status === "partial" ? "warn" : "danger"
                      }
                    >
                      {run.status}
                    </Badge>
                    {run.localOk ? <Badge variant="outline">local</Badge> : null}
                    {run.rsyncEnabled ? (
                      <Badge variant={run.rsyncOk ? "ok" : "warn"}>rsync</Badge>
                    ) : null}
                    {run.s3Enabled ? (
                      <Badge variant={run.s3Ok ? "ok" : "warn"}>s3</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {run.sizeBytes ? formatSize(run.sizeBytes) : "—"} · {run.localPath || "no file"}
                    {run.message ? ` · ${run.message}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit backup" : "New backup"}</DialogTitle>
            <DialogDescription>
              Local tar.gz is always written to /var/lib/schela/backups. Rsync and S3 are extra
              copies of that same file, run together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bk-name">Name</Label>
              <Input
                id="bk-name"
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>What</Label>
                <Select value={form.scope} onValueChange={(v) => patch({ scope: v, targetId: "" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BACKUP_SCOPES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {targets.length > 0 ? (
                <div className="grid gap-2">
                  <Label>Target</Label>
                  <Select value={form.targetId} onValueChange={(v) => patch({ targetId: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.domain}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label>Keep</Label>
                  <Input
                    value={form.retain}
                    onChange={(e) => patch({ retain: e.target.value })}
                    inputMode="numeric"
                  />
                </div>
              )}
            </div>
            {targets.length > 0 ? (
              <div className="grid gap-2">
                <Label>Keep copies</Label>
                <Input
                  value={form.retain}
                  onChange={(e) => patch({ retain: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            ) : null}
            {form.scope !== "mail" ? (
              <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
                <p className="text-sm font-medium">Include mail store</p>
                <Switch
                  checked={form.includeMail}
                  onCheckedChange={(v) => patch({ includeMail: v })}
                />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label>Schedule</Label>
              <Select value={form.schedule} onValueChange={(v) => patch({ schedule: v, custom: "" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={form.custom}
                onChange={(e) => patch({ custom: e.target.value })}
                placeholder="or custom: 0 3 * * *"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>

            <div className="rounded-lg bg-secondary px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Local disk</p>
                <Badge variant="ok">always</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                /var/lib/schela/backups — never skipped
              </p>
            </div>

            <div className="rounded-lg border border-border px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">rsync</p>
                <Switch
                  checked={form.rsyncEnabled}
                  onCheckedChange={(v) => patch({ rsyncEnabled: v })}
                />
              </div>
              {form.rsyncEnabled ? (
                <div className="mt-3 grid gap-3">
                  <div className="grid gap-2">
                    <Label>Destination</Label>
                    <Input
                      value={form.rsyncDest}
                      onChange={(e) => patch({ rsyncDest: e.target.value })}
                      placeholder="user@offsite:/backups/schela"
                      className="font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>SSH key (optional)</Label>
                    <Input
                      value={form.rsyncSshKey}
                      onChange={(e) => patch({ rsyncSshKey: e.target.value })}
                      placeholder="/var/lib/schela/backup_id_ed25519"
                      className="font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-border px-3 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">S3 / R2 / MinIO</p>
                <Switch
                  checked={form.s3Enabled}
                  onCheckedChange={(v) => patch({ s3Enabled: v })}
                />
              </div>
              {form.s3Enabled ? (
                <div className="mt-3 grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-2">
                      <Label>Bucket</Label>
                      <Input
                        value={form.s3Bucket}
                        onChange={(e) => patch({ s3Bucket: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Region</Label>
                      <Input
                        value={form.s3Region}
                        onChange={(e) => patch({ s3Region: e.target.value })}
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Prefix</Label>
                    <Input
                      value={form.s3Prefix}
                      onChange={(e) => patch({ s3Prefix: e.target.value })}
                      className="font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Endpoint (blank = AWS)</Label>
                    <Input
                      value={form.s3Endpoint}
                      onChange={(e) => patch({ s3Endpoint: e.target.value })}
                      placeholder="https://<id>.r2.cloudflarestorage.com"
                      className="font-mono text-xs"
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Access key</Label>
                    <Input
                      value={form.s3AccessKey}
                      onChange={(e) => patch({ s3AccessKey: e.target.value })}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Secret key{editId ? " (blank keeps current)" : ""}</Label>
                    <Input
                      type="password"
                      value={form.s3SecretKey}
                      onChange={(e) => patch({ s3SecretKey: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onSave()} disabled={busy || !form.name.trim()}>
              {busy ? "Saving…" : "Save job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
