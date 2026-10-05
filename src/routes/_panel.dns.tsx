import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus, Server } from "lucide-react";
import { useMemo, useState } from "react";
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
import {
  createDnsRecord,
  createDnsZone,
  deleteDnsRecord,
  listDns,
} from "@/lib/panel/server";
import { DNS_TYPES } from "@/lib/panel/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_panel/dns")({
  loader: () => listDns(),
  component: DnsPage,
});

function DnsPage() {
  const { zones, records } = Route.useLoaderData();
  const router = useRouter();
  const [zoneId, setZoneId] = useState<number | null>(zones[0]?.id ?? null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [type, setType] = useState("A");
  const [name, setName] = useState("@");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState("300");
  const [priority, setPriority] = useState("10");
  const [busy, setBusy] = useState(false);

  const activeZone = zones.find((z) => z.id === zoneId) ?? zones[0];
  const visible = useMemo(
    () => records.filter((r) => r.zoneId === (activeZone?.id ?? -1)),
    [records, activeZone],
  );

  async function onZone() {
    setBusy(true);
    try {
      const zone = await createDnsZone({ data: { name: zoneName } });
      setZoneOpen(false);
      setZoneName("");
      setZoneId(zone.id);
      await router.invalidate();
      toast.success("Zone added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add zone");
    } finally {
      setBusy(false);
    }
  }

  async function onRecord() {
    if (!activeZone) return;
    setBusy(true);
    try {
      await createDnsRecord({
        data: {
          zoneId: activeZone.id,
          type,
          name,
          value,
          ttl: Number(ttl) || 300,
          priority: type === "MX" ? Number(priority) || 10 : null,
        },
      });
      setRecOpen(false);
      setValue("");
      await router.invalidate();
      toast.success("Record added");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add record");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="DNS"
        title="Zones"
        description="Authoritative records for sites on this server. Nameservers ns1/ns2.schela.local."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setZoneOpen(true)}>
              New zone
            </Button>
            <Button onClick={() => setRecOpen(true)} disabled={!activeZone}>
              <Plus className="size-4" />
              Record
            </Button>
          </div>
        }
      />

      {zones.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Server className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No zones yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {zones.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => setZoneId(zone.id)}
                className={cn(
                  "h-11 rounded-lg px-4 text-sm font-medium transition-colors",
                  zone.id === activeZone?.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {zone.name}
              </button>
            ))}
          </div>
          {activeZone ? (
            <p className="mb-3 font-mono text-xs text-muted-foreground">
              serial {activeZone.serial}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-xl bg-card shadow-[var(--shadow-border)]">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Value</th>
                  <th className="px-5 py-3 font-medium">TTL</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((rec) => (
                  <tr key={rec.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <Badge variant="outline">{rec.type}</Badge>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">{rec.name}</td>
                    <td className="px-5 py-3 font-mono text-xs">
                      {rec.priority != null ? `${rec.priority} ` : null}
                      {rec.value}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs tabular">{rec.ttl}</td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void deleteDnsRecord({ data: { id: rec.id } }).then(() =>
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
        </>
      )}

      <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New zone</DialogTitle>
            <DialogDescription>Adds SOA, NS, and a placeholder A record.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="zone">Zone name</Label>
            <Input
              id="zone"
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              placeholder="studio.example"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setZoneOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onZone()} disabled={busy || !zoneName}>
              {busy ? "Adding…" : "Add zone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New record</DialogTitle>
            <DialogDescription>
              {activeZone ? activeZone.name : "Select a zone"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DNS_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ttl">TTL</Label>
                <Input id="ttl" value={ttl} onChange={(e) => setTtl(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rname">Name</Label>
              <Input id="rname" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rval">Value</Label>
              <Input id="rval" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            {type === "MX" ? (
              <div className="grid gap-2">
                <Label htmlFor="prio">Priority</Label>
                <Input
                  id="prio"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onRecord()} disabled={busy || !value}>
              {busy ? "Adding…" : "Add record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
