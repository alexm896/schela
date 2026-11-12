import { iso, nullableNum, nullableText, num } from "@/server/rows";
import { searchPrefix } from "./search";
import type { SearchKey } from "./types";

export function mapSearchKey(row: Record<string, unknown>): SearchKey {
  const siteId = nullableNum(row.site_id);
  const appId = nullableNum(row.app_id);
  return {
    id: num(row.id),
    engine: row.engine === "typesense" ? "typesense" : "meilisearch",
    access: row.access === "search" ? "search" : "admin",
    keyId: String(row.key_id),
    keyHint: String(row.key_hint),
    prefix: siteId !== null ? searchPrefix("site", siteId) : searchPrefix("app", appId ?? 0),
    siteId,
    siteDomain: nullableText(row.site_domain),
    appId,
    appName: nullableText(row.app_name),
    createdAt: iso(row.created_at),
  };
}
