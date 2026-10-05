import { ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DnsCheckResult } from "../dns-check";
import type { MailDnsRow } from "../mail-dns";

export function MailDnsCard({
  zone,
  live,
  checking,
  onCheck,
}: {
  zone: { domain: string; records: MailDnsRow[] };
  live: DnsCheckResult | undefined;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">{zone.domain} DNS</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={zone.records.every((r) => r.present) ? "ok" : "warn"}>
              panel {zone.records.filter((r) => r.present).length}/{zone.records.length}
            </Badge>
            {live ? (
              <Badge variant={live.ok ? "ok" : "warn"}>
                live {live.records.filter((r) => r.ok).length}/{live.records.length}
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={onCheck}
            >
              <ShieldCheck className="size-4" />
              {checking ? "Checking…" : "Check live DNS"}
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a
                href={`https://mxtoolbox.com/SuperTool.aspx?action=mx%3a${encodeURIComponent(zone.domain)}&run=toolpage`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="size-4" />
                MXToolbox
              </a>
            </Button>
          </div>
        </div>
        <ul className="space-y-2 font-mono text-xs">
          {zone.records.map((rec) => {
            const liveRec = live?.records.find(
              (r) => r.type === rec.type && r.name === rec.name,
            );
            return (
              <li
                key={`${rec.type}-${rec.name}`}
                className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="w-16 shrink-0 text-muted-foreground">{rec.type}</span>
                <span className="w-28 shrink-0">{rec.name}</span>
                <span className="min-w-0 flex-1 truncate">{rec.value}</span>
                <Badge variant={rec.present ? "ok" : "warn"}>
                  {rec.present ? "panel" : "missing"}
                </Badge>
                {liveRec ? (
                  <Badge variant={liveRec.ok ? "ok" : "warn"}>
                    {liveRec.ok ? "live" : "not live"}
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
        {live && !live.ok ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Public DNS (Cloudflare 1.1.1.1) does not yet match. Point the domain’s
            nameservers here, or copy the records to your DNS host, then check again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
