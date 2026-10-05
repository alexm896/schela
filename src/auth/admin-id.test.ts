import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loginEmails, toAuthEmail } from "./admin-id.ts";

describe("loginEmails", () => {
  it("maps admin to the current local domain", () => {
    assert.equal(toAuthEmail("admin"), "admin@schela.local");
    assert.deepEqual(loginEmails("admin"), ["admin@schela.local"]);
  });

  it("also tries the box hostname", () => {
    assert.deepEqual(loginEmails("admin", "box.example.com"), [
      "admin@schela.local",
      "admin@box.example.com",
    ]);
  });

  it("keeps an explicit email unchanged", () => {
    assert.deepEqual(loginEmails("admin@schela.local"), ["admin@schela.local"]);
  });
});
