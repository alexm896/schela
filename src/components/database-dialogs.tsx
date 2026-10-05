import { Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  createDatabase,
  createDatabaseUser,
  deleteDatabase,
  deleteDatabaseUser,
  updateDatabase,
  updateDatabaseUser,
  type DatabasesOverview,
  type DatabaseWithSize,
  type IssuedCredentials,
} from "@/lib/panel/databases-api";
import {
  ACCESS_LEVELS,
  ACCESS_LEVEL_KEYS,
  DATABASE_ENGINES,
  connectionUrl,
  enabledEngines,
  laravelEnv,
  normalizeDatabaseName,
  type AccessLevel,
  type DatabaseEngine,
} from "@/lib/panel/databases";
import type { DatabaseUser } from "@/lib/panel/types";

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function nameError(engine: DatabaseEngine, value: string, kind: "database" | "user") {
  if (!value.trim()) return "";
  try {
    normalizeDatabaseName(engine, value, kind);
    return "";
  } catch (err) {
    return errorText(err, "Invalid name");
  }
}

function copyText(text: string, label: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${label}`),
    () => toast.error("Could not copy"),
  );
}

/** "none", "site:3" or "app:5" in the link select. */
type LinkValue = string;

function linkValue(siteId: number | null, appId: number | null): LinkValue {
  if (siteId) return `site:${siteId}`;
  if (appId) return `app:${appId}`;
  return "none";
}

function parseLink(value: LinkValue): { siteId: number | null; appId: number | null } {
  const [kind, id] = value.split(":");
  return {
    siteId: kind === "site" ? Number(id) : null,
    appId: kind === "app" ? Number(id) : null,
  };
}

function LinkSelect({
  overview,
  value,
  onChange,
}: {
  overview: DatabasesOverview;
  value: LinkValue;
  onChange: (value: LinkValue) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id="database-link">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Not linked</SelectItem>
        {overview.sites.map((site) => (
          <SelectItem key={`site:${site.id}`} value={`site:${site.id}`}>
            Site · {site.domain}
          </SelectItem>
        ))}
        {overview.apps.map((app) => (
          <SelectItem key={`app:${app.id}`} value={`app:${app.id}`}>
            Node app · {app.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EngineSelect({
  engines,
  value,
  onChange,
}: {
  engines: DatabaseEngine[];
  value: DatabaseEngine;
  onChange: (engine: DatabaseEngine) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DatabaseEngine)}>
      <SelectTrigger id="database-engine">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {engines.map((engine) => (
          <SelectItem key={engine} value={engine}>
            {DATABASE_ENGINES[engine].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export type NewDatabaseDefaults = {
  name?: string;
  siteId?: number | null;
  appId?: number | null;
};

export function NewDatabaseDialog({
  overview,
  defaults,
  onClose,
  onCreated,
}: {
  overview: DatabasesOverview;
  defaults: NewDatabaseDefaults;
  onClose: () => void;
  onCreated: (issued: IssuedCredentials | null) => void;
}) {
  const engines = enabledEngines(overview.engines);
  const [engine, setEngine] = useState<DatabaseEngine>(engines[0] ?? "mariadb");
  const [name, setName] = useState(defaults.name ?? "");
  const [link, setLink] = useState<LinkValue>(linkValue(defaults.siteId ?? null, defaults.appId ?? null));
  const [withUser, setWithUser] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The user name follows the database name until it is edited.
  const effectiveUser = userName ?? name;
  const dbError = nameError(engine, name, "database");
  const userError = withUser ? nameError(engine, effectiveUser, "user") : "";

  async function submit() {
    setBusy(true);
    try {
      const issued = await createDatabase({
        data: {
          engine,
          name,
          ...parseLink(link),
          userName: withUser ? effectiveUser : null,
        },
      });
      onCreated(issued);
    } catch (err) {
      toast.error(errorText(err, "Could not create the database"));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New database</DialogTitle>
          <DialogDescription>
            Reachable from this server only, on 127.0.0.1. The password is shown once, right after
            you create it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="database-engine">Engine</Label>
              <EngineSelect engines={engines} value={engine} onChange={setEngine} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="database-name">Name</Label>
              <Input
                id="database-name"
                value={name}
                maxLength={32}
                onChange={(e) => setName(e.target.value)}
                placeholder="shop"
                className="font-mono text-sm"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={dbError ? true : undefined}
              />
            </div>
          </div>
          {dbError ? <p className="-mt-2 text-xs text-destructive">{dbError}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="database-link">Belongs to</Label>
            <LinkSelect overview={overview} value={link} onChange={setLink} />
            <p className="text-xs text-muted-foreground">
              Shown on the site page. Deleting the site keeps the database.
            </p>
          </div>
          <div className="grid gap-3 rounded-lg bg-secondary p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Create a user for it</p>
                <p className="text-xs text-muted-foreground">With full access, for the app and its migrations.</p>
              </div>
              <Switch checked={withUser} onCheckedChange={setWithUser} aria-label="Create a user for it" />
            </div>
            {withUser ? (
              <div className="grid gap-2">
                <Label htmlFor="database-user">User name</Label>
                <Input
                  id="database-user"
                  value={effectiveUser}
                  maxLength={32}
                  onChange={(e) => setUserName(e.target.value)}
                  className="font-mono text-sm"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={userError ? true : undefined}
                />
                {userError ? <p className="text-xs text-destructive">{userError}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !name.trim() || Boolean(dbError) || (withUser && (!effectiveUser.trim() || Boolean(userError)))}
          >
            {busy ? "Creating…" : "Create database"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LinkDatabaseDialog({
  overview,
  database,
  onClose,
  onSaved,
}: {
  overview: DatabasesOverview;
  database: DatabaseWithSize;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [link, setLink] = useState<LinkValue>(linkValue(database.siteId, database.appId));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await updateDatabase({ data: { id: database.id, ...parseLink(link) } });
      onSaved();
    } catch (err) {
      toast.error(errorText(err, "Could not save"));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link {database.name}</DialogTitle>
          <DialogDescription>Choose the site or Node app this database belongs to.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="database-link">Belongs to</Label>
          <LinkSelect overview={overview} value={link} onChange={setLink} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const NO_ACCESS = "none";

/** Create a user (user === null) or change an existing user's access. */
export function DatabaseUserDialog({
  overview,
  user,
  onClose,
  onSaved,
}: {
  overview: DatabasesOverview;
  user: DatabaseUser | null;
  onClose: () => void;
  onSaved: (issued: IssuedCredentials | null) => void;
}) {
  const engines = enabledEngines(overview.engines);
  const [engine, setEngine] = useState<DatabaseEngine>(user?.engine ?? engines[0] ?? "mariadb");
  const [name, setName] = useState(user?.name ?? "");
  const [levels, setLevels] = useState<Record<number, AccessLevel>>(() =>
    Object.fromEntries((user?.grants ?? []).map((g) => [g.databaseId, g.level])),
  );
  const [busy, setBusy] = useState(false);
  const databases = overview.databases.filter((d) => d.engine === engine);
  const error = user ? "" : nameError(engine, name, "user");

  async function submit() {
    const grants = databases
      .filter((d) => levels[d.id])
      .map((d) => ({ databaseId: d.id, level: levels[d.id] }));
    setBusy(true);
    try {
      if (user) {
        await updateDatabaseUser({ data: { id: user.id, grants } });
        onSaved(null);
      } else {
        onSaved(await createDatabaseUser({ data: { engine, name, grants } }));
      }
    } catch (err) {
      toast.error(errorText(err, "Could not save the user"));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? `Access for ${user.name}` : "New database user"}</DialogTitle>
          <DialogDescription>
            {user
              ? "Changes apply to new connections; open sessions keep their old rights until they reconnect."
              : "A login for apps or people. The password is shown once, right after you create it."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {user ? null : (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="database-engine">Engine</Label>
                <EngineSelect
                  engines={engines}
                  value={engine}
                  onChange={(next) => {
                    setEngine(next);
                    setLevels({});
                  }}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="database-user-name">Name</Label>
                <Input
                  id="database-user-name"
                  value={name}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="reporting"
                  className="font-mono text-sm"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                />
              </div>
            </div>
          )}
          {error ? <p className="-mt-2 text-xs text-destructive">{error}</p> : null}
          <div className="grid gap-2">
            <Label>Access</Label>
            {databases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {DATABASE_ENGINES[engine].label} databases yet. Create one first, or save the user
                now and give it access later.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg shadow-[var(--shadow-border)]">
                {databases.map((db) => (
                  <li key={db.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate font-mono text-sm">{db.name}</span>
                    <Select
                      value={levels[db.id] ?? NO_ACCESS}
                      onValueChange={(v) =>
                        setLevels((prev) => {
                          const next = { ...prev };
                          if (v === NO_ACCESS) delete next[db.id];
                          else next[db.id] = v as AccessLevel;
                          return next;
                        })
                      }
                    >
                      <SelectTrigger className="w-44" aria-label={`Access to ${db.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ACCESS}>No access</SelectItem>
                        {ACCESS_LEVEL_KEYS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {ACCESS_LEVELS[level].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {ACCESS_LEVEL_KEYS.map((level) => (
                <li key={level}>
                  <span className="font-medium text-foreground">{ACCESS_LEVELS[level].label}:</span>{" "}
                  {ACCESS_LEVELS[level].description}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || (!user && (!name.trim() || Boolean(error)))}
          >
            {busy ? "Saving…" : user ? "Save access" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate font-mono text-sm ${secret ? "select-all" : ""}`}>{value}</span>
      <Button variant="ghost" size="icon-sm" onClick={() => copyText(value, label.toLowerCase())} aria-label={`Copy ${label}`}>
        <Copy />
      </Button>
    </div>
  );
}

/** The one time a password is visible. */
export function CredentialsDialog({ issued, onClose }: { issued: IssuedCredentials; onClose: () => void }) {
  const c = issued.credentials;
  const env = laravelEnv(c);
  const url = connectionUrl(c);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Credentials for {c.user}</DialogTitle>
          <DialogDescription>
            Copy the password now. Schela keeps only a hash and cannot show it again; use Reset
            password if it gets lost.
          </DialogDescription>
        </DialogHeader>
        {issued.applyError ? (
          <div className="flex gap-2 rounded-lg bg-warn/15 p-3 text-sm text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Saved in the panel, but applying it on the server failed: {issued.applyError}. The
              password stays valid once the next apply succeeds.
            </p>
          </div>
        ) : null}
        <div className="divide-y divide-border rounded-lg shadow-[var(--shadow-border)]">
          <CopyRow label="Host" value={c.host} />
          <CopyRow label="Port" value={String(c.port)} />
          {c.database ? <CopyRow label="Database" value={c.database} /> : null}
          <CopyRow label="User" value={c.user} />
          <CopyRow label="Password" value={c.password} secret />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Laravel .env</Label>
            <Button variant="ghost" size="sm" onClick={() => copyText(env, ".env block")}>
              <Copy />
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs leading-relaxed">{env}</pre>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Connection URL</Label>
            <Button variant="ghost" size="sm" onClick={() => copyText(url, "URL")}>
              <Copy />
              Copy
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-xs">{url}</pre>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDatabaseDialog({
  database,
  onClose,
  onDeleted,
}: {
  database: DatabaseWithSize;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await deleteDatabase({ data: { id: database.id, confirm } });
      onDeleted();
    } catch (err) {
      toast.error(errorText(err, "Could not delete the database"));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {database.name}?</DialogTitle>
          <DialogDescription>
            The database and all its data are removed from the server. Users stay but lose access to
            it. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="database-confirm">
            Type <span className="font-mono text-foreground">{database.name}</span> to confirm
          </Label>
          <Input
            id="database-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy || confirm !== database.name} onClick={() => void submit()}>
            {busy ? "Deleting…" : "Delete database"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDatabaseUserDialog({
  user,
  onClose,
  onDeleted,
}: {
  user: DatabaseUser;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await deleteDatabaseUser({ data: { id: user.id } });
      onDeleted();
    } catch (err) {
      toast.error(errorText(err, "Could not delete the user"));
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user {user.name}?</DialogTitle>
          <DialogDescription>
            Apps that log in as {user.name} stop working. The databases and their data stay.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void submit()}>
            {busy ? "Deleting…" : "Delete user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
