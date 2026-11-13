import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertRsyncDest,
  assertS3Bucket,
  assertSshPrivateKey,
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

describe("SSH private key for rsync", () => {
  const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----";
  const rsa = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----";

  it("takes a pasted key, with CRLF line ends, and ends it with a newline", () => {
    assert.equal(assertSshPrivateKey(`  ${key.replace(/\n/g, "\r\n")}\r\n`), `${key}\n`);
    assert.equal(assertSshPrivateKey(rsa), `${rsa}\n`);
  });

  it("is optional", () => {
    assert.equal(assertSshPrivateKey("  "), "");
  });

  it("refuses a path, a public key or a cut key", () => {
    assert.throws(() => assertSshPrivateKey("/root/.ssh/id_ed25519"), /private key/);
    assert.throws(() => assertSshPrivateKey("ssh-ed25519 AAAAC3Nza user@host"), /private key/);
    assert.throws(() => assertSshPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Bl"), /private key/);
  });
});
