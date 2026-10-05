import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SchelaMark } from "@/components/layout/schela-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { webmailLogin, webmailWhoami } from "@/lib/webmail/server";

export const Route = createFileRoute("/webmail/")({
  validateSearch: (raw: Record<string, unknown>): { address?: string } => {
    const address = typeof raw.address === "string" && raw.address ? raw.address : undefined;
    return address ? { address } : {};
  },
  loader: async () => {
    const who = await webmailWhoami();
    if (who?.address) throw redirect({ to: "/webmail/inbox" });
    return null;
  },
  component: WebmailLogin,
});

function WebmailLogin() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [address, setAddress] = useState(search.address ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await webmailLogin({ data: { address, password } });
      toast.success("Signed in");
      await navigate({ to: "/webmail/inbox" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <SchelaMark className="size-8" />
          <span className="text-lg font-semibold tracking-tight">Schela webmail</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Mailbox sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the mailbox address and password. The session is an encrypted HttpOnly cookie
          (8 hours). From is locked to this address.
        </p>
        <form className="mt-6 grid gap-4" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-2">
            <Label htmlFor="wm-addr">Address</Label>
            <Input
              id="wm-addr"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              spellCheck={false}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="wm-pw">Password</Label>
            <Input
              id="wm-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" disabled={busy || !address.includes("@") || password.length < 8}>
            {busy ? "Signing in…" : "Open inbox"}
          </Button>
        </form>
      </div>
    </main>
  );
}
