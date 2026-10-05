import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Database, KeyRound, MoreHorizontal, Plus, UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CredentialsDialog,
  DatabaseUserDialog,
  DeleteDatabaseDialog,
  DeleteDatabaseUserDialog,
  LinkDatabaseDialog,
  NewDatabaseDialog,
} from "@/components/database-dialogs";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getDatabases,
  resetDatabaseUserPassword,
  type DatabaseWithSize,
  type IssuedCredentials,
} from "@/lib/panel/databases-api";
import {
  ACCESS_LEVELS,
  DATABASE_ENGINES,
  enabledEngines,
  formatDatabaseSize,
} from "@/lib/panel/databases";
import type { DatabaseUser } from "@/lib/panel/types";

export const Route = createFileRoute("/_panel/databases")({
  loader: () => getDatabases(),
  component: DatabasesPage,
});

type Open =
  | { kind: "new-database" }
  | { kind: "link"; database: DatabaseWithSize }
  | { kind: "delete-database"; database: DatabaseWithSize }
  | { kind: "user"; user: DatabaseUser | null }
  | { kind: "delete-user"; user: DatabaseUser }
  | { kind: "credentials"; issued: IssuedCredentials }
  | null;

function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-card shadow-[var(--shadow-border)]">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className="px-5 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Database; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-card py-12 text-center shadow-[var(--shadow-border)]">
      <Icon className="size-6 text-muted-foreground" />
      <p className="mt-3 text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccessBadges({ items }: { items: { key: string; label: string }[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item.key} variant="outline" className="font-mono">
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function DatabasesPage() {
  const overview = Route.useLoaderData();
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const anyEnabled = enabledEngines(overview.engines).length > 0;

  async function finish(issued: IssuedCredentials | null, message: string) {
    await router.invalidate();
    if (issued) setOpen({ kind: "credentials", issued });
    else {
      setOpen(null);
      toast.success(message);
    }
  }

  async function resetPassword(user: DatabaseUser) {
    try {
      const issued = await resetDatabaseUserPassword({ data: { id: user.id } });
      setOpen({ kind: "credentials", issued });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the password");
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Hosting"
        title="Databases"
        description="MariaDB and PostgreSQL on this server, reachable from 127.0.0.1. Passwords are shown once and stored only as hashes."
        action={
          anyEnabled ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen({ kind: "user", user: null })}>
                <UserPlus />
                New user
              </Button>
              <Button onClick={() => setOpen({ kind: "new-database" })}>
                <Plus />
                New database
              </Button>
            </div>
          ) : null
        }
      />

      <Tabs defaultValue="databases">
        <TabsList>
          <TabsTrigger value="databases">
            Databases
            <span className="ml-1.5 tabular text-muted-foreground">{overview.databases.length}</span>
          </TabsTrigger>
          <TabsTrigger value="users">
            Users
            <span className="ml-1.5 tabular text-muted-foreground">{overview.users.length}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="databases">
          {overview.databases.length === 0 ? (
            <EmptyState
              icon={Database}
              text={anyEnabled ? "No databases yet." : "Turn on MariaDB or PostgreSQL in Modules to create databases."}
            />
          ) : (
            <DataTable head={["Name", "Engine", "Size", "Belongs to", "Users", ""]}>
              {overview.databases.map((db) => {
                const access = overview.users.flatMap((u) =>
                  u.grants
                    .filter((g) => g.databaseId === db.id)
                    .map((g) => ({ key: u.name, label: `${u.name} · ${ACCESS_LEVELS[g.level].short}` })),
                );
                return (
                  <tr key={db.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-mono text-xs font-medium">{db.name}</td>
                    <td className="px-5 py-3 text-muted-foreground">{DATABASE_ENGINES[db.engine].label}</td>
                    <td className="tabular px-5 py-3 text-muted-foreground">
                      {db.sizeBytes === null ? "" : formatDatabaseSize(db.sizeBytes)}
                    </td>
                    <td className="px-5 py-3">
                      {db.siteId && db.siteDomain ? (
                        <Link
                          to="/sites/$id"
                          params={{ id: String(db.siteId) }}
                          className="underline-offset-4 hover:underline"
                        >
                          {db.siteDomain}
                        </Link>
                      ) : db.appName ? (
                        db.appName
                      ) : (
                        <span className="text-muted-foreground">Not linked</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <AccessBadges items={access} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RowMenu label={`Actions for ${db.name}`}>
                        <DropdownMenuItem onSelect={() => setOpen({ kind: "link", database: db })}>
                          Change site or app
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setOpen({ kind: "delete-database", database: db })}
                        >
                          Delete database
                        </DropdownMenuItem>
                      </RowMenu>
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </TabsContent>

        <TabsContent value="users">
          {overview.users.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              text={anyEnabled ? "No users yet." : "Turn on MariaDB or PostgreSQL in Modules to create users."}
            />
          ) : (
            <DataTable head={["Name", "Engine", "Access", ""]}>
              {overview.users.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-mono text-xs font-medium">{user.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{DATABASE_ENGINES[user.engine].label}</td>
                  <td className="px-5 py-3">
                    <AccessBadges
                      items={user.grants.map((g) => ({
                        key: String(g.databaseId),
                        label: `${g.databaseName} · ${ACCESS_LEVELS[g.level].short}`,
                      }))}
                    />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    <Button variant="outline" size="sm" onClick={() => setOpen({ kind: "user", user })}>
                      Edit access
                    </Button>
                    <RowMenu label={`Actions for ${user.name}`}>
                      <DropdownMenuItem onSelect={() => void resetPassword(user)}>Reset password</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setOpen({ kind: "delete-user", user })}>
                        Delete user
                      </DropdownMenuItem>
                    </RowMenu>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </TabsContent>
      </Tabs>

      {open?.kind === "new-database" ? (
        <NewDatabaseDialog
          overview={overview}
          defaults={{}}
          onClose={() => setOpen(null)}
          onCreated={(issued) => void finish(issued, "Database created")}
        />
      ) : null}
      {open?.kind === "link" ? (
        <LinkDatabaseDialog
          overview={overview}
          database={open.database}
          onClose={() => setOpen(null)}
          onSaved={() => void finish(null, "Saved")}
        />
      ) : null}
      {open?.kind === "delete-database" ? (
        <DeleteDatabaseDialog
          database={open.database}
          onClose={() => setOpen(null)}
          onDeleted={() => void finish(null, `Deleted ${open.database.name}`)}
        />
      ) : null}
      {open?.kind === "user" ? (
        <DatabaseUserDialog
          overview={overview}
          user={open.user}
          onClose={() => setOpen(null)}
          onSaved={(issued) => void finish(issued, "Access saved")}
        />
      ) : null}
      {open?.kind === "delete-user" ? (
        <DeleteDatabaseUserDialog
          user={open.user}
          onClose={() => setOpen(null)}
          onDeleted={() => void finish(null, `Deleted user ${open.user.name}`)}
        />
      ) : null}
      {open?.kind === "credentials" ? (
        <CredentialsDialog issued={open.issued} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
