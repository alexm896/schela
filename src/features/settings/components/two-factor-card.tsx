import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { authClient } from "@/auth/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${label}`),
    () => toast.error("Could not copy"),
  );
}

/** The base32 key inside an otpauth:// URI, for typing into an app by hand. */
function totpSecret(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

/** Opt-in TOTP for the admin login, with recovery codes. */
export function TwoFactorCard({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState<"enable" | "disable" | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor sign-in</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-3">
          <div>
            <p className="text-sm font-medium">Authenticator app code</p>
            <p className="text-xs text-muted-foreground">
              Asked after the password, with recovery codes for when the app is lost
            </p>
          </div>
          <Badge variant={enabled ? "ok" : "default"}>{enabled ? "On" : "Off"}</Badge>
        </div>
        <Button
          variant={enabled ? "outline" : "default"}
          className="w-fit"
          onClick={() => setOpen(enabled ? "disable" : "enable")}
        >
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      </CardContent>
      {open === "enable" ? (
        <TwoFactorEnableDialog onClose={() => setOpen(null)} onEnabled={() => void onChange()} />
      ) : null}
      {open === "disable" ? (
        <TwoFactorDisableDialog onClose={() => setOpen(null)} onDisabled={() => void onChange()} />
      ) : null}
    </Card>
  );
}

type EnableStep =
  | { kind: "password" }
  | { kind: "verify"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/**
 * Password, then the key for the app and a code from it to confirm, then the
 * recovery codes. Two-factor is on only once the code is confirmed; closing
 * earlier leaves it off.
 */
function TwoFactorEnableDialog({
  onClose,
  onEnabled,
}: {
  onClose: () => void;
  onEnabled: () => void;
}) {
  const [step, setStep] = useState<EnableStep>({ kind: "password" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    setPassword("");
    if (error || !data || !("totpURI" in data) || !data.totpURI || !data.backupCodes) {
      toast.error(error?.message || "Could not start two-factor setup");
      return;
    }
    setStep({ kind: "verify", totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== "verify") return;
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    setCode("");
    if (error) {
      toast.error(error.message || "Invalid code");
      return;
    }
    setStep({ kind: "codes", backupCodes: step.backupCodes });
    onEnabled();
  }

  const secret = step.kind === "verify" ? totpSecret(step.totpURI) : "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {step.kind === "password" ? (
          <form className="grid gap-4" onSubmit={(e) => void start(e)}>
            <DialogHeader>
              <DialogTitle>Turn on two-factor sign-in</DialogTitle>
              <DialogDescription>
                Confirm your password. You will need an authenticator app (any app that supports
                TOTP codes).
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="tf-enable-password">Password</Label>
              <Input
                id="tf-enable-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !password}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step.kind === "verify" ? (
          <form className="grid gap-4" onSubmit={(e) => void confirm(e)}>
            <DialogHeader>
              <DialogTitle>Add Schela to your authenticator app</DialogTitle>
              <DialogDescription>
                Enter this key in the app (time-based, 6 digits), or open the link on a device that
                has the app. Then type the code the app shows.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Key</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyText(secret, "key")}
                >
                  <Copy />
                  Copy
                </Button>
              </div>
              <p className="rounded-lg bg-secondary p-3 font-mono text-sm break-all select-all">
                {secret.match(/.{1,4}/g)?.join(" ")}
              </p>
              <a
                href={step.totpURI}
                className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Open in authenticator app
              </a>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tf-enable-code">Code from the app</Label>
              <Input
                id="tf-enable-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                spellCheck={false}
                className="font-mono"
                placeholder="123456"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !code.trim()}>
                Turn on
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step.kind === "codes" ? (
          <>
            <DialogHeader>
              <DialogTitle>Save your recovery codes</DialogTitle>
              <DialogDescription>
                Two-factor sign-in is on. If you lose the app, each of these codes signs you in once
                instead of a code. Schela shows them only now.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Recovery codes</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyText(step.backupCodes.join("\n"), "recovery codes")}
                >
                  <Copy />
                  Copy
                </Button>
              </div>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-secondary p-3 font-mono text-sm select-all">
                {step.backupCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>I saved them</Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorDisableDialog({
  onClose,
  onDisabled,
}: {
  onClose: () => void;
  onDisabled: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await authClient.twoFactor.disable({ password });
    setBusy(false);
    setPassword("");
    if (error) {
      toast.error(error.message || "Could not turn two-factor off");
      return;
    }
    toast.success("Two-factor sign-in is off");
    onDisabled();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>Turn off two-factor sign-in</DialogTitle>
            <DialogDescription>
              Confirm your password. Sign-in then asks for the password only, and the key and
              recovery codes stop working.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="tf-disable-password">Password</Label>
            <Input
              id="tf-disable-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !password}>
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
