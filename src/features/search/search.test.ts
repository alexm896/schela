import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSearchAccess,
  isSearchEngine,
  keyHint,
  scoutEnv,
  searchPrefix,
  type IssuedSearchKey,
} from "./search.ts";

describe("searchPrefix", () => {
  it("names the owner and its id, ending at an underscore", () => {
    assert.equal(searchPrefix("site", 3), "site3_");
    assert.equal(searchPrefix("app", 12), "app12_");
  });

  it("never lets one owner's prefix start another owner's indexes", () => {
    const prefixes = [];
    for (const kind of ["site", "app"] as const) {
      for (let id = 1; id <= 120; id++) prefixes.push(searchPrefix(kind, id));
    }
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a !== b) assert.ok(!b.startsWith(a), `${a} is a prefix of ${b}`);
      }
    }
  });

  it("refuses ids that are not positive integers", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => searchPrefix("site", bad));
    }
  });
});

describe("engine and access names", () => {
  it("knows only the two engines and two access levels", () => {
    assert.ok(isSearchEngine("meilisearch") && isSearchEngine("typesense"));
    assert.ok(!isSearchEngine("elasticsearch") && !isSearchEngine(undefined));
    assert.ok(isSearchAccess("admin") && isSearchAccess("search"));
    assert.ok(!isSearchAccess("master"));
  });
});

describe("issued keys", () => {
  const base = { access: "admin", key: "abcdef0123", prefix: "site3_", host: "127.0.0.1" } as const;

  it("keeps only the first characters as a hint", () => {
    assert.equal(keyHint("abcdef0123"), "abcd");
  });

  it("writes Laravel Scout settings for Meilisearch", () => {
    const issued: IssuedSearchKey = { ...base, engine: "meilisearch", port: 7700 };
    assert.equal(
      scoutEnv(issued),
      [
        "SCOUT_DRIVER=meilisearch",
        "SCOUT_PREFIX=site3_",
        "MEILISEARCH_HOST=http://127.0.0.1:7700",
        "MEILISEARCH_KEY=abcdef0123",
      ].join("\n"),
    );
  });

  it("writes Laravel Scout settings for Typesense", () => {
    const issued: IssuedSearchKey = { ...base, engine: "typesense", port: 8108 };
    assert.equal(
      scoutEnv(issued),
      [
        "SCOUT_DRIVER=typesense",
        "SCOUT_PREFIX=site3_",
        "TYPESENSE_API_KEY=abcdef0123",
        "TYPESENSE_HOST=127.0.0.1",
        "TYPESENSE_PORT=8108",
        "TYPESENSE_PROTOCOL=http",
      ].join("\n"),
    );
  });
});
