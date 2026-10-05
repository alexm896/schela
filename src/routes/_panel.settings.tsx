import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAdminIdentity, getPanelState, updateAdminIdentity, updateSettings } from "@/lib/panel/server";
import { NODE_VERSIONS, PHP_VERSIONS } from "@/lib/panel/types";

export const Route = createFileRoute("/_panel/settings")({
  loader: async () => {
    const [state, admin] = await Promise.all([getPanelState(), getAdminIdentity()]);
    return { ...state, admin };
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { settings, admin } = Route.useLoaderData();
  const router = useRouter();
  const [hostname, setHostname] = useState(settings.hostname);
  const [sshPort, setSshPort] = useState(String(settings.sshPort));
  const [username, setUsername] = useState(admin.username);
  const [busy, setBusy] = useState(false);

  async function saveIdentity() {
    setBusy(true);
    try {
      await updateSettings({
        data: { hostname, sshPort: Number(sshPort) || 22 },
      });
      toast.success("Saved");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Server"
        title="Settings"
        description="Identity, isolation defaults, and the runtimes this server already has."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="host">Hostname</Label>
              <Input
                id="host"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ssh">SSH port</Label>
              <Input
                id="ssh"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <Button onClick={() => void saveIdentity()} disabled={busy} className="w-fit">
              {busy ? "Saving…" : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admin login</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="admin-user">Username</Label>
              <Input
                id="admin-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Default is admin. Set an email here only if you want to log in with one.
              </p>
            </div>
            <Button
              onClick={() =>
                void (async () => {
                  setBusy(true);
                  try {
                    const next = await updateAdminIdentity({ data: { username } });
                    setUsername(next.username);
                    toast.success("Login name saved");
                    await router.invalidate();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not save");
                  } finally {
                    setBusy(false);
                  }
                })()
              }
              disabled={busy || !username.trim()}
              className="w-fit"
            >
              {busy ? "Saving…" : "Save login"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hardening</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <div>
                <p className="text-sm font-medium">Isolate new sites</p>
                <p className="text-xs text-muted-foreground">
                  Dedicated system user, PHP-FPM pool, and home directory
                </p>
              </div>
              <Switch
                checked={settings.isolation}
                onCheckedChange={(v) =>
                  void updateSettings({ data: { isolation: v } }).then(() =>
                    router.invalidate(),
                  )
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <div>
                <p className="text-sm font-medium">Unattended upgrades</p>
                <p className="text-xs text-muted-foreground">Security patches only</p>
              </div>
              <Switch
                checked={settings.autoUpdates}
                onCheckedChange={(v) =>
                  void updateSettings({ data: { autoUpdates: v } }).then(() =>
                    router.invalidate(),
                  )
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>PHP versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {PHP_VERSIONS.map((v) => (
                <li
                  key={v}
                  className="rounded-full bg-secondary px-3 py-1 font-mono text-xs"
                >
                  {v}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Each site pins one. Switching reloads only that pool.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Node versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {NODE_VERSIONS.map((v) => (
                <li
                  key={v}
                  className="rounded-full bg-secondary px-3 py-1 font-mono text-xs"
                >
                  {v}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Apps pick a version at start. Restarts stay in-process.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
