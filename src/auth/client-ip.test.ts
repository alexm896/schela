import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clientIp, failedSignInLine } from "./client-ip.ts";

describe("clientIp", () => {
  it("takes the address nginx put in X-Real-IP", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
    assert.equal(clientIp(new Headers({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
  });

  it("ignores X-Forwarded-For", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9" });
    assert.equal(clientIp(headers), "198.51.100.7");
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.9" })), "unknown");
  });

  it("logs anything but a single plain address as unknown", () => {
    for (const value of [
      "",
      "evil",
      "1.2.3.4, 5.6.7.8",
      "fe80::1%eth0",
      "1.2.3.4 x",
      "1.2.3.400",
    ]) {
      assert.equal(clientIp(new Headers({ "x-real-ip": value })), "unknown", value);
    }
    assert.equal(clientIp(undefined), "unknown");
  });
});

describe("failedSignInLine", () => {
  it("is the exact line the fail2ban filter matches", () => {
    assert.equal(failedSignInLine("198.51.100.7"), "schela-auth: failed sign-in from 198.51.100.7");
  });
});
