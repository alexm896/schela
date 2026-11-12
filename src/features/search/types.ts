import type { SearchAccess, SearchEngine } from "./search";

export type SearchKey = {
  id: number;
  engine: SearchEngine;
  access: SearchAccess;
  /** The key's id on the engine, used to revoke it. */
  keyId: string;
  /** The first characters of the key; the key itself is never stored. */
  keyHint: string;
  prefix: string;
  siteId: number | null;
  siteDomain: string | null;
  appId: number | null;
  appName: string | null;
  createdAt: string;
};
