import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeWebRoot, siteFilesRoot, siteRootFor, webRootFromRoot } from "./site-root.ts";

describe("document root", () => {
  it("normalizes relative folders under www", () => {
    assert.equal(normalizeWebRoot(""), "");
    assert.equal(normalizeWebRoot("/"), "");
    assert.equal(normalizeWebRoot("public"), "public");
    assert.equal(normalizeWebRoot("/public/"), "public");
    assert.equal(normalizeWebRoot("app/public_html"), "app/public_html");
  });

  it("rejects traversal, hidden folders and odd characters", () => {
    for (const bad of ["..", "../x", "public/..", ".git", "a/.env", "a b", "a;b", "a\nb", "a/b/c/d/e", "pub$lic"]) {
      assert.throws(() => normalizeWebRoot(bad), Error, bad);
    }
  });

  it("keeps the files root at www whatever the document root is", () => {
    assert.equal(siteFilesRoot("s_app"), "/home/s_app/www");
  });

  it("maps between the stored root and the relative folder", () => {
    assert.equal(siteRootFor("s_app", ""), "/home/s_app/www");
    assert.equal(siteRootFor("s_app", "public"), "/home/s_app/www/public");
    assert.equal(webRootFromRoot("s_app", "/home/s_app/www"), "");
    assert.equal(webRootFromRoot("s_app", "/home/s_app/www/public"), "public");
    assert.equal(webRootFromRoot("s_app", "/home/other/www/public"), "");
  });
});
