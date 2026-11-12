// The search engine releases pinned in the catalog shared with schela-apply.
import versions from "../../../installer/versions.json" with { type: "json" };
import type { SearchEngine } from "./search";

export type SearchRelease = { version: string; sha256: Record<string, string> };

export const SEARCH_CATALOG: Record<SearchEngine, SearchRelease> = {
  meilisearch: versions.meilisearch,
  typesense: versions.typesense,
};
