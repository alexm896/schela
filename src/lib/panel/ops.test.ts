import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRsyncDest,
  assertS3Bucket,
  destinationSummary,
  parseBackupScope,
} from "./backup.ts";

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
