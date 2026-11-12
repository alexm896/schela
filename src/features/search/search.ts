// Pure rules for the local search engines: what each engine is, what a key may
// do, the index prefix a site or app owns and the settings an app needs. No
// I/O: shared by the server functions, the UI and the tests.

export const SEARCH_ENGINES = {
  meilisearch: { label: "Meilisearch", port: 7700, indexWord: "indexes", indexOne: "index" },
  typesense: { label: "Typesense", port: 8108, indexWord: "collections", indexOne: "collection" },
} as const;

export type SearchEngine = keyof typeof SEARCH_ENGINES;
export const SEARCH_ENGINE_KEYS = Object.keys(SEARCH_ENGINES) as SearchEngine[];

export function isSearchEngine(value: unknown): value is SearchEngine {
  return typeof value === "string" && (SEARCH_ENGINE_KEYS as string[]).includes(value);
}

export const SEARCH_ACCESS = {
  admin: {
    label: "Admin",
    description:
      "Create, fill, configure and delete its own indexes, and search them. For the app's backend.",
  },
  search: {
    label: "Search only",
    description: "Search its own indexes. Cannot add, change or delete anything.",
  },
} as const;

export type SearchAccess = keyof typeof SEARCH_ACCESS;
export const SEARCH_ACCESS_KEYS = Object.keys(SEARCH_ACCESS) as SearchAccess[];

export function isSearchAccess(value: unknown): value is SearchAccess {
  return typeof value === "string" && (SEARCH_ACCESS_KEYS as string[]).includes(value);
}

export type SearchOwnerKind = "site" | "app";

/**
 * The start every index name of a site or app must have, as schela-search
 * scopes its keys. The id ends at the underscore, so "site3_" is never the
 * start of "site30_".
 */
export function searchPrefix(kind: SearchOwnerKind, id: number): string {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid owner id");
  return `${kind}${id}_`;
}

/** The first characters of a key, kept so the admin can tell keys apart. */
export function keyHint(key: string): string {
  return key.slice(0, 4);
}

export type IssuedSearchKey = {
  engine: SearchEngine;
  access: SearchAccess;
  key: string;
  prefix: string;
  host: string;
  port: number;
};

export function searchHost(): string {
  return "127.0.0.1";
}

/** Laravel Scout settings for an issued key (config/scout.php reads these). */
export function scoutEnv(issued: IssuedSearchKey): string {
  const lines = [`SCOUT_DRIVER=${issued.engine}`, `SCOUT_PREFIX=${issued.prefix}`];
  if (issued.engine === "meilisearch") {
    lines.push(
      `MEILISEARCH_HOST=http://${issued.host}:${issued.port}`,
      `MEILISEARCH_KEY=${issued.key}`,
    );
  } else {
    lines.push(
      `TYPESENSE_API_KEY=${issued.key}`,
      `TYPESENSE_HOST=${issued.host}`,
      `TYPESENSE_PORT=${issued.port}`,
      "TYPESENSE_PROTOCOL=http",
    );
  }
  return lines.join("\n");
}
