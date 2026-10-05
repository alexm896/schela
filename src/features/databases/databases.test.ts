import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  connectionUrl,
  laravelEnv,
  normalizeDatabaseName,
  normalizeGrants,
  suggestDatabaseName,
} from "./databases.ts";
import {
  DATABASE_HASH_PATTERNS,
  DATABASE_PASSWORD_LENGTH,
  generateDatabasePassword,
  mariadbPasswordHash,
  scramSha256Verifier,
} from "./password.ts";

describe("normalizeDatabaseName", () => {
  it("accepts lowercase identifiers and lowercases input", () => {
    assert.equal(normalizeDatabaseName("mariadb", "shop"), "shop");
    assert.equal(normalizeDatabaseName("postgresql", "  Shop_2024 "), "shop_2024");
    assert.equal(normalizeDatabaseName("mariadb", "a".repeat(32)), "a".repeat(32));
  });

  it("rejects anything that is not a plain identifier", () => {
    for (const bad of [
      "",
      "1shop",
      "_shop",
      "shop-db",
      "shop.db",
      "shop db",
      "shop`",
      'shop"',
      "shop;drop",
      "a".repeat(33),
      "café",
    ]) {
      assert.throws(() => normalizeDatabaseName("mariadb", bad), `accepted ${JSON.stringify(bad)}`);
    }
  });

  it("rejects system names and reserved prefixes per engine", () => {
    for (const name of ["mysql", "information_schema", "performance_schema", "sys", "root"]) {
      assert.throws(() => normalizeDatabaseName("mariadb", name), /reserved/);
    }
    for (const name of ["postgres", "template0", "template1"]) {
      assert.throws(() => normalizeDatabaseName("postgresql", name), /reserved/);
    }
    assert.throws(() => normalizeDatabaseName("postgresql", "pg_shop"), /cannot start/);
    assert.throws(() => normalizeDatabaseName("mariadb", "schela_owner_shop", "user"), /cannot start/);
    assert.equal(normalizeDatabaseName("postgresql", "mysql"), "mysql");
  });
});

describe("suggestDatabaseName", () => {
  it("turns a domain into a valid name", () => {
    assert.equal(suggestDatabaseName("shop.example.com"), "shop_example_com");
    assert.equal(suggestDatabaseName("www.my-site.ro"), "my_site_ro");
    assert.equal(suggestDatabaseName("123.example"), "example");
    assert.equal(suggestDatabaseName("pg-tools.dev"), "db_pg_tools_dev");
    assert.equal(suggestDatabaseName("---"), "db");
    const long = suggestDatabaseName("a-very-long-subdomain-name.example-company.com");
    assert.ok(long.length <= 32);
    assert.equal(normalizeDatabaseName("mariadb", long), long);
  });
});

describe("normalizeGrants", () => {
  it("keeps one level per database, the last one wins", () => {
    assert.deepEqual(
      normalizeGrants([
        { databaseId: 1, level: "readonly" },
        { databaseId: 2, level: "full" },
        { databaseId: 1, level: "readwrite" },
      ]),
      [
        { databaseId: 1, level: "readwrite" },
        { databaseId: 2, level: "full" },
      ],
    );
  });

  it("rejects bad ids and levels", () => {
    assert.throws(() => normalizeGrants([{ databaseId: 0, level: "full" }]));
    assert.throws(() => normalizeGrants([{ databaseId: 1.5, level: "full" }]));
    // @ts-expect-error unknown level
    assert.throws(() => normalizeGrants([{ databaseId: 1, level: "owner" }]));
  });
});

describe("connection details", () => {
  const creds = {
    engine: "mariadb" as const,
    host: "127.0.0.1",
    port: 3306,
    user: "shop",
    password: "Secret123",
    database: "shop",
  };

  it("builds a URL per engine", () => {
    assert.equal(connectionUrl(creds), "mysql://shop:Secret123@127.0.0.1:3306/shop");
    assert.equal(
      connectionUrl({ ...creds, engine: "postgresql", port: 5432, database: null }),
      "postgresql://shop:Secret123@127.0.0.1:5432",
    );
  });

  it("builds the Laravel .env block", () => {
    assert.equal(
      laravelEnv({ ...creds, engine: "postgresql", port: 5432 }),
      [
        "DB_CONNECTION=pgsql",
        "DB_HOST=127.0.0.1",
        "DB_PORT=5432",
        "DB_DATABASE=shop",
        "DB_USERNAME=shop",
        "DB_PASSWORD=Secret123",
      ].join("\n"),
    );
  });
});

describe("database passwords", () => {
  it("generates long alphanumeric passwords", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pass = generateDatabasePassword();
      assert.equal(pass.length, DATABASE_PASSWORD_LENGTH);
      assert.match(pass, /^[A-Za-z0-9]+$/);
      seen.add(pass);
    }
    assert.equal(seen.size, 50);
  });

  it("hashes for MariaDB like PASSWORD() does", () => {
    assert.equal(
      mariadbPasswordHash("correct horse battery staple"),
      "*F4AF2E5D85456A908E0F552F0366375B06267295",
    );
    assert.match(mariadbPasswordHash(generateDatabasePassword()), DATABASE_HASH_PATTERNS.mariadb);
  });

  it("builds a PostgreSQL SCRAM-SHA-256 verifier", () => {
    const salt = Buffer.from([...Array(16).keys()]);
    assert.equal(
      scramSha256Verifier("correct horse battery staple", salt),
      "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$ONYbSJBXtKl6bP6PVqw8pm9e7EiacprLnoUQPFS80Hw=:IPOtHuGJ2HifEQg74W2XXqqCrCyQG55GbPRHa6g6n9w=",
    );
    const random = scramSha256Verifier(generateDatabasePassword());
    assert.match(random, DATABASE_HASH_PATTERNS.postgresql);
    assert.notEqual(random, scramSha256Verifier(generateDatabasePassword()));
  });
});
