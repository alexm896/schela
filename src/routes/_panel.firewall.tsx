import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus, Shield } from "lucide-react";
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
import {
  createFirewallRule,
  deleteFirewallRule,
  listFirewall,
  toggleFirewallRule,
} from "@/lib/panel/server";

export const Route = createFileRoute("/_panel/firewall")({
  loader: () => listFirewall(),
  component: FirewallPage,
});

function FirewallPage() {
  const rules = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"allow" | "deny">("allow");
  const [protocol, setProtocol] = useState<"tcp" | "udp" | "any">("tcp");
  const [port, setPort] = useState("");
  const [source, setSource] = useState("any");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const openCount = rules.filter((r) => r.enabled && r.action === "allow").length;

  async function onCreate() {
    setBusy(true);
    try {
      await createFirewallRule({
        data: { action, protocol, port, source, comment },
      });
      toast.success("Rule added");
      setOpen(false);
      setPort("");
      setComment("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add rule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Security"
        title="Firewall"
        description="Inbound traffic is denied by default. Only listed ports answer. Fail2ban watches SSH and the panel."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Add rule
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Policy</p>
            <p className="mt-1 text-lg font-medium">Deny inbound</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">Open services</p>
            <p className="mt-1 font-mono text-lg tabular">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-5">
            <Shield className="size-4 text-ok" />
            <div>
              <p className="text-sm font-medium">Fail2ban</p>
              <p className="text-xs text-muted-foreground">sshd · nginx-auth</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto rounded-xl bg-card shadow-[var(--shadow-border)]">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Port</th>
              <th className="px-5 py-3 font-medium">Source</th>
              <th className="px-5 py-3 font-medium">Note</th>
              <th className="px-5 py-3 font-medium">On</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <Badge variant={rule.action === "allow" ? "ok" : "danger"}>
                    {rule.action}
                  </Badge>
                </td>
                <td className="px-5 py-3 font-mono text-xs">
                  {rule.protocol}/{rule.port}
                </td>
                <td className="px-5 py-3 font-mono text-xs">{rule.source}</td>
                <td className="px-5 py-3 text-muted-foreground">{rule.comment}</td>
                <td className="px-5 py-3">
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(v) =>
                      void toggleFirewallRule({ data: { id: rule.id, enabled: v } }).then(
                        () => router.invalidate(),
                      )
                    }
                  />
                </td>
                <td className="px-5 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void deleteFirewallRule({ data: { id: rule.id } }).then(() =>
                        router.invalidate(),
                      )
                    }
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firewall rule</DialogTitle>
            <DialogDescription>Inbound only. Default policy stays deny.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Action</Label>
                <Select value={action} onValueChange={(v) => setAction(v as "allow" | "deny")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allow">allow</SelectItem>
                    <SelectItem value="deny">deny</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Protocol</Label>
                <Select
                  value={protocol}
                  onValueChange={(v) => setProtocol(v as "tcp" | "udp" | "any")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">tcp</SelectItem>
                    <SelectItem value="udp">udp</SelectItem>
                    <SelectItem value="any">any</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fw-port">Port</Label>
              <Input
                id="fw-port"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="8080"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fw-source">Source</Label>
              <Input
                id="fw-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="fw-note">Note</Label>
              <Input
                id="fw-note"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onCreate()} disabled={busy || !port}>
              {busy ? "Adding…" : "Add rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
