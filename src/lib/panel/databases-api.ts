import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { getSql, type Sql } from "@/server/db";
import { logActivity } from "@/server/activity";
import { applyAfterChange } from "@/server/apply";
import { isVpsApply } from "@/server/env";
import {
  DATABASE_ENGINES,
  DATABASE_ENGINE_KEYS,
  normalizeDatabaseName,
  normalizeGrants,
  type DatabaseCredentials,
  type DatabaseEngine,
  type GrantInput,
} from "./databases";
import { databasePasswordHash, generateDatabasePassword } from "./db-pass";
import { mapDatabase, mapDatabaseUser } from "./map";
import { runSudoHelper } from "@/server/sudo-helper";
import type { DatabaseUser, ManagedDatabase } from "./types";

const HELPER = "/usr/local/sbin/schela-db";

export type DatabaseEngineStatus = {
  engine: DatabaseEngine;
  /** Module switch in the panel. */
  enabled: boolean;
};

export type DatabaseWithSize = ManagedDatabase & { sizeBytes: number | null };

export type DatabasesOverview = {
  engines: DatabaseEngineStatus[];
  databases: DatabaseWithSize[];
  users: DatabaseUser[];
  sites: { id: number; domain: string }[];
  apps: { id: number; name: string }[];
};

/** Returned once, right after a password is created. Never stored. */
export type IssuedCredentials = {
  credentials: DatabaseCredentials;
  /** Set when the rows were saved but applying them on the server failed. */
  applyError: string | null;
};

type EngineInfo = { sizes?: unknown };

async function runHelper(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  return runSudoHelper(HELPER, req, { label: "Database command", timeoutMs: 60_000 });
}

async function readServerInfo(): Promise<Partial<Record<DatabaseEngine, EngineInfo>>> {
  if (!isVpsApply()) return {};
  try {
    const out = await runHelper({ op: "info" });
    return (out.engines ?? {}) as Partial<Record<DatabaseEngine, EngineInfo>>;
  } catch (err) {
    console.error("[schela] database info:", err);
    return {};
  }
}

async function enabledEngines(sql: Sql): Promise<Set<DatabaseEngine>> {
  const rows = await sql<{ slug: string }>`
    select slug from modules where enabled = true and slug in ('mariadb', 'postgresql')
  `;
  return new Set(rows.map((r) => r.slug as DatabaseEngine));
}

async function assertEngineEnabled(sql: Sql, engine: DatabaseEngine) {
  if (!(await enabledEngines(sql)).has(engine)) {
    throw new Error(`Turn on ${DATABASE_ENGINES[engine].label} in Modules first`);
  }
}

async function loadDatabases(sql: Sql): Promise<ManagedDatabase[]> {
  return (await sql<Record<string, unknown>>`
    select databases.*, sites.domain as site_domain, node_apps.name as app_name
    from databases
    left join sites on sites.id = databases.site_id
    left join node_apps on node_apps.id = databases.app_id
    order by databases.engine, databases.name
  `).map(mapDatabase);
}

async function loadUsers(sql: Sql, where?: { id: number }): Promise<DatabaseUser[]> {
  const rows = where
    ? await sql<Record<string, unknown>>`select * from database_users where id = ${where.id}`
    : await sql<Record<string, unknown>>`select * from database_users order by engine, name`;
  const grants = await sql<Record<string, unknown>>`
    select database_grants.*, databases.name as database_name
    from database_grants
    join databases on databases.id = database_grants.database_id
    order by databases.name
  `;
  return rows.map((row) => mapDatabaseUser(row, grants));
}

async function databaseById(sql: Sql, id: number): Promise<ManagedDatabase> {
  const db = (await loadDatabases(sql)).find((d) => d.id === id);
  if (!db) throw new Error("Database not found");
  return db;
}

async function userById(sql: Sql, id: number): Promise<DatabaseUser> {
  const user = (await loadUsers(sql, { id }))[0];
  if (!user) throw new Error("Database user not found");
  return user;
}

async function assertNameFree(
  sql: Sql,
  table: "databases" | "database_users",
  engine: DatabaseEngine,
  name: string,
) {
  const rows =
    table === "databases"
      ? await sql`select 1 from databases where engine = ${engine} and name = ${name}`
      : await sql`select 1 from database_users where engine = ${engine} and name = ${name}`;
  if (rows.length > 0) {
    const what = table === "databases" ? "A database" : "A user";
    throw new Error(`${what} named ${name} already exists on ${DATABASE_ENGINES[engine].label}`);
  }
}

