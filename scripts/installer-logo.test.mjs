import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("installer banner spells Schela, not Keel", () => {
  const src = readFileSync(new URL("../installer/install.sh", import.meta.url), "utf8");
  assert.equal(src.includes("___|_|_|"), false);
  assert.match(src, /╔═╗ ╔═╗ ╦ ╦ ╔═╗ ╦ {3}╔═╗/);
  assert.match(src, /hosting panel/);
  assert.equal(src.split("SCHELA_LOGO").length > 2, true);
});
