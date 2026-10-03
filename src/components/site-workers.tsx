import { Cog, Plus, RotateCw, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  createSiteWorker,
  deleteSiteWorker,
  listSiteWorkers,
  restartSiteWorker,
  setSiteWorkerEnabled,
  siteWorkerLogs,
  updateSiteWorker,
  type SiteWorkerWithStatus,
} from "@/lib/panel/site-workers";
import {
  WORKER_LIMITS,
  WORKER_PRESETS,
  WORKER_PRESET_KEYS,
  parseWorkerCommand,
  type WorkerPreset,
} from "@/lib/panel/workers";

type Props = {
  siteId: number;
  systemUser: string;
  phpVersion: string;
  siteActive: boolean;
};

type Draft = {
  id: number | null;
  preset: WorkerPreset;
  name: string;
  command: string;
  processes: string;
  stopTimeout: string;
  memoryMb: string;
};

function draftFromPreset(preset: WorkerPreset): Draft {
  const p = WORKER_PRESETS[preset];
  return {
    id: null,
    preset,
    name: p.name,
    command: p.command,
    processes: String(p.processes),
    stopTimeout: String(p.stopTimeout),
    memoryMb: String(p.memoryMb),
  };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function summarize(worker: SiteWorkerWithStatus) {
  const total = worker.processes;
  const running = worker.instances.filter((i) => i.activeState === "active").length;
  const failed = worker.instances.filter((i) => i.activeState === "failed").length;
  const restarts = worker.instances.reduce((sum, i) => sum + i.restarts, 0);
  const memory = worker.instances.reduce((sum, i) => sum + (i.memoryBytes ?? 0), 0);
  let label: string;
  let variant: "ok" | "warn" | "outline" | "default";
  if (!worker.enabled) {
    label = "stopped";
    variant = "default";
  } else if (failed > 0) {
    label = `${failed} failed`;
    variant = "warn";
  } else if (worker.instances.length === 0) {
    label = "status unknown";
    variant = "outline";
  } else if (running === total) {
    label = `${running}/${total} running`;
    variant = "ok";
  } else {
    label = `${running}/${total} running`;
    variant = "warn";
  }
  return { label, variant, restarts, memory };
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function SiteWorkersCard({ siteId, systemUser, phpVersion, siteActive }: Props) {
  const [workers, setWorkers] = useState<SiteWorkerWithStatus[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [logsFor, setLogsFor] = useState<SiteWorkerWithStatus | null>(null);
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState<SiteWorkerWithStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setWorkers(await listSiteWorkers({ data: { siteId } }));
    } catch (err) {
      toast.error(errorText(err, "Could not load workers"));
    }
  }, [siteId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  let commandError = "";
  if (draft) {
    try {
      parseWorkerCommand(draft.command);
    } catch (err) {
      commandError = draft.command.trim() ? errorText(err, "Invalid command") : "";
    }
  }
  const singleton = draft ? WORKER_PRESETS[draft.preset].singleton : false;

  async function onSave() {
    if (!draft) return;
    setBusy(true);
    const fields = {
      preset: draft.preset,
      name: draft.name,
      command: draft.command,
      processes: Number(draft.processes),
      stopTimeout: Number(draft.stopTimeout),
      memoryMb: Number(draft.memoryMb),
    };
    try {
      if (draft.id === null) {
        await createSiteWorker({ data: { siteId, ...fields } });
        toast.success(`Worker ${draft.name} started`);
      } else {
        await updateSiteWorker({ data: { id: draft.id, ...fields } });
        toast.success("Worker updated. Running processes restart after their current job.");
      }
      setDraft(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err, "Could not save worker"));
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(worker: SiteWorkerWithStatus, enabled: boolean) {
    try {
      await setSiteWorkerEnabled({ data: { id: worker.id, enabled } });
      await refresh();
    } catch (err) {
      toast.error(errorText(err, "Could not change worker"));
    }
  }

  async function onRestart(worker: SiteWorkerWithStatus) {
    try {
      await restartSiteWorker({ data: { id: worker.id } });
      toast.success(`Restarting ${worker.name}. Current jobs finish first.`);
      window.setTimeout(() => void refresh(), 1500);
    } catch (err) {
      toast.error(errorText(err, "Could not restart worker"));
    }
  }

  async function loadLogs(worker: SiteWorkerWithStatus) {
    setLogsFor(worker);
    setLogLines(null);
    try {
      const out = await siteWorkerLogs({ data: { id: worker.id, lines: 200 } });
      setLogLines(out.lines);
    } catch (err) {
      setLogLines([]);
      toast.error(errorText(err, "Could not read logs"));
    }
  }

  async function onRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteSiteWorker({ data: { id: removing.id } });
      toast.success(`Worker ${removing.name} removed`);
      setRemoving(null);
      await refresh();
    } catch (err) {
      toast.error(errorText(err, "Could not remove worker"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Workers</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Long-running processes such as Laravel queues, Horizon and the scheduler. Run as{" "}
            <span className="font-mono">{systemUser}</span> in{" "}
            <span className="font-mono">/home/{systemUser}/www</span>, restarted if they stop.
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft(draftFromPreset("queue"))}>
          <Plus className="size-4" />
          New worker
        </Button>
      </CardHeader>
      <CardContent>
        {!siteActive ? (
          <p className="mb-3 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
            The site is stopped, so its workers are stopped too.
          </p>
        ) : null}
        {workers === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : workers.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Cog className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No workers yet. Add a queue worker to process Laravel jobs.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {workers.map((worker) => {
              const s = summarize(worker);
              return (
                <li key={worker.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{worker.name}</p>
                      <Badge variant="outline">
                        {WORKER_PRESETS[worker.preset as WorkerPreset]?.label ?? worker.preset}
                      </Badge>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{worker.command}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {worker.processes} process{worker.processes === 1 ? "" : "es"} · limit {worker.memoryMb} MB
                      {s.memory ? ` · using ${formatBytes(s.memory)}` : ""} · stop wait {worker.stopTimeout}s
                      {s.restarts ? ` · ${s.restarts} restart${s.restarts === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      checked={worker.enabled}
                      aria-label={worker.enabled ? `Stop ${worker.name}` : `Start ${worker.name}`}
                      onCheckedChange={(v) => void onToggle(worker, v)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!worker.enabled || !siteActive}
                      onClick={() => void onRestart(worker)}
                    >
                      <RotateCw className="size-4" />
                      Restart
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void loadLogs(worker)}>
                      <ScrollText className="size-4" />
                      Logs
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft({
                          id: worker.id,
                          preset: (WORKER_PRESET_KEYS.includes(worker.preset as WorkerPreset)
                            ? worker.preset
                            : "custom") as WorkerPreset,
                          name: worker.name,
                          command: worker.command,
                          processes: String(worker.processes),
                          stopTimeout: String(worker.stopTimeout),
                          memoryMb: String(worker.memoryMb),
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(worker)}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id === null ? "New worker" : "Edit worker"}</DialogTitle>
            <DialogDescription>
              Runs without a shell as {systemUser}. <span className="font-mono">php</span> is PHP{" "}
              {phpVersion}, the site&apos;s version.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Type</Label>
                  <Select
                    value={draft.preset}
                    onValueChange={(v) =>
                      setDraft(
                        draft.id === null
                          ? draftFromPreset(v as WorkerPreset)
                          : {
                              ...draft,
                              preset: v as WorkerPreset,
                              processes: WORKER_PRESETS[v as WorkerPreset].singleton ? "1" : draft.processes,
                            },
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKER_PRESET_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {WORKER_PRESETS[key].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="worker-name">Name</Label>
                  <Input
                    id="worker-name"
                    value={draft.name}
                    maxLength={60}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="worker-command">Command</Label>
                <Input
                  id="worker-command"
                  value={draft.command}
                  maxLength={WORKER_LIMITS.commandLength}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="php artisan queue:work"
                  className="font-mono text-sm"
                  spellCheck={false}
                  aria-invalid={commandError ? true : undefined}
                />
                {commandError ? (
                  <p className="text-xs text-destructive">{commandError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Arguments are passed as typed. Pipes, redirects and variables are not supported.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="worker-processes">Processes</Label>
                  <Input
                    id="worker-processes"
                    type="number"
                    min={WORKER_LIMITS.processes.min}
                    max={WORKER_LIMITS.processes.max}
                    value={draft.processes}
                    disabled={singleton}
                    onChange={(e) => setDraft({ ...draft, processes: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="worker-stop">Stop wait (s)</Label>
                  <Input
                    id="worker-stop"
                    type="number"
                    min={WORKER_LIMITS.stopTimeout.min}
                    max={WORKER_LIMITS.stopTimeout.max}
                    value={draft.stopTimeout}
                    onChange={(e) => setDraft({ ...draft, stopTimeout: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="worker-memory">Memory (MB)</Label>
                  <Input
                    id="worker-memory"
                    type="number"
                    min={WORKER_LIMITS.memoryMb.min}
                    max={WORKER_LIMITS.memoryMb.max}
                    value={draft.memoryMb}
                    onChange={(e) => setDraft({ ...draft, memoryMb: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {singleton
                  ? `${WORKER_PRESETS[draft.preset].label} runs as a single process. `
                  : ""}
                Stop wait is how long a running job may take to finish on restart before it is killed.
                Set it above your longest job.
              </p>
              <p className="text-xs text-muted-foreground">
                Workers run in a sandbox: they can write only inside /home/{systemUser}. Send mail over SMTP
                (<span className="font-mono">MAIL_MAILER=smtp</span>, 127.0.0.1:25); sendmail does not work here.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onSave()}
              disabled={busy || !draft?.name.trim() || !draft?.command.trim() || Boolean(commandError)}
            >
              {busy ? "Saving…" : draft?.id === null ? "Create worker" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsFor !== null} onOpenChange={(open) => !open && setLogsFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Logs · {logsFor?.name}</DialogTitle>
            <DialogDescription>Last 200 lines from all of this worker&apos;s processes.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {logLines === null ? "Loading…" : logLines.length ? logLines.join("\n") : "No output yet."}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => logsFor && void loadLogs(logsFor)}>
              Refresh
            </Button>
            <Button variant="ghost" onClick={() => setLogsFor(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              Its processes get a stop signal and finish their current job, then the worker is deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void onRemove()}>
              Remove worker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
