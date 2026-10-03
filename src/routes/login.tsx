import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SchelaMark } from "@/components/schela-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";
import { loginEmails } from "@/lib/panel/admin-id";
import { adminStatus, getLoginInfo } from "@/lib/panel/server";

export const Route = createFileRoute("/login")({
  loader: async () => {
    const [status, info] = await Promise.all([adminStatus(), getLoginInfo()]);
    return { ...status, hostname: info.hostname };
  },
  component: LoginPage,
});

function LoginPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const firstRun = !data.hasAdmin;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const candidates = loginEmails(username, data.hostname);
    if (candidates.length === 0 || password.length < 8) {
      toast.error("Username admin and a password of 8+ characters.");
      return;
    }
    setBusy(true);
    try {
      if (firstRun) {
        const { error } = await authClient.signUp.email({
          email: candidates[0],
          password,
          name: "Admin",
          callbackURL: "/",
        });
        if (error) throw new Error(error.message || "Could not create admin");
      } else {
        let last = "Wrong username or password";
        let ok = false;
        for (const email of candidates) {
          const { error } = await authClient.signIn.email({
            email,
            password,
            callbackURL: "/",
          });
          if (!error) {
            ok = true;
            break;
          }
          last = error.message || last;
        }
        if (!ok) throw new Error(last);
      }
      toast.success(firstRun ? "Admin account created" : "Welcome back");
      await navigate({ to: "/" });
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
          <span className="text-lg font-semibold tracking-tight">Schela</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {firstRun
            ? "First login. Username is admin — set a password of 8+ characters."
            : `Panel on ${data.hostname}`}
        </p>
        <form className="mt-8 grid gap-4" onSubmit={(e) => void onSubmit(e)}>
          <div className="grid gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              placeholder="admin"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={firstRun ? "new-password" : "current-password"}
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
