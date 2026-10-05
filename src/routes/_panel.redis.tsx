import { createFileRoute, Link } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getRedisStatus } from "@/features/redis/api";

export const Route = createFileRoute("/_panel/redis")({
  loader: () => getRedisStatus(),
  component: RedisPage,
});

function RedisPage() {
  const redis = Route.useLoaderData();

  function copy() {
    const addr = redis.requirepass
      ? `redis://:${redis.requirepass}@${redis.bind}:${redis.port}/0`
      : `${redis.bind}:${redis.port}`;
    void navigator.clipboard.writeText(addr).then(
      () => toast.success("Copied Redis URL"),
      () => toast.error("Could not copy"),
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Cache"
        title="Redis"
        description="Off until you enable it. Disable stops the service and prevents boot start; the package is never removed."
        action={
          <Badge
            variant={
              redis.running ? "ok" : redis.installed ? "warn" : redis.wanted ? "warn" : "outline"
            }
          >
            {redis.running ? "running" : redis.installed ? "stopped" : "not installed"}
          </Badge>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Module
            </p>
            <p className="mt-3 font-mono text-2xl font-medium">
              {redis.wanted ? "on" : "off"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Boot
            </p>
            <p className="mt-3 font-mono text-2xl font-medium">
              {redis.enabledAtBoot ? "enabled" : "disabled"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Listen
            </p>
            <p className="mt-3 font-mono text-lg font-medium">
              {redis.bind}:{redis.port}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Memory
            </p>
            <p className="mt-3 font-mono text-2xl font-medium">{redis.usedMemory || "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <Database className="size-6 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{redis.note}</p>
            {redis.version ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                redis_version {redis.version}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-muted-foreground">
              Bound to{" "}
              <span className="font-mono text-foreground">127.0.0.1:6379</span> with AUTH. Not
              opened on the firewall. Copy the URL into your app — FLUSHALL is disabled.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copy}>
                Copy Redis URL
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/modules">Modules</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
