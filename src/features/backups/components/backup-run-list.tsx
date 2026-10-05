import { Badge } from "@/components/ui/badge";
import { formatSize } from "@/features/files/files";
import type { BackupRun } from "../types";

export function BackupRunList({ runs }: { runs: BackupRun[] }) {
  return (
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
  );
}
