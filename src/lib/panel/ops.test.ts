import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRsyncDest,
  assertS3Bucket,
  destinationSummary,
  parseBackupScope,
} from "./backup.ts";
import { dnsValuesMatch, normalizeDnsValue } from "./dns-check.ts";
import { hashMailboxPassword, verifyMailboxPassword } from "./mail-pass.ts";
import {
  assertCronCommand,
  assertCronSchedule,
  generateMailboxPassword,
  isIpv4,
  normalizeIp,
} from "./net.ts";

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

describe("IP + cron", () => {
  it("accepts dotted IPv4 and five-field cron", () => {
    assert.equal(isIpv4("203.0.113.10"), true);
    assert.equal(isIpv4("256.1.1.1"), false);
    assert.equal(normalizeIp(" 10.0.0.2 "), "10.0.0.2");
    assert.throws(() => normalizeIp("example.com"), /IPv4/);
    assert.equal(assertCronSchedule("*/5 * * * *"), "*/5 * * * *");
    assert.equal(assertCronSchedule("0 3 1 * 0"), "0 3 1 * 0");
    assert.throws(() => assertCronSchedule("0 3 * *"), /five/);
    assert.throws(() => assertCronSchedule("* * * * *; rm"), /five/);
    assert.equal(assertCronCommand("php artisan schedule:run"), "php artisan schedule:run");
    assert.throws(() => assertCronCommand("echo %"), /newlines or %/);
  });
});

describe("backup destinations", () => {
  it("accepts rsync and S3 targets and lists local+remotes together", () => {
    assert.equal(assertRsyncDest("user@offsite.example:/backups/schela"), "user@offsite.example:/backups/schela");
    assert.equal(assertS3Bucket("schela-prod-backups"), "schela-prod-backups");
    assert.throws(() => assertRsyncDest("user@host:/tmp; rm -rf /"), /unsafe/);
    assert.throws(() => assertS3Bucket("no"), /bucket/);
    assert.equal(parseBackupScope("all"), "all");
    assert.deepEqual(destinationSummary({ rsyncEnabled: true, s3Enabled: true }), [
      "local",
      "rsync",
      "s3",
    ]);
    assert.deepEqual(destinationSummary({ rsyncEnabled: false, s3Enabled: false }), ["local"]);
  });
});

describe("redis INFO parse", () => {
  it("reads version and memory from INFO text", async () => {
    const { parseRedisInfo } = await import("./redis.ts");
    const info = parseRedisInfo("# Server\nredis_version:7.0.15\n# Memory\nused_memory_human:1.23M\n");
    assert.equal(info.redis_version, "7.0.15");
    assert.equal(info.used_memory_human, "1.23M");
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
