import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIpv4, normalizeIp } from "./ips.ts";

describe("IP addresses", () => {
  it("accepts dotted IPv4", () => {
    assert.equal(isIpv4("203.0.113.10"), true);
    assert.equal(isIpv4("256.1.1.1"), false);
    assert.equal(normalizeIp(" 10.0.0.2 "), "10.0.0.2");
    assert.throws(() => normalizeIp("example.com"), /IPv4/);
  });
});
