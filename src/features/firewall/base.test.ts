import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { baseFirewallRules, firewallRuleProblem, isFirewallPort, isFirewallSource } from "./base.ts";

const ports = (rules: ReturnType<typeof baseFirewallRules>) =>
  rules.map((r) => `${r.protocol}/${r.port}`);

describe("base firewall rules", () => {
  it("are SSH from the setting, HTTP and HTTPS", () => {
    assert.deepEqual(ports(baseFirewallRules(2222, {})), ["tcp/2222", "tcp/80", "tcp/443"]);
  });

  it("add 25, 587 and 993 for mail (not 143) and 53 tcp+udp for DNS", () => {
    assert.deepEqual(ports(baseFirewallRules(22, { mail: true, dns: true })), [
      "tcp/22", "tcp/80", "tcp/443", "tcp/25", "tcp/587", "tcp/993", "tcp/53", "udp/53",
    ]);
  });

  it("drop module ports when the module is off", () => {
    assert.deepEqual(ports(baseFirewallRules(22, { mail: false, dns: false })), [
      "tcp/22", "tcp/80", "tcp/443",
    ]);
  });
});

describe("new firewall rules", () => {
  const base = baseFirewallRules(22, { mail: true });
  const rule = (action: "allow" | "deny", protocol: "tcp" | "udp" | "any", port: string, source = "any") =>
    firewallRuleProblem({ action, protocol, port, source }, base, 22);

  it("take one port from 1 to 65535", () => {
    assert.equal(isFirewallPort("8080"), true);
    for (const bad of ["0", "65536", "80-90", "80:90", "", "http"]) assert.equal(isFirewallPort(bad), false, bad);
    assert.match(rule("allow", "tcp", "80-90") ?? "", /one number/);
  });

  it("take any, an IPv4 or IPv6 address or a CIDR range as source", () => {
    for (const ok of ["any", "203.0.113.7", "10.0.0.0/8", "2001:db8::1", "2001:db8::/32"]) {
      assert.equal(isFirewallSource(ok), true, ok);
    }
    for (const bad of ["", "everyone", "10.0.0.0/33", "fe80::1%eth0", "example.com"]) {
      assert.equal(isFirewallSource(bad), false, bad);
    }
    assert.match(rule("allow", "tcp", "8080", "example.com") ?? "", /Source/);
  });

  it("never deny SSH to everyone, but may deny it to one source", () => {
    assert.match(rule("deny", "tcp", "22") ?? "", /SSH/);
    assert.match(rule("deny", "any", "22", "0.0.0.0/0") ?? "", /SSH/);
    assert.equal(rule("deny", "tcp", "22", "192.0.2.9"), null);
    assert.equal(rule("deny", "udp", "22"), null);
  });

  it("do not repeat a base rule as a rule of their own", () => {
    assert.match(rule("allow", "tcp", "443") ?? "", /base rule/);
    assert.match(rule("allow", "tcp", "587") ?? "", /base rule/);
    assert.equal(rule("allow", "tcp", "443", "203.0.113.0/24"), null);
    assert.equal(rule("deny", "tcp", "443", "203.0.113.7"), null);
    assert.equal(rule("allow", "udp", "443"), null);
  });

  it("accept a plain allow", () => {
    assert.equal(rule("allow", "tcp", "8080"), null);
  });
});
