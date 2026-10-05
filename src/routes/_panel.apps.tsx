import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Box, FolderOpen, MoreHorizontal, Plus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createApp, deleteApp, listApps, updateApp } from "@/features/apps/api";
import { NODE_VERSIONS, nodeUserFromDomain } from "@/features/apps/apps";

export const Route = createFileRoute("/_panel/apps")({
  loader: () => listApps(),
  component: AppsPage,
});

function AppsPage() {
  const apps = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [domain, setDomain] = useState("");
  const [name, setName] = useState("");
  const [nodeVersion, setNodeVersion] = useState("22");
  const [entry, setEntry] = useState("server.js");
  const [instances, setInstances] = useState("1");

  const userPreview = domain ? nodeUserFromDomain(domain) : "n_app";

  async function onCreate() {
    setBusy(true);
    try {
      await createApp({
        data: {
          name: name.trim() || undefined,
          domain,
          nodeVersion,
          entry,
          instances: Number(instances) || 1,
        },
      });
      toast.success("App created — DNS A record added");
      setOpen(false);
      setName("");
      setDomain("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start app");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Node.js"
        title="Apps"
        description="Same as a site: a domain or subdomain, its own user, nginx, TLS, and a DNS A record. Port is assigned for you."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            New app
          </Button>
        }
      />

      {apps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Box className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No Node apps yet. Add a domain or subdomain.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
          <ul className="divide-y divide-border">
            {apps.map((app) => (
              <li
                key={app.id}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{app.domain}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {app.name} · :{app.port} · {app.entry} · {app.instances}× Node {app.nodeVersion}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={app.nodeVersion}
                    onValueChange={(v) =>
                      void updateApp({ data: { id: app.id, nodeVersion: v } }).then(() =>
                        router.invalidate(),
                      )
                    }
                  >
                    <SelectTrigger className="h-9 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NODE_VERSIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          Node {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {app.ipAddress ? (
                    <Badge variant="outline" className="font-mono">
                      {app.ipAddress}
                    </Badge>
                  ) : null}
                  <Badge variant={app.status === "running" ? "ok" : "warn"}>{app.status}</Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="App actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link
                          to="/files"
                          search={{ kind: "app", id: app.id }}
                          className="flex items-center gap-2"
                        >
                          <FolderOpen className="size-4" />
                          Files
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          void updateApp({
                            data: {
                              id: app.id,
                              status: app.status === "running" ? "stopped" : "running",
                            },
                          }).then(() => router.invalidate())
                        }
                      >
                        {app.status === "running" ? "Stop" : "Start"}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          void deleteApp({ data: { id: app.id } }).then(() => {
                            toast.success("App removed");
                            return router.invalidate();
                          })
                        }
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Node app</DialogTitle>
            <DialogDescription>
              Domain or subdomain. Creates a system user, reverse proxy, TLS, and DNS — same path as a PHP site.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="app-domain">Domain</Label>
              <Input
                id="app-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="api.example.com"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="font-mono text-[11px] text-muted-foreground">User {userPreview}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-name">Name (optional)</Label>
              <Input
                id="app-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="defaults to the domain"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Node</Label>
                <Select value={nodeVersion} onValueChange={setNodeVersion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NODE_VERSIONS.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="entry">Entry</Label>
                <Input
                  id="entry"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="instances">Instances</Label>
              <Input
                id="instances"
                value={instances}
                onChange={(e) => setInstances(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={busy || !domain.trim()}>
              {busy ? "Creating…" : "Create app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
