import { existsSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertVersionAllowed } from "./installed.ts";

const saved = process.env.SCHELA_APPLY;
afterEach(() => {
  if (saved === undefined) delete process.env.SCHELA_APPLY;
  else process.env.SCHELA_APPLY = saved;
});

describe("assertVersionAllowed (server-side gate for sites and apps)", () => {
  it("accepts supported versions for new sites and apps", async () => {
    delete process.env.SCHELA_APPLY;
    await assertVersionAllowed("php", "8.5");
    await assertVersionAllowed("node", "26");
  });

  it("rejects retired versions for new sites and apps", async () => {
    delete process.env.SCHELA_APPLY;
    await assert.rejects(assertVersionAllowed("php", "8.1"), /PHP 8\.1 is not available/);
    await assert.rejects(assertVersionAllowed("node", "18"), /Node 18 is not available/);
    await assert.rejects(assertVersionAllowed("node", "20"), /Node 20 is not available/);
  });

  it("lets an existing site or app keep its retired version", async () => {
    delete process.env.SCHELA_APPLY;
    await assertVersionAllowed("php", "8.1", "8.1");
    await assertVersionAllowed("node", "18", "18");
  });

  it("rejects switching an existing site back to a retired version", async () => {
    delete process.env.SCHELA_APPLY;
    await assert.rejects(assertVersionAllowed("php", "8.1", "8.3"), /PHP 8\.1/);
  });

  // Needs a machine without PHP-FPM 8.5 or n installed (any dev machine).
  const bare = !existsSync("/usr/sbin/php-fpm8.5") && !existsSync("/usr/local/n/versions/node");
  it(
    "on a server, rejects a supported version that is not installed",
    { skip: !bare },
    async () => {
      process.env.SCHELA_APPLY = "1";
      await assert.rejects(assertVersionAllowed("php", "8.5"), /none installed/);
      await assert.rejects(assertVersionAllowed("node", "26"), /none installed/);
    },
  );
});
