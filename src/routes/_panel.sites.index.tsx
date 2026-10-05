import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Globe, Plus } from "lucide-react";
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
import { createSite, listSites } from "@/lib/panel/server";
import { PHP_VERSIONS } from "@/lib/panel/types";
import { systemUserFromDomain } from "@/lib/utils";

export const Route = createFileRoute("/_panel/sites/")({
  loader: () => listSites(),
  component: SitesPage,
});

function SitesPage() {
  const sites = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domain, setDomain] = useState("");
  const [phpVersion, setPhpVersion] = useState("8.3");
  const [isolated, setIsolated] = useState(true);
  const [ssl, setSsl] = useState(true);
  const [busy, setBusy] = useState(false);

  const userPreview = domain ? systemUserFromDomain(domain) : "s_site";

  async function onCreate() {
    if (!domain.trim()) return;
    setBusy(true);
    try {
      await createSite({
        data: { domain, phpVersion, isolated, ssl, memoryLimit: "256M" },
      });
      toast.success("Site created — DNS A record added");
      setOpen(false);
      setDomain("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create site");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="PHP"
        title="Sites"
        description="Each site gets its own system user and PHP-FPM pool. Switch PHP versions without touching the others."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New site
          </Button>
        }
      />

      {sites.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Globe className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No sites yet. Add a domain to create an isolated PHP site.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
          <ul className="divide-y divide-border">
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  to="/sites/$id"
                  params={{ id: String(site.id) }}
                  className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{site.domain}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {site.systemUser} · {site.pool}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">PHP {site.phpVersion}</Badge>
                    {site.isolated ? <Badge variant="ok">isolated</Badge> : null}
                    {site.ssl ? <Badge variant="default">tls</Badge> : null}
                    {site.ipAddress ? (
                      <Badge variant="outline" className="font-mono">
                        {site.ipAddress}
                      </Badge>
                    ) : null}
                    <Badge variant={site.status === "active" ? "ok" : "warn"}>
                      {site.status}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New site</DialogTitle>
            <DialogDescription>
              Creates a system user, document root, and a dedicated PHP-FPM pool.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="domain">Domain</Label>
              <Input
                id="domain"
                placeholder="app.example"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label>PHP version</Label>
              <Select value={phpVersion} onValueChange={setPhpVersion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHP_VERSIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      PHP {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <div>
                <p className="text-sm font-medium">Isolate</p>
                <p className="text-xs text-muted-foreground">User {userPreview}</p>
              </div>
              <Switch checked={isolated} onCheckedChange={setIsolated} />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <p className="text-sm font-medium">TLS certificate</p>
              <Switch checked={ssl} onCheckedChange={setSsl} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={busy || !domain.trim()}>
              {busy ? "Creating…" : "Create site"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
