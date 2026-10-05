import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRsyncDest,
  assertS3Bucket,
  destinationSummary,
  parseBackupScope,
} from "./backups.ts";

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