/** Site or app the database belongs to; at most one, and it must exist. */
async function resolveOwner(
  sql: Sql,
  siteId: number | null,
  appId: number | null,
): Promise<{ siteId: number | null; appId: number | null }> {
  if (siteId && appId) throw new Error("Link the database to a site or an app, not both");
  if (siteId && (await sql`select 1 from sites where id = ${siteId}`).length === 0) {
    throw new Error("Site not found");
  }
  if (appId && (await sql`select 1 from node_apps where id = ${appId}`).length === 0) {
    throw new Error("App not found");
  }
  return { siteId: siteId || null, appId: appId || null };
}

async function writeGrants(
  sql: Sql,
  user: { id: number; engine: DatabaseEngine },
  grants: GrantInput[],
) {
  const wanted = normalizeGrants(grants);
  const databases = await loadDatabases(sql);
  for (const grant of wanted) {
    const db = databases.find((d) => d.id === grant.databaseId);
    if (!db) throw new Error("Database not found");
    if (db.engine !== user.engine) {
      throw new Error(`${db.name} is a ${DATABASE_ENGINES[db.engine].label} database`);
    }
  }
  for (const grant of wanted) {
    await sql`
      insert into database_grants (user_id, database_id, level)
      values (${user.id}, ${grant.databaseId}, ${grant.level})
      on conflict (user_id, database_id) do update set level = excluded.level
    `;
  }
  const keep = new Set(wanted.map((g) => g.databaseId));
  for (const row of await sql<{ database_id: number }>`
    select database_id from database_grants where user_id = ${user.id}
  `) {
    if (!keep.has(Number(row.database_id))) {
      await sql`delete from database_grants where user_id = ${user.id} and database_id = ${row.database_id}`;
    }
  }
}

/** Applies the change; a failure is reported next to the one-time password instead of hiding it. */
async function applyKeepingCredentials(
  sql: Sql,
  credentials: DatabaseCredentials,
): Promise<IssuedCredentials> {
  try {
    await applyAfterChange(sql);
    return { credentials, applyError: null };
  } catch (err) {
    return {
      credentials,
      applyError: err instanceof Error ? err.message : "Could not apply this change on the server",
    };
  }
}

function credentialsFor(
  engine: DatabaseEngine,
  user: string,
  password: string,
  database: string | null,
): DatabaseCredentials {
  return {
    engine,
    host: "127.0.0.1",
    port: DATABASE_ENGINES[engine].port,
    user,
    password,
    database,
  };
}

const engineSchema = z.enum(["mariadb", "postgresql"]);
const levelSchema = z.enum(["full", "readwrite", "readonly"]);
const nameSchema = z.string().max(64);
const idSchema = z.number().int().positive();
const grantsSchema = z.array(z.object({ databaseId: idSchema, level: levelSchema })).max(200);

export const getDatabases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<DatabasesOverview> => {
    const sql = await getSql();
    const [enabled, databases, users, info] = await Promise.all([
      enabledEngines(sql),
      loadDatabases(sql),
      loadUsers(sql),
      readServerInfo(),
    ]);
    const sites = await sql<{ id: number; domain: string }>`select id, domain from sites order by domain`;
    const apps = await sql<{ id: number; name: string }>`select id, name from node_apps order by name`;
    return {
      engines: DATABASE_ENGINE_KEYS.map((engine) => ({ engine, enabled: enabled.has(engine) })),
      databases: databases.map((db) => {
        const sizes = info[db.engine]?.sizes as Record<string, unknown> | undefined;
        const size = sizes?.[db.name];
        return { ...db, sizeBytes: typeof size === "number" ? size : null };
      }),
      users,
      sites: sites.map((s) => ({ id: Number(s.id), domain: String(s.domain) })),
      apps: apps.map((a) => ({ id: Number(a.id), name: String(a.name) })),
    };
  });

