import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { authClient } from "@/auth/client";
import { SchelaMark } from "@/components/layout/schela-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Second sign-in step, reached from /login when the admin has two-factor on.
 * The password step left only a short-lived signed two-factor cookie; a valid
 * authenticator or recovery code turns it into a session.
 */
export const Route = createFileRoute("/two-factor")({
  component: TwoFactorPage,
});

/** Errors after which this challenge is gone and the password is needed again. */
const RESTART_CODES = new Set(["INVALID_TWO_FACTOR_COOKIE", "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"]);

function TwoFactorPage() {
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    const { error } = recovery
      ? await authClient.twoFactor.verifyBackupCode({ code: value })
      : await authClient.twoFactor.verifyTotp({ code: value });
    if (!error) {
      toast.success("Welcome back");
      await navigate({ to: "/" });
      return;
    }
    setBusy(false);
    setCode("");
    if (error.code && RESTART_CODES.has(error.code)) {
      toast.error("This sign-in expired. Enter your password again.");
      await navigate({ to: "/login" });
      return;
    }
    toast.error(error.message || (recovery ? "Invalid recovery code" : "Invalid code"));
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <SchelaMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Schela</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Two-factor code</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {recovery
            ? "Enter one of your recovery codes. Each code works once."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
        <form className="mt-8 grid gap-4" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-2">
            <Label htmlFor="code">{recovery ? "Recovery code" : "Code"}</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode={recovery ? "text" : "numeric"}
              spellCheck={false}
              autoFocus
              className="font-mono"
              placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
            />
          </div>
          <Button type="submit" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Verify"}
          </Button>
        </form>
        <div className="mt-6 flex items-center justify-between text-sm">
          <button
            type="button"
            className="cursor-pointer text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => {
              setRecovery((r) => !r);
              setCode("");
            }}
          >
            {recovery ? "Use the authenticator app" : "Use a recovery code"}
          </button>
          <Link
            to="/login"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
