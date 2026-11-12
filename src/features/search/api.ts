import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/auth/middleware";
import { logActivity } from "@/server/activity";
import { getSql, type Sql } from "@/server/db";
import { isVpsApply } from "@/server/env";
import { SEARCH_CATALOG } from "./catalog";
import {
  describeKey,
  enabledSearchEngines,
  loadSearchKeys,
  revokeSearchKey,
  runSearchHelper,
} from "./manage";
import {
  SEARCH_ACCESS_KEYS,
  SEARCH_ENGINE_KEYS,
  SEARCH_ENGINES,
  keyHint,
  searchHost,
  searchPrefix,
  type IssuedSearchKey,
  type SearchEngine,
} from "./search";
import type { SearchKey } from "./types";

export type SearchEngineStatus = {
  engine: SearchEngine;
  /** Module switch in the panel. */
  enabled: boolean;
  installed: boolean;
  running: boolean;
  enabledAtBoot: boolean;
  healthy: boolean;
  /** What the engine reports; empty when it does not answer. */
  version: string;
  /** The release pinned in versions.json, installed by the next apply. */
  pinnedVersion: string;
  memoryBytes: number | null;
  diskBytes: number | null;
  indexes: number | null;
  error: string;
};

/** A key row plus whether the engine still has it (null when unknown). */
export type SearchKeyWithState = SearchKey & { onServer: boolean | null };

export type SearchOverview = {
  /** False in local preview: nothing runs, keys are not real. */
  live: boolean;
  engines: SearchEngineStatus[];
  keys: SearchKeyWithState[];
  sites: { id: number; domain: string }[];
  apps: { id: number; name: string }[];
};

type EngineInfo = {
  installed?: unknown;
  running?: unknown;
  enabledAtBoot?: unknown;
  healthy?: unknown;
  version?: unknown;
  memoryBytes?: unknown;
  diskBytes?: unknown;
  indexes?: unknown;
  keys?: unknown;
  error?: unknown;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

async function readServerInfo(): Promise<Partial<Record<SearchEngine, EngineInfo>> | null> {
  if (!isVpsApply()) return null;
  try {
    const out = await runSearchHelper({ op: "info" });
    return (out.engines ?? {}) as Partial<Record<SearchEngine, EngineInfo>>;
  } catch (err) {
    console.error("[schela] search info:", err);
    return {};
  }
}

async function assertEngineEnabled(sql: Sql, engine: SearchEngine) {
  if (!(await enabledSearchEngines(sql)).includes(engine)) {
    throw new Error(`Turn on ${SEARCH_ENGINES[engine].label} in Modules first`);
  }
}

export const getSearch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<SearchOverview> => {
    const sql = await getSql();
    const [enabled, keys, info, sites, apps] = await Promise.all([
      enabledSearchEngines(sql),
      loadSearchKeys(sql),
      readServerInfo(),
      sql<{ id: number; domain: string }>`select id, domain from sites order by domain`,
      sql<{ id: number; name: string }>`select id, name from node_apps order by name`,
    ]);
    const engines = SEARCH_ENGINE_KEYS.map((engine): SearchEngineStatus => {
      const on = enabled.includes(engine);
      const i = info?.[engine] ?? {};
      return {
        engine,
        enabled: on,
        // In preview, show the module switch as if apply had run.
        installed: info === null ? on : i.installed === true,
        running: info === null ? on : i.running === true,
        enabledAtBoot: info === null ? on : i.enabledAtBoot === true,
        healthy: info === null ? on : i.healthy === true,
        version: info === null ? "" : typeof i.version === "string" ? i.version : "",
        pinnedVersion: SEARCH_CATALOG[engine].version,
        memoryBytes: count(i.memoryBytes),
        diskBytes: count(i.diskBytes),
        indexes: count(i.indexes),
        error: typeof i.error === "string" ? i.error : "",
      };
    });
    const present = (engine: SearchEngine): Set<string> | null => {
      const ids = info?.[engine]?.keys;
      return Array.isArray(ids) ? new Set(ids.map(String)) : null;
    };
    const known = { meilisearch: present("meilisearch"), typesense: present("typesense") };
    return {
      live: info !== null,
      engines,
      keys: keys.map((k) => ({
        ...k,
        onServer: known[k.engine] ? known[k.engine]!.has(k.keyId) : null,
      })),
      sites: sites.map((s) => ({ id: Number(s.id), domain: String(s.domain) })),
      apps: apps.map((a) => ({ id: Number(a.id), name: String(a.name) })),
    };
  });

const engineSchema = z.enum(SEARCH_ENGINE_KEYS as [SearchEngine, ...SearchEngine[]]);
const idSchema = z.number().int().positive();

export const createSearchKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      engine: engineSchema,
      owner: z.enum(["site", "app"]),
      ownerId: idSchema,
      access: z.enum(SEARCH_ACCESS_KEYS as ["admin", "search"]),
    }),
  )
  .handler(async ({ data }): Promise<IssuedSearchKey> => {
    const sql = await getSql();
    await assertEngineEnabled(sql, data.engine);
    const exists =
      data.owner === "site"
        ? await sql`select 1 from sites where id = ${data.ownerId}`
        : await sql`select 1 from node_apps where id = ${data.ownerId}`;
    if (exists.length === 0)
      throw new Error(data.owner === "site" ? "Site not found" : "App not found");
    const prefix = searchPrefix(data.owner, data.ownerId);

    let keyId: string;
    let key: string;
    if (isVpsApply()) {
      const out = await runSearchHelper({
        op: "create-key",
        engine: data.engine,
        owner: data.owner,
        id: data.ownerId,
        access: data.access,
      });
      keyId = String(out.keyId ?? "");
      key = String(out.key ?? "");
      if (!keyId || !key || out.prefix !== prefix)
        throw new Error("The search engine returned no usable key");
    } else {
      // Local preview: nothing runs, so the key is a placeholder.
      const { randomBytes, randomUUID } = await import("node:crypto");
      keyId = `preview-${randomUUID()}`;
      key = randomBytes(32).toString("hex");
    }

    const siteId = data.owner === "site" ? data.ownerId : null;
    const appId = data.owner === "app" ? data.ownerId : null;
    await sql`
      insert into search_keys (engine, site_id, app_id, access, key_id, key_hint)
      values (${data.engine}, ${siteId}, ${appId}, ${data.access}, ${keyId}, ${keyHint(key)})
    `;
    const saved = (await loadSearchKeys(sql)).find(
      (k) => k.engine === data.engine && k.keyId === keyId,
    );
    await logActivity(
      sql,
      "search",
      `Created ${saved ? describeKey(saved) : `${data.engine} key for ${prefix}*`}`,
    );
    return {
      engine: data.engine,
      access: data.access,
      key,
      prefix,
      host: searchHost(),
      port: SEARCH_ENGINES[data.engine].port,
    };
  });

export const revokeSearchKeyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: idSchema }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const key = (await loadSearchKeys(sql)).find((k) => k.id === data.id);
    if (!key) throw new Error("Key not found");
    await revokeSearchKey(sql, key);
    return { ok: true };
  });
