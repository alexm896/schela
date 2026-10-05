import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Inbox, Mail, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  checkMailDns,
  createMailbox,
  deleteMailbox,
  getMailboxRemoval,
  listMailDns,
  listMailboxes,
  setMailboxPassword,
  toggleMailbox,
} from "@/features/mail/api";
import { MailDnsCard } from "@/features/mail/components/mail-dns-card";
import { MailboxCard } from "@/features/mail/components/mailbox-card";
import { MailboxPasswordDialog } from "@/features/mail/components/mailbox-password-dialog";
import { NewMailboxDialog, type NewMailboxDraft } from "@/features/mail/components/new-mailbox-dialog";
import type { DnsCheckResult } from "@/features/mail/dns-check";
import { notifyRemoved } from "@/lib/notify";

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
  const [draft, setDraft] = useState<NewMailboxDraft>({
    address: "",
    quota: "2048",
    password: "",
    confirm: "",
  });
  const [busy, setBusy] = useState(false);
  const [pwBox, setPwBox] = useState<{ id: number; address: string } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [checks, setChecks] = useState<Record<string, DnsCheckResult>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: number; address: string } | null>(null);

  async function onCreate() {
    if (draft.password !== draft.confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await createMailbox({
        data: { address: draft.address, quotaMb: Number(draft.quota) || 2048, password: draft.password },
      });
      toast.success("Mailbox created — IMAP password set, mail DNS written");
      setOpen(false);
      setDraft((d) => ({ ...d, address: "", password: "", confirm: "" }));
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
          {dns.map((zone) => (
            <MailDnsCard
              key={zone.domain}
              zone={zone}
              live={checks[zone.domain]}
              checking={checking === zone.domain}
              onCheck={() => void onCheck(zone.domain)}
            />
          ))}
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
          {boxes.map((box) => (
            <MailboxCard
              key={box.id}
              box={box}
              onSetPassword={() => {
                setPwBox({ id: box.id, address: box.address });
                setPwValue("");
              }}
              onToggle={(v) =>
                void toggleMailbox({
                  data: { id: box.id, status: v ? "active" : "disabled" },
                }).then(() => router.invalidate())
              }
              onRemove={() => setRemoving({ id: box.id, address: box.address })}
            />
          ))}
        </div>
      )}

      <NewMailboxDialog
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        busy={busy}
        onCreate={() => void onCreate()}
      />

      <MailboxPasswordDialog
        box={pwBox}
        value={pwValue}
        onChange={setPwValue}
        busy={busy}
        onClose={() => setPwBox(null)}
        onSave={() => void onSetPassword()}
      />

      {removing ? (
        <ConfirmDeleteDialog
          title={`Remove ${removing.address}?`}
          description="The mailbox stops receiving mail and can no longer sign in."
          confirmLabel="Remove mailbox"
          loadPlan={() => getMailboxRemoval({ data: { id: removing.id } })}
          onConfirm={async ({ remove }) => {
            const { warnings } = await deleteMailbox({ data: { id: removing.id, remove } });
            notifyRemoved(`Removed ${removing.address}`, warnings);
            await router.invalidate();
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
