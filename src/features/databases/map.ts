import { iso, nullableNum, nullableText, num } from "@/server/rows";
import { isAccessLevel, type DatabaseEngine } from "./databases";
import type { DatabaseGrant, DatabaseUser, ManagedDatabase } from "./types";

function engine(value: unknown): DatabaseEngine {
  return value === "postgresql" ? "postgresql" : "mariadb";
}

export function mapDatabase(row: Record<string, unknown>): ManagedDatabase {
  return {
    id: num(row.id),
    engine: engine(row.engine),
    name: String(row.name),
    siteId: nullableNum(row.site_id),
    siteDomain: nullableText(row.site_domain),
    appId: nullableNum(row.app_id),
    appName: nullableText(row.app_name),
    createdAt: iso(row.created_at),
  };
}

/** `grants` are rows of database_grants joined with the database name. */
export function mapDatabaseUser(
  row: Record<string, unknown>,
  grants: Record<string, unknown>[],
): DatabaseUser {
  const id = num(row.id);
  return {
    id,
    engine: engine(row.engine),
    name: String(row.name),
    grants: grants
      .filter((g) => num(g.user_id) === id)
      .flatMap((g): DatabaseGrant[] =>
        isAccessLevel(g.level)
          ? [{ databaseId: num(g.database_id), databaseName: String(g.database_name), level: g.level }]
          : [],
      ),
    createdAt: iso(row.created_at),
  };
}
