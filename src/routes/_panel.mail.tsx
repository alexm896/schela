import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ExternalLink, Inbox, KeyRound, Mail, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import type { DnsCheckResult } from "@/lib/panel/dns-check";
import { generateMailboxPassword } from "@/lib/panel/net";
import {
  checkMailDns,
  createMailbox,
  deleteMailbox,
  listMailDns,
  listMailboxes,
  setMailboxPassword,
  toggleMailbox,
} from "@/lib/panel/server";
import { formatBytes } from "@/lib/utils";

export const Route = createFileRoute("/_panel/mail")({
  loader: async () => {
    const [boxes, dns] = await Promise.all([listMailboxes(), listMailDns()]);
    return { boxes, dns };
  },
  component: MailPage,
});

function MailPage() {
  const { boxes, dns } = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [quota, setQuota] = useState("2048");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwBox, setPwBox] = useState<{ id: number; address: string } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [checks, setChecks] = useState<Record<string, DnsCheckResult>>({});
  const [checking, setChecking] = useState<string | null>(null);

  async function onCreate() {
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await createMailbox({
        data: { address, quotaMb: Number(quota) || 2048, password },
      });
      toast.success("Mailbox created — IMAP password set, mail DNS written");
      setOpen(false);
      setAddress("");
      setPassword("");
      setConfirm("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create mailbox");
    } finally {
      setBusy(false);
    }
  }

  async function onSetPassword() {
    if (!pwBox) return;
    setBusy(true);
    try {
      await setMailboxPassword({ data: { id: pwBox.id, password: pwValue } });
      toast.success(`Password updated for ${pwBox.address}`);
      setPwBox(null);
      setPwValue("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not set password");
    } finally {
      setBusy(false);
    }
  }

  async function onCheck(domain: string) {
    setChecking(domain);
    try {
      const result = await checkMailDns({ data: { domain } });
      setChecks((prev) => ({ ...prev, [domain]: result }));
      if (result.ok) toast.success(`${domain} — public DNS matches`);
      else toast.message(`${domain} — some records are missing on the public internet`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "DNS check failed");
    } finally {
      setChecking(null);
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Mail"
        title="Mailboxes"
        description="Each mailbox needs a password. Creating one writes MX, SPF, DKIM, and DMARC. Check live DNS against Cloudflare’s resolver."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/webmail">
                <Inbox className="size-4" />
                Webmail
              </Link>
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" />
              New mailbox
            </Button>
          </div>
        }
      />

      {dns.length > 0 ? (
        <div className="mb-6 grid gap-3">
          {dns.map((zone) => {
            const live = checks[zone.domain];
            return (
              <Card key={zone.domain}>
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
                        disabled={checking === zone.domain}
                        onClick={() => void onCheck(zone.domain)}
                      >
                        <ShieldCheck className="size-4" />
                        {checking === zone.domain ? "Checking…" : "Check live DNS"}
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
          })}
        </div>
      ) : (
        <Card className="mb-6">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Add a mailbox and Schela will detect the domain, then write the mail DNS records
            automatically.
          </CardContent>
        </Card>
      )}

      {boxes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Mail className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">No mailboxes yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {boxes.map((box) => {
            const used = Math.min(100, Math.round((box.usedMb / box.quotaMb) * 100));
            return (
              <Card key={box.id}>
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{box.address}</p>
                      <Badge variant={box.status === "active" ? "ok" : "default"}>
                        {box.status}
                      </Badge>
                      <Badge variant={box.hasPassword ? "ok" : "warn"}>
                        {box.hasPassword ? "password set" : "no password"}
                      </Badge>
                    </div>
                    <div className="mt-2 max-w-sm">
                      <Progress value={used} />
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {formatBytes(box.usedMb)} of {formatBytes(box.quotaMb)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to="/webmail" search={{ address: box.address }}>
                        <Inbox className="size-4" />
                        Webmail
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPwBox({ id: box.id, address: box.address });
                        setPwValue("");
                      }}
                    >
                      <KeyRound className="size-4" />
                      {box.hasPassword ? "Reset password" : "Set password"}
                    </Button>
                    <Switch
                      checked={box.status === "active"}
                      onCheckedChange={(v) =>
                        void toggleMailbox({
                          data: { id: box.id, status: v ? "active" : "disabled" },
                        }).then(() => router.invalidate())
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void deleteMailbox({ data: { id: box.id } }).then(() =>
                          router.invalidate(),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New mailbox</DialogTitle>
            <DialogDescription>
              Sets the IMAP/SMTP password and writes MX, A, SPF, DKIM, and DMARC.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="addr">Address</Label>
              <Input
                id="addr"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="hello@example.com"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quota">Quota (MB)</Label>
              <Input
                id="quota"
                value={quota}
                onChange={(e) => setQuota(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="pw">Password</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const next = generateMailboxPassword();
                    setPassword(next);
                    setConfirm(next);
                  }}
                >
                  Generate
                </Button>
              </div>
              <Input
                id="pw"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pw2">Confirm</Label>
              <Input
                id="pw2"
                type="text"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void onCreate()}
              disabled={busy || !address || password.length < 8}
            >
              {busy ? "Creating…" : "Create mailbox"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pwBox)} onOpenChange={(o) => !o && setPwBox(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password for {pwBox?.address}</DialogTitle>
            <DialogDescription>
              Stored as a Dovecot hash. The panel never shows the current password.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="reset-pw">New password</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPwValue(generateMailboxPassword())}
              >
                Generate
              </Button>
            </div>
            <Input
              id="reset-pw"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPwBox(null)}>
              Cancel
            </Button>
            <Button onClick={() => void onSetPassword()} disabled={busy || pwValue.length < 8}>
              Save password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
