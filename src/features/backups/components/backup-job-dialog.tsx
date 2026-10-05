import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CRON_PRESETS } from "@/features/cron/cron";
import { BACKUP_SCOPES } from "../backups";
import type { BackupForm } from "../form";

export function BackupJobDialog({
  open,
  onOpenChange,
  editing,
  form,
  onPatch,
  targets,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  form: BackupForm;
  onPatch: (patch: Partial<BackupForm>) => void;
  targets: { id: number; domain: string }[];
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit backup" : "New backup"}</DialogTitle>
          <DialogDescription>
            Local tar.gz is always written to /var/lib/schela/backups. Rsync and S3 are extra
            copies of that same file, run together.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bk-name">Name</Label>
            <Input
              id="bk-name"
              value={form.name}
              onChange={(e) => onPatch({ name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>What</Label>
              <Select value={form.scope} onValueChange={(v) => onPatch({ scope: v, targetId: "" })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKUP_SCOPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {targets.length > 0 ? (
              <div className="grid gap-2">
                <Label>Target</Label>
                <Select value={form.targetId} onValueChange={(v) => onPatch({ targetId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.domain}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label>Keep</Label>
                <Input
                  value={form.retain}
                  onChange={(e) => onPatch({ retain: e.target.value })}
                  inputMode="numeric"
                />
              </div>
            )}
          </div>
          {targets.length > 0 ? (
            <div className="grid gap-2">
              <Label>Keep copies</Label>
              <Input
                value={form.retain}
                onChange={(e) => onPatch({ retain: e.target.value })}
                inputMode="numeric"
              />
            </div>
          ) : null}
          {form.scope !== "mail" ? (
            <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-3">
              <p className="text-sm font-medium">Include mail store</p>
              <Switch
                checked={form.includeMail}
                onCheckedChange={(v) => onPatch({ includeMail: v })}
              />
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label>Schedule</Label>
            <Select value={form.schedule} onValueChange={(v) => onPatch({ schedule: v, custom: "" })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRON_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={form.custom}
              onChange={(e) => onPatch({ custom: e.target.value })}
              placeholder="or custom: 0 3 * * *"
              className="font-mono text-xs"
              spellCheck={false}
            />
          </div>

          <div className="rounded-lg bg-secondary px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Local disk</p>
              <Badge variant="ok">always</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              /var/lib/schela/backups — never skipped
            </p>
          </div>

          <div className="rounded-lg border border-border px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">rsync</p>
              <Switch
                checked={form.rsyncEnabled}
                onCheckedChange={(v) => onPatch({ rsyncEnabled: v })}
              />
            </div>
            {form.rsyncEnabled ? (
              <div className="mt-3 grid gap-3">
                <div className="grid gap-2">
                  <Label>Destination</Label>
                  <Input
                    value={form.rsyncDest}
                    onChange={(e) => onPatch({ rsyncDest: e.target.value })}
                    placeholder="user@offsite:/backups/schela"
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>SSH key (optional)</Label>
                  <Input
                    value={form.rsyncSshKey}
                    onChange={(e) => onPatch({ rsyncSshKey: e.target.value })}
                    placeholder="/var/lib/schela/backup_id_ed25519"
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border px-3 py-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">S3 / R2 / MinIO</p>
              <Switch
                checked={form.s3Enabled}
                onCheckedChange={(v) => onPatch({ s3Enabled: v })}
              />
            </div>
            {form.s3Enabled ? (
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Bucket</Label>
                    <Input
                      value={form.s3Bucket}
                      onChange={(e) => onPatch({ s3Bucket: e.target.value })}
                      spellCheck={false}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Region</Label>
                    <Input
                      value={form.s3Region}
                      onChange={(e) => onPatch({ s3Region: e.target.value })}
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Prefix</Label>
                  <Input
                    value={form.s3Prefix}
                    onChange={(e) => onPatch({ s3Prefix: e.target.value })}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Endpoint (blank = AWS)</Label>
                  <Input
                    value={form.s3Endpoint}
                    onChange={(e) => onPatch({ s3Endpoint: e.target.value })}
                    placeholder="https://<id>.r2.cloudflarestorage.com"
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Access key</Label>
                  <Input
                    value={form.s3AccessKey}
                    onChange={(e) => onPatch({ s3AccessKey: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Secret key{editing ? " (blank keeps current)" : ""}</Label>
                  <Input
                    type="password"
                    value={form.s3SecretKey}
                    onChange={(e) => onPatch({ s3SecretKey: e.target.value })}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={busy || !form.name.trim()}>
            {busy ? "Saving…" : "Save job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