export const createDatabase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      engine: engineSchema,
      name: nameSchema,
      siteId: idSchema.nullable().default(null),
      appId: idSchema.nullable().default(null),
      /** Also create a user with full access to the new database. */
      userName: nameSchema.nullable().default(null),
    }),
  )
  .handler(async ({ data }): Promise<IssuedCredentials | null> => {
    const sql = await getSql();
    await assertEngineEnabled(sql, data.engine);
    const name = normalizeDatabaseName(data.engine, data.name, "database");
    const owner = await resolveOwner(sql, data.siteId, data.appId);
    await assertNameFree(sql, "databases", data.engine, name);
    const label = DATABASE_ENGINES[data.engine].label;

    if (data.userName === null) {
      await sql`
        insert into databases (engine, name, site_id, app_id)
        values (${data.engine}, ${name}, ${owner.siteId}, ${owner.appId})
      `;
      await logActivity(sql, "database", `Created ${label} database ${name}`);
      await applyAfterChange(sql);
      return null;
    }

    const userName = normalizeDatabaseName(data.engine, data.userName, "user");
    await assertNameFree(sql, "database_users", data.engine, userName);
    const password = generateDatabasePassword();
    // One statement, so the database, its user and the grant land together.
    await sql`
      with db as (
        insert into databases (engine, name, site_id, app_id)
        values (${data.engine}, ${name}, ${owner.siteId}, ${owner.appId})
        returning id
      ), usr as (
        insert into database_users (engine, name, password_hash)
        values (${data.engine}, ${userName}, ${databasePasswordHash(data.engine, password)})
        returning id
      )
      insert into database_grants (user_id, database_id, level)
      select usr.id, db.id, 'full' from usr, db
    `;
    await logActivity(sql, "database", `Created ${label} database ${name} with user ${userName}`);
    return applyKeepingCredentials(sql, credentialsFor(data.engine, userName, password, name));
  });

export const updateDatabase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: idSchema,
      siteId: idSchema.nullable(),
      appId: idSchema.nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const db = await databaseById(sql, data.id);
    const owner = await resolveOwner(sql, data.siteId, data.appId);
    await sql`
      update databases set site_id = ${owner.siteId}, app_id = ${owner.appId} where id = ${db.id}
    `;
    return { ok: true as const };
  });

export const deleteDatabase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: idSchema, confirm: z.string().max(64) }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const db = await databaseById(sql, data.id);
    if (data.confirm !== db.name) throw new Error("Type the database name to confirm");
    // Drop on the server first: if that fails the row stays and nothing is lost.
    if (isVpsApply()) await runHelper({ op: "drop-database", engine: db.engine, name: db.name });
    await sql`delete from databases where id = ${db.id}`;
    await logActivity(sql, "database", `Deleted ${DATABASE_ENGINES[db.engine].label} database ${db.name}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const createDatabaseUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ engine: engineSchema, name: nameSchema, grants: grantsSchema }))
  .handler(async ({ data }): Promise<IssuedCredentials> => {
    const sql = await getSql();
    await assertEngineEnabled(sql, data.engine);
    const name = normalizeDatabaseName(data.engine, data.name, "user");
    await assertNameFree(sql, "database_users", data.engine, name);
    const password = generateDatabasePassword();
    const rows = await sql<{ id: number }>`
      insert into database_users (engine, name, password_hash)
      values (${data.engine}, ${name}, ${databasePasswordHash(data.engine, password)})
      returning id
    `;
    const user = { id: Number(rows[0].id), engine: data.engine };
    try {
      await writeGrants(sql, user, data.grants);
    } catch (err) {
      await sql`delete from database_users where id = ${user.id}`;
      throw err;
    }
    const saved = await userById(sql, user.id);
    await logActivity(sql, "database", `Created ${DATABASE_ENGINES[data.engine].label} user ${name}`);
    return applyKeepingCredentials(
      sql,
      credentialsFor(data.engine, name, password, saved.grants[0]?.databaseName ?? null),
    );
  });

export const updateDatabaseUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: idSchema, grants: grantsSchema }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const user = await userById(sql, data.id);
    await writeGrants(sql, user, data.grants);
    await logActivity(sql, "database", `Changed access for ${DATABASE_ENGINES[user.engine].label} user ${user.name}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });

export const resetDatabaseUserPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }): Promise<IssuedCredentials> => {
    const sql = await getSql();
    const user = await userById(sql, data.id);
    const password = generateDatabasePassword();
    await sql`
      update database_users
      set password_hash = ${databasePasswordHash(user.engine, password)}
      where id = ${user.id}
    `;
    await logActivity(sql, "database", `Reset the password of ${DATABASE_ENGINES[user.engine].label} user ${user.name}`);
    return applyKeepingCredentials(
      sql,
      credentialsFor(user.engine, user.name, password, user.grants[0]?.databaseName ?? null),
    );
  });

export const deleteDatabaseUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const user = await userById(sql, data.id);
    if (isVpsApply()) await runHelper({ op: "drop-user", engine: user.engine, name: user.name });
    await sql`delete from database_users where id = ${user.id}`;
    await logActivity(sql, "database", `Deleted ${DATABASE_ENGINES[user.engine].label} user ${user.name}`);
    await applyAfterChange(sql);
    return { ok: true as const };
  });
