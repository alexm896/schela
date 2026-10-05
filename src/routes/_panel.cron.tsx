import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Clock, Plus } from "lucide-react";
import { useState } from "react";
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
import { CRON_PRESETS } from "@/lib/panel/net";
import { createCron, deleteCron, listCron, toggleCron } from "@/lib/panel/ops";
import { appSystemUser } from "@/features/apps/apps";

export const Route = createFileRoute("/_panel/cron")({
  loader: () => listCron(),
  component: CronPage,
});

function CronPage() {
  const { jobs, sites, apps } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"site" | "app">("site");
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<string>(CRON_PRESETS[1].value);
  const [custom, setCustom] = useState("");
  const [command, setCommand] = useState("");

  const targets = kind === "site" ? sites : apps;
  const schedule = custom.trim() || preset;
  const selectedSite = kind === "site" ? sites.find((s) => String(s.id) === targetId) : undefined;
  const selectedApp = kind === "app" ? apps.find((a) => String(a.id) === targetId) : undefined;
  const runAs = selectedSite
    ? selectedSite.systemUser
    : selectedApp
      ? appSystemUser(selectedApp.name)
      : "";

  async function onCreate() {
    if (!targetId) return;
    setBusy(true);
    try {
      await createCron({
        data: {
          kind,
          targetId: Number(targetId),
          name,
          schedule,
          command,
        },
      });
      toast.success("Job scheduled — runs as the site user");
      setOpen(false);
      setName("");
      setCommand("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create job");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Schedule"
        title="Cron jobs"
        description="Jobs run as the site or app user, in that account’s home directory. Standard five-field cron, written to /etc/cron.d/schela-jobs."
        action={
          <Button onClick={() => setOpen(true)} disabled={sites.length + apps.length === 0}>
            <Plus className="size-4" />
            New job
          </Button>
        }
      />

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Clock className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {sites.length + apps.length === 0 ? (
                <>
                  Create a <Link to="/sites" className="text-foreground underline">site</Link>{" "}
                  first, then schedule work in its home directory.
                </>
              ) : (
                "No scheduled jobs yet."
              )}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
          <ul className="divide-y divide-border">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{job.name || job.command}</p>
                    <Badge variant="outline">{job.kind}</Badge>
                    <Badge variant={job.enabled ? "ok" : "default"}>
                      {job.enabled ? "on" : "off"}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {job.schedule} · {job.user} · {job.targetLabel}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {job.command}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={job.enabled}
                    onCheckedChange={(v) =>
                      void toggleCron({ data: { id: job.id, enabled: v } })
                        .then(() => router.invalidate())
                        .catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : "Failed"),
                        )
                    }
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void deleteCron({ data: { id: job.id } }).then(() => router.invalidate())
                    }
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New cron job</DialogTitle>
            <DialogDescription>
              Runs as {runAs || "the account user"} with the working directory set to www or app.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Kind</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    setKind(v as "site" | "app");
                    setTargetId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="site">Site</SelectItem>
                    <SelectItem value="app">Node app</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Target</Label>
                <Select value={targetId} onValueChange={setTargetId}>
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cron-name">Name (optional)</Label>
              <Input
                id="cron-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="queue worker"
              />
            </div>
            <div className="grid gap-2">
              <Label>Schedule</Label>
              <Select
                value={preset}
                onValueChange={(v) => {
                  setPreset(v);
                  setCustom("");
                }}
              >
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
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="or custom: */5 * * * *"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cron-cmd">Command</Label>
              <Input
                id="cron-cmd"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={kind === "site" ? "php artisan schedule:run" : "node jobs.js"}
                className="font-mono text-sm"
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onCreate()}
              disabled={busy || !targetId || !command.trim()}
            >
              {busy ? "Saving…" : "Create job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
