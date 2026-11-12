import { logActivity } from "@/server/activity";
import type { Sql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { runSudoHelper } from "@/server/sudo-helper";
import {
  SEARCH_ACCESS,
  SEARCH_ENGINE_KEYS,
  SEARCH_ENGINES,
  searchPrefix,
  type SearchOwnerKind,
} from "./search";
import { mapSearchKey } from "./map";
import type { SearchKey } from "./types";

// Key operations shared by the Search page and by removing a site or app.

const HELPER = "/usr/local/sbin/schela-search";

export async function runSearchHelper(
  req: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return runSudoHelper(HELPER, req, { label: "Search command", timeoutMs: 60_000 });
}

export type SearchOwner = { kind: SearchOwnerKind; id: number };

export async function loadSearchKeys(sql: Sql, owner?: SearchOwner): Promise<SearchKey[]> {
  const rows = await sql<Record<string, unknown>>`
    select search_keys.*, sites.domain as site_domain, node_apps.name as app_name
    from search_keys
    left join sites on sites.id = search_keys.site_id
    left join node_apps on node_apps.id = search_keys.app_id
    order by search_keys.created_at, search_keys.id
  `;
  const keys = rows.map(mapSearchKey);
  if (!owner) return keys;
  return keys.filter((k) => (owner.kind === "site" ? k.siteId === owner.id : k.appId === owner.id));
}

export function describeKey(key: SearchKey): string {
  return `${SEARCH_ENGINES[key.engine].label} ${SEARCH_ACCESS[key.access].label.toLowerCase()} key ${key.keyHint}... (${key.prefix}*)`;
}

/** Revokes the key on the engine, then forgets it. Does not apply. */
export async function revokeSearchKey(sql: Sql, key: SearchKey): Promise<void> {
  // Engine first: if revoking fails the row stays and the key can be revoked later.
  if (isVpsApply())
    await runSearchHelper({ op: "delete-key", engine: key.engine, keyId: key.keyId });
  await sql`delete from search_keys where id = ${key.id}`;
  await logActivity(sql, "search", `Revoked ${describeKey(key)}`);
}

/** Revokes every key of a site or app. Returns one warning per key it could not revoke. */
export async function revokeOwnerKeys(sql: Sql, owner: SearchOwner): Promise<string[]> {
  const warnings: string[] = [];
  for (const key of await loadSearchKeys(sql, owner)) {
    try {
      await revokeSearchKey(sql, key);
    } catch (err) {
      warnings.push(
        `${describeKey(key)} could not be revoked: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return warnings;
}

export async function enabledSearchEngines(sql: Sql) {
  const rows = await sql<{ slug: string }>`
    select slug from modules where enabled = true and slug in ('meilisearch', 'typesense')
  `;
  return SEARCH_ENGINE_KEYS.filter((engine) => rows.some((r) => r.slug === engine));
}

/** The index names a removed owner may leave behind, per engine that is on. */
export async function ownerIndexLabels(sql: Sql, owner: SearchOwner): Promise<string[]> {
  const prefix = searchPrefix(owner.kind, owner.id);
  return (await enabledSearchEngines(sql)).map(
    (engine) =>
      `${SEARCH_ENGINES[engine].label} ${SEARCH_ENGINES[engine].indexWord} starting with ${prefix}`,
  );
}

/**
 * Deletes the indexes of a site or app that is already gone from the applied
 * state, with any key of it still left. Returns one warning per failure.
 */
export async function dropOwnerIndexes(sql: Sql, owner: SearchOwner): Promise<string[]> {
  if (!isVpsApply()) return [];
  const warnings: string[] = [];
  const prefix = searchPrefix(owner.kind, owner.id);
  for (const engine of await enabledSearchEngines(sql)) {
    try {
      await runSearchHelper({ op: "drop-indexes", engine, owner: owner.kind, id: owner.id });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`${SEARCH_ENGINES[engine].label} ${prefix}* could not be deleted: ${reason}`);
    }
  }
  return warnings;
}
