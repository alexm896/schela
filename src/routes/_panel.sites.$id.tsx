import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, FolderLock, FolderOpen, User } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SiteWorkersCard } from "@/components/site-workers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { deleteSite, getSite, retrySiteTls, updateSite } from "@/lib/panel/server";
import { PHP_VERSIONS } from "@/lib/panel/types";
import { normalizeWebRoot, webRootFromRoot } from "@/lib/panel/site-root";

export const Route = createFileRoute("/_panel/sites/$id")({
  loader: async ({ params }) => {
    const site = await getSite({ data: { id: Number(params.id) } });
    if (!site) throw new Error("Site not found");
    return site;
  },
  component: SiteDetail,
});

function SiteDetail() {
  const site = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const savedWebRoot = webRootFromRoot(site.systemUser, site.root);
  const [webRoot, setWebRoot] = useState(savedWebRoot);
  let webRootError = "";
  try {
    normalizeWebRoot(webRoot);
  } catch (err) {
    webRootError = err instanceof Error ? err.message : "Invalid document root";
  }

  async function patch(data: {
    id: number;
    phpVersion?: string;
    memoryLimit?: string;
    isolated?: boolean;
    ssl?: boolean;
    forceHttps?: boolean;
    status?: "active" | "stopped";
    webRoot?: string;
  }) {
    try {
      await updateSite({ data });
      await router.invalidate();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
      return false;
    }
  }

  async function saveWebRoot() {
    const next = normalizeWebRoot(webRoot);
    if (await patch({ id: site.id, webRoot: next })) {
      setWebRoot(next);
      toast.success(`Document root set to www${next ? `/${next}` : ""}`);
    }
  }

  async function onDelete() {
    try {
      await deleteSite({ data: { id: site.id } });
      toast.success("Site removed");
      await navigate({ to: "/sites" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove site");
    }
  }

  return (
    <div>
      <Link
        to="/sites"
        className="mb-4 inline-flex h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Sites
      </Link>
      <PageHeader
        kicker="Site"
        title={site.domain}
        description={site.root}
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/files" search={{ kind: "site", id: site.id }}>
                <FolderOpen className="size-4" />
                Files
              </Link>
            </Button>
            <Badge variant={site.status === "active" ? "ok" : "warn"}>{site.status}</Badge>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>PHP runtime</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="site-web-root">Document root</Label>
              <div className="flex max-w-md items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-md shadow-[var(--shadow-border)]">
                  <span className="shrink-0 pl-3 font-mono text-xs text-muted-foreground">
                    /home/{site.systemUser}/www/
                  </span>
                  <Input
                    id="site-web-root"
                    value={webRoot}
                    onChange={(e) => setWebRoot(e.target.value)}
                    placeholder="public"
                    className="min-w-0 border-0 pl-1 font-mono text-sm shadow-none focus-visible:ring-0"
                    spellCheck={false}
                    aria-invalid={webRootError ? true : undefined}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={Boolean(webRootError) || webRoot.trim().replace(/^\/+|\/+$/g, "") === savedWebRoot}
                  onClick={() => void saveWebRoot()}
                >
                  Save
                </Button>
              </div>
              {webRootError ? (
                <p className="text-xs text-destructive">{webRootError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Folder nginx serves. Laravel and Symfony apps use <span className="font-mono">public</span>; leave
                  empty to serve www itself.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label>Version</Label>
              <Select
                value={site.phpVersion}
                onValueChange={(v) => void patch({ id: site.id, phpVersion: v })}
              >
                <SelectTrigger className="max-w-xs">
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
              <p className="text-xs text-muted-foreground">
                Reloads only this site’s PHP-FPM pool. Other sites keep their version.
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Memory limit</Label>
              <Select
                value={site.memoryLimit}
                onValueChange={(v) => void patch({ id: site.id, memoryLimit: v })}
              >
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["128M", "256M", "512M", "1024M"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <p className="text-sm font-medium">TLS</p>
              <Switch
                checked={site.ssl}
                onCheckedChange={(v) => void patch({ id: site.id, ssl: v })}
              />
            </div>
            {site.ssl ? (
              <div className="rounded-lg border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">
                    {site.cert?.status === "live"
                      ? "Certificate live"
                      : site.cert?.status === "error"
                        ? "Certificate failed"
                        : "Issuing certificate"}
                  </p>
                  <Badge
                    variant={
                      site.cert?.status === "live"
                        ? "ok"
                        : site.cert?.status === "error"
                          ? "warn"
                          : "outline"
                    }
                  >
                    {site.cert?.status ?? "pending"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {site.cert?.status === "live"
                    ? `Let’s Encrypt · ${site.cert.expires || "active"}`
                    : site.cert?.message ||
                      "DNS must point here, then Schela requests a Let’s Encrypt cert."}
                </p>
                {site.cert?.status !== "live" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() =>
                      void retrySiteTls({ data: { id: site.id } })
                        .then(() => router.invalidate())
                        .catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : "Could not issue cert"),
                        )
                    }
                  >
                    Retry certificate
                  </Button>
                ) : (
                  <a
                    href={`https://${site.domain}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex text-sm text-primary hover:underline"
                  >
                    Open https://{site.domain}
                  </a>
                )}
              </div>
            ) : null}
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <p className="text-sm font-medium">Force HTTPS</p>
              <Switch
                checked={site.forceHttps}
                onCheckedChange={(v) => void patch({ id: site.id, forceHttps: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <p className="text-sm font-medium">Site running</p>
              <Switch
                checked={site.status === "active"}
                onCheckedChange={(v) =>
                  void patch({ id: site.id, status: v ? "active" : "stopped" })
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardHeader>
              <CardTitle>Isolation</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
                <p className="text-sm font-medium">Isolate this site</p>
                <Switch
                  checked={site.isolated}
                  onCheckedChange={(v) => void patch({ id: site.id, isolated: v })}
                />
              </div>
              {site.ipAddress ? (
                <div className="flex items-start gap-3 text-sm">
                  <FolderLock className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Dedicated IP</p>
                    <p className="font-mono text-xs text-muted-foreground">{site.ipAddress}</p>
                    <Link to="/ips" className="mt-1 inline-flex text-xs text-primary hover:underline">
                      Manage IPs
                    </Link>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Uses the server primary IP.{" "}
                  <Link to="/ips" className="text-foreground underline">
                    Allocate a dedicated address
                  </Link>
                  .
                </p>
              )}
              <div className="flex items-start gap-3 text-sm">
                <User className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">System user</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {site.systemUser}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm">
                <FolderLock className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">PHP-FPM pool</p>
                  <p className="font-mono text-xs text-muted-foreground">{site.pool}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cannot read other home directories. Process user matches the
                    files on disk.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm font-medium">Remove site</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Removes the vhost, PHP-FPM pool, and system user. Files stay until
                you empty the home directory on the server.
              </p>
              <Button
                variant="destructive"
                className="mt-4"
                onClick={() => void onDelete()}
              >
                Remove site
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <SiteWorkersCard
        siteId={site.id}
        systemUser={site.systemUser}
        phpVersion={site.phpVersion}
        siteActive={site.status === "active"}
      />
    </div>
  );
}
