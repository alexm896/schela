import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { runSudoHelper } from "@/server/sudo-helper";
import { DATABASE_ENGINES } from "./databases";
import { mapDatabase } from "./map";
import type { ManagedDatabase } from "./types";

// Database operations shared by the Databases page and by removing a site or
// app together with its databases.

const HELPER = "/usr/local/sbin/schela-db";

export async function runDatabaseHelper(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  return runSudoHelper(HELPER, req, { label: "Database command", timeoutMs: 60_000 });
}

export async function databasesOwnedBy(
  sql: Sql,
  owner: { siteId: number } | { appId: number },
): Promise<ManagedDatabase[]> {
  const rows =
    "siteId" in owner
      ? await sql<Record<string, unknown>>`select * from databases where site_id = ${owner.siteId} order by name`
      : await sql<Record<string, unknown>>`select * from databases where app_id = ${owner.appId} order by name`;
  return rows.map(mapDatabase);
}

/** Drops the database on the server, then forgets it. Does not apply. */
export async function dropDatabase(sql: Sql, db: ManagedDatabase): Promise<void> {
  // Server first: if the drop fails the row stays and nothing is lost.
  if (isVpsApply()) await runDatabaseHelper({ op: "drop-database", engine: db.engine, name: db.name });
  await sql`delete from databases where id = ${db.id}`;
  await logActivity(sql, "database", `Deleted ${DATABASE_ENGINES[db.engine].label} database ${db.name}`);
}
