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

export function MailboxPasswordDialog({
  box,
  value,
  onChange,
  busy,
  onClose,
  onSave,
}: {
  box: { id: number; address: string } | null;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={Boolean(box)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Password for {box?.address}</DialogTitle>
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
              onClick={() => onChange(generateMailboxPassword())}
            >
              Generate
            </Button>
          </div>
          <Input
            id="reset-pw"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={busy || value.length < 8}>
            Save password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
