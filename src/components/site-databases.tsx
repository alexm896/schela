import { Link } from "@tanstack/react-router";
import { Database, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CredentialsDialog, NewDatabaseDialog } from "@/components/database-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getDatabases,
  type DatabasesOverview,
  type IssuedCredentials,
} from "@/lib/panel/databases-api";
import {
  ACCESS_LEVELS,
  DATABASE_ENGINES,
  enabledEngines,
  formatDatabaseSize,
  suggestDatabaseName,
} from "@/lib/panel/databases";

export function SiteDatabasesCard({ siteId, domain }: { siteId: number; domain: string }) {
  const [overview, setOverview] = useState<DatabasesOverview | null>(null);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await getDatabases());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load databases");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const databases = overview?.databases.filter((d) => d.siteId === siteId) ?? [];
  const canCreate = overview ? enabledEngines(overview.engines).length > 0 : false;

  return (
    <Card className="mt-3">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Databases</CardTitle>
        {canCreate ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            New database
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {overview === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : databases.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <Database className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {canCreate ? (
                "No databases linked to this site."
              ) : (
                <>
                  Turn on MariaDB or PostgreSQL in{" "}
                  <Link to="/modules" className="text-foreground underline-offset-4 hover:underline">
                    Modules
                  </Link>{" "}
                  to give this site a database.
                </>
              )}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {databases.map((db) => {
              const access = overview.users.flatMap((u) =>
                u.grants
                  .filter((g) => g.databaseId === db.id)
                  .map((g) => ({ key: u.name, label: `${u.name} · ${ACCESS_LEVELS[g.level].short}` })),
              );
              return (
                <li key={db.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-medium">{db.name}</p>
                    <span className="text-xs text-muted-foreground">
                      {DATABASE_ENGINES[db.engine].label}
                      {db.sizeBytes !== null ? ` · ${formatDatabaseSize(db.sizeBytes)}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {access.length ? (
                      access.map((a) => (
                        <Badge key={a.key} variant="outline" className="font-mono">
                          {a.label}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No users</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {databases.length > 0 ? (
          <Button asChild variant="ghost" size="sm" className="mt-2">
            <Link to="/databases">Manage users and access</Link>
          </Button>
        ) : null}
      </CardContent>

      {creating && overview ? (
        <NewDatabaseDialog
          overview={overview}
          defaults={{ siteId, name: suggestDatabaseName(domain) }}
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            void load();
            if (result) setIssued(result);
            else toast.success("Database created");
          }}
        />
      ) : null}
      {issued ? <CredentialsDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </Card>
  );
}
