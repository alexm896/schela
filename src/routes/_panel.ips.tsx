import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Network, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
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
import { assignIp, createIp, deleteIp, listIps } from "@/features/ips/api";
import type { IpAddress } from "@/features/ips/types";

export const Route = createFileRoute("/_panel/ips")({
  loader: () => listIps(),
  component: IpsPage,
});

function assignmentKey(ip: { siteId: number | null; appId: number | null }) {
  if (ip.siteId) return `site:${ip.siteId}`;
  if (ip.appId) return `app:${ip.appId}`;
  return "none";
}

function IpsPage() {
  const { ips, sites, apps } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<IpAddress | null>(null);

  async function onCreate() {
    setBusy(true);
    try {
      await createIp({ data: { address, label } });
      toast.success(`Added ${address}`);
      setOpen(false);
      setAddress("");
      setLabel("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add IP");
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(id: number, value: string) {
    try {
      if (value === "none") {
        await assignIp({ data: { id, kind: "none", targetId: null } });
      } else if (value.startsWith("site:")) {
        await assignIp({
          data: { id, kind: "site", targetId: Number(value.slice(5)) },
        });
      } else {
        await assignIp({
          data: { id, kind: "app", targetId: Number(value.slice(4)) },
        });
      }
      toast.success("Allocation updated — vhost and DNS A record rewritten");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not allocate IP");
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Network"
        title="IP addresses"
        description="Add extra addresses on this server, then bind one to a site or Node app. Unassigned names keep the server’s primary IP."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Add IP
          </Button>
        }
      />

      {ips.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Network className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No extra IPs yet. Add one that’s already routed to this machine.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-border)]">
          <ul className="divide-y divide-border">
            {ips.map((ip) => (
              <li
                key={ip.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium">{ip.address}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ip.label || "no label"}
                    {ip.assignedTo ? ` · ${ip.assignedTo}` : " · pool"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={assignmentKey(ip)}
                    onValueChange={(v) => void onAssign(ip.id, v)}
                  >
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Allocate" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned (pool)</SelectItem>
                      {sites.map((site) => (
                        <SelectItem key={`site:${site.id}`} value={`site:${site.id}`}>
                          site · {site.domain}
                        </SelectItem>
                      ))}
                      {apps.map((app) => (
                        <SelectItem key={`app:${app.id}`} value={`app:${app.id}`}>
                          app · {app.domain}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {ip.assignedTo ? <Badge variant="ok">bound</Badge> : <Badge>pool</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(ip)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sites.length === 0 && apps.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Create a <Link to="/sites" className="text-foreground underline">site</Link> or{" "}
          <Link to="/apps" className="text-foreground underline">Node app</Link> to allocate
          an address.
        </p>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add IP</DialogTitle>
            <DialogDescription>
              The address must already be configured on a NIC. Schela binds the vhost and the DNS
              A record; it does not talk to your cloud API.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ip">IPv4</Label>
              <Input
                id="ip"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="203.0.113.10"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="iplabel">Label (optional)</Label>
              <Input
                id="iplabel"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="failover / mail / extra"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={busy || !address.trim()}>
              {busy ? "Adding…" : "Add IP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {removing ? (
        <ConfirmDeleteDialog
          title={`Remove ${removing.address}?`}
          description={
            removing.assignedTo
              ? `${removing.assignedTo} moves back to the main address, and its DNS A records with it.`
              : "Nothing is bound to it."
          }
          confirmLabel="Remove IP"
          onConfirm={async () => {
            await deleteIp({ data: { id: removing.id } });
            toast.success(`Removed ${removing.address}`);
            await router.invalidate();
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
