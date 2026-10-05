import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dnsValuesMatch, normalizeDnsValue } from "./dns-check.ts";
import { generateMailboxPassword } from "./mail.ts";
import { hashMailboxPassword, verifyMailboxPassword } from "./password.ts";

describe("mailbox passwords", () => {
  it("hashes and verifies SSHA512", () => {
    const password = "correct-horse-1";
    const hash = hashMailboxPassword(password);
    assert.match(hash, /^\{SSHA512\}/);
    assert.equal(verifyMailboxPassword(password, hash), true);
    assert.equal(verifyMailboxPassword("wrong-password", hash), false);
    assert.notEqual(hashMailboxPassword(password), hash);
  });

  it("rejects short passwords", () => {
    assert.throws(() => hashMailboxPassword("short"), /at least 8/);
    assert.equal(generateMailboxPassword().length, 16);
  });
});

describe("live DNS matching", () => {
  it("normalizes MX and TXT from public resolvers", () => {
    assert.equal(normalizeDnsValue("MX", "10 mail.example.com."), "mail.example.com");
    assert.equal(
      dnsValuesMatch("MX", "mail.example.com", ["10 mail.example.com."]),
      true,
    );
    assert.equal(
      dnsValuesMatch("A", "203.0.113.10", ["203.0.113.10"]),
      true,
    );
    assert.equal(
      dnsValuesMatch(
        "TXT",
        "v=spf1 mx a ip4:203.0.113.10 ~all",
        ['"v=spf1 mx a ip4:203.0.113.10 ~all"'],
      ),
      true,
    );
    assert.equal(dnsValuesMatch("A", "203.0.113.10", ["198.51.100.1"]), false);
  });
});
