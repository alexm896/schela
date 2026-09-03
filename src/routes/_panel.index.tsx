import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Globe, Lock, Shield } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getDashboard } from "@/lib/panel/server";
import { formatUptime } from "@/lib/utils";

export const Route = createFileRoute("/_panel/")({
  loader: () => getDashboard(),
  component: Overview,
});

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const w = 96;
  const h = 40;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-ring" aria-hidden="true">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

function Metric({
  label,
  value,
  unit,
  spark,
}: {
  label: string;
  value: string;
  unit?: string;
  spark?: number[];
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="font-mono text-3xl font-medium tabular leading-none">
            {value}
            {unit ? (
              <span className="ml-1 text-sm text-muted-foreground">{unit}</span>
            ) : null}
          </p>
          {spark && spark.length > 0 ? <Sparkline values={spark} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Overview() {
  const data = Route.useLoaderData();
  const phpOn = data.modules.some((m) => m.slug === "php" && m.enabled);
  const isolated = data.sites.filter((s) => s.isolated).length;

  return (
    <div>
      <PageHeader
        kicker="Overview"
        title="Server"
        description={`${data.settings.hostname} · up ${formatUptime(data.metrics.uptimeSec)}`}
      />

      <div className="schela-enter grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="CPU"
          value={data.metrics.cpu.toFixed(1)}
          unit="%"
          spark={data.metrics.spark}
        />
        <Metric label="Memory" value={data.metrics.ram.toFixed(0)} unit="%" />
        <Metric label="Disk" value={data.metrics.disk.toFixed(0)} unit="%" />
        <Metric label="Load" value={data.metrics.load.toFixed(2)} />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium">Sites</h2>
              <Link
                to="/sites"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                All sites <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
            {data.sites.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No sites yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {data.sites.slice(0, 5).map((site) => (
                  <li
                    key={site.id}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <Globe className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{site.domain}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        PHP {site.phpVersion}
                        {site.isolated ? " · isolated" : ""}
                      </p>
                    </div>
                    <Badge variant={site.status === "active" ? "ok" : "default"}>
                      {site.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardContent className="flex items-start gap-3 p-5">
              <Lock className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Account isolation</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data.settings.isolation
                    ? `${isolated} of ${data.counts.sites} sites have their own system user and PHP-FPM pool.`
                    : "Isolation is off. Turn it on in Settings."}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-3 p-5">
              <Shield className="mt-0.5 size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Firewall</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Default deny. {data.counts.firewall} rules. SSH, HTTP, and mail
                  only.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Sites</p>
            <p className="mt-1 font-mono text-2xl tabular">{data.counts.sites}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {phpOn ? "PHP multi-version" : "PHP module off"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Node apps</p>
            <p className="mt-1 font-mono text-2xl tabular">{data.counts.apps}</p>
            <p className="mt-1 text-xs text-muted-foreground">Process manager</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Mailboxes</p>
            <p className="mt-1 font-mono text-2xl tabular">
              {data.counts.mailboxes}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.counts.zones} DNS zones
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardContent className="p-5">
          <h2 className="mb-4 text-sm font-medium">Activity</h2>
          {data.activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.activity.map((item) => (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-4"
                >
                  <p className="text-sm">{item.message}</p>
                  <p className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {item.createdAt.slice(11, 16)} UTC
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
