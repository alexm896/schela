// Pure rules for managed databases: engines, names, access levels and the
// connection details shown after a password is created. No I/O: shared by the
// server functions, the state dump, the UI and the tests.

export const DATABASE_ENGINES = {
  mariadb: {
    label: "MariaDB",
    port: 3306,
    laravelDriver: "mysql",
    urlScheme: "mysql",
  },
  postgresql: {
    label: "PostgreSQL",
    port: 5432,
    laravelDriver: "pgsql",
    urlScheme: "postgresql",
  },
} as const;

export type DatabaseEngine = keyof typeof DATABASE_ENGINES;
export const DATABASE_ENGINE_KEYS = Object.keys(DATABASE_ENGINES) as DatabaseEngine[];

export const ACCESS_LEVELS = {
  full: {
    label: "Full",
    short: "full",
    description: "Read and write data and change tables. Use for the app and its migrations.",
  },
  readwrite: {
    label: "Read and write",
    short: "read-write",
    description: "Read and change data. Cannot create, alter or drop tables.",
  },
  readonly: {
    label: "Read only",
    short: "read-only",
    description: "Read data only. Good for reporting and exports.",
  },
} as const;

export type AccessLevel = keyof typeof ACCESS_LEVELS;
export const ACCESS_LEVEL_KEYS = Object.keys(ACCESS_LEVELS) as AccessLevel[];

export const DATABASE_NAME_MAX = 32;
const NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;

// System schemas and accounts of each engine, plus the names schela-db uses
// for its own roles. A managed name must never collide with one of these.
const RESERVED_NAMES: Record<DatabaseEngine, readonly string[]> = {
  mariadb: [
    "mysql",
    "information_schema",
    "performance_schema",
    "sys",
    "test",
    "root",
    "mariadb",
    "public",
  ],
  postgresql: ["postgres", "template0", "template1", "public", "root"],
};
const RESERVED_PREFIXES = ["pg_", "schela_"];

export function isDatabaseEngine(value: unknown): value is DatabaseEngine {
  return typeof value === "string" && Object.hasOwn(DATABASE_ENGINES, value);
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && Object.hasOwn(ACCESS_LEVELS, value);
}

/**
 * Lowercases and checks a database or user name. Names are used verbatim as
 * SQL identifiers by schela-db, so the alphabet is deliberately small.
 */
export function normalizeDatabaseName(
  engine: DatabaseEngine,
  raw: string,
  kind: "database" | "user" = "database",
): string {
  const name = raw.trim().toLowerCase();
  const label = kind === "database" ? "Database name" : "User name";
  if (!name) throw new Error(`${label} is required`);
  if (!NAME_RE.test(name)) {
    throw new Error(
      `${label}: 1-${DATABASE_NAME_MAX} characters, lowercase letters, digits and _, starting with a letter`,
    );
  }
  if (RESERVED_NAMES[engine].includes(name)) {
    throw new Error(`${label} "${name}" is reserved by ${DATABASE_ENGINES[engine].label}`);
  }
  const prefix = RESERVED_PREFIXES.find((p) => name.startsWith(p));
  if (prefix) throw new Error(`${label} cannot start with "${prefix}"`);
  return name;
}

/** A valid starting name derived from a site domain or app name. */
export function suggestDatabaseName(source: string): string {
  let name = source
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .replace(/_+$/, "")
    .slice(0, DATABASE_NAME_MAX)
    .replace(/_+$/, "");
  if (!name || RESERVED_PREFIXES.some((p) => name.startsWith(p))) name = `db_${name}`;
  return name.slice(0, DATABASE_NAME_MAX).replace(/_+$/, "") || "db";
}

export type GrantInput = { databaseId: number; level: AccessLevel };

/** One grant per database; the last level given for a database wins. */
export function normalizeGrants(grants: readonly GrantInput[]): GrantInput[] {
  const byDatabase = new Map<number, AccessLevel>();
  for (const grant of grants) {
    if (!Number.isInteger(grant.databaseId) || grant.databaseId <= 0) {
      throw new Error("Invalid database in access list");
    }
    if (!isAccessLevel(grant.level)) throw new Error("Invalid access level");
    byDatabase.set(grant.databaseId, grant.level);
  }
  return [...byDatabase].map(([databaseId, level]) => ({ databaseId, level }));
}

export type DatabaseCredentials = {
  engine: DatabaseEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string | null;
};

export function connectionUrl(c: DatabaseCredentials): string {
  const { urlScheme } = DATABASE_ENGINES[c.engine];
  const auth = `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}`;
  const path = c.database ? `/${encodeURIComponent(c.database)}` : "";
  return `${urlScheme}://${auth}@${c.host}:${c.port}${path}`;
}

/** The DB_* block of a Laravel .env file. */
export function laravelEnv(c: DatabaseCredentials): string {
  return [
    `DB_CONNECTION=${DATABASE_ENGINES[c.engine].laravelDriver}`,
    `DB_HOST=${c.host}`,
    `DB_PORT=${c.port}`,
    `DB_DATABASE=${c.database ?? ""}`,
    `DB_USERNAME=${c.user}`,
    `DB_PASSWORD=${c.password}`,
  ].join("\n");
}

/** Engines whose module is on, in display order. */
export function enabledEngines(engines: readonly { engine: DatabaseEngine; enabled: boolean }[]): DatabaseEngine[] {
  return engines.filter((e) => e.enabled).map((e) => e.engine);
}

export function formatDatabaseSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
