import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatSize } from "@/features/files/files";
import { destinationSummary } from "../backups";
import type { BackupJob, BackupRun } from "../types";

export function BackupJobCard({
  job,
  last,
  running,
  onToggle,
  onRun,
  onEdit,
  onRemove,
}: {
  job: BackupJob;
  last: BackupRun | undefined;
  running: boolean;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const tags = destinationSummary(job);
  return (
    <Card>
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
            onCheckedChange={onToggle}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={onRun}
          >
            <Play className="size-4" />
            {running ? "Running…" : "Run now"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
