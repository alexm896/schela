import { Button } from "@/components/ui/button";
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
import { generateMailboxPassword } from "../mail";

export type NewMailboxDraft = { address: string; quota: string; password: string; confirm: string };

export function NewMailboxDialog({
  open,
  onOpenChange,
  draft,
  onChange,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: NewMailboxDraft;
  onChange: (patch: Partial<NewMailboxDraft>) => void;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              value={draft.address}
              onChange={(e) => onChange({ address: e.target.value })}
              placeholder="hello@example.com"
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quota">Quota (MB)</Label>
            <Input
              id="quota"
              value={draft.quota}
              onChange={(e) => onChange({ quota: e.target.value })}
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
                  onChange({ password: next, confirm: next });
                }}
              >
                Generate
              </Button>
            </div>
            <Input
              id="pw"
              type="text"
              value={draft.password}
              onChange={(e) => onChange({ password: e.target.value })}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pw2">Confirm</Label>
            <Input
              id="pw2"
              type="text"
              value={draft.confirm}
              onChange={(e) => onChange({ confirm: e.target.value })}
              autoComplete="new-password"
              spellCheck={false}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onCreate}
            disabled={busy || !draft.address || draft.password.length < 8}
          >
            {busy ? "Creating…" : "Create mailbox"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
