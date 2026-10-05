import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appVirtRoot,
  assertEntryName,
  assertVirtRoot,
  classifyName,
  formatSize,
  parseMode,
  splitRel,
  virtJoin,
  virtNormalize,
  virtParent,
} from "./file-types.ts";
import {
  joinJail,
  localChmod,
  localCopy,
  localCreate,
  localDelete,
  localList,
  localMkdir,
  localRead,
  localRename,
  localWrite,
} from "./files.ts";

async function withJail<T>(run: (jail: string) => Promise<T>): Promise<T> {
  const jail = await mkdtemp(join(tmpdir(), "schela-fm-"));
  try {
    return await run(jail);
  } finally {
    await rm(jail, { recursive: true, force: true });
  }
}

describe("path jail", () => {
  it("normalizes relative paths and rejects escapes", () => {
    assert.deepEqual(splitRel("/css/./style.css"), ["css", "style.css"]);
    assert.deepEqual(splitRel("a//b"), ["a", "b"]);
    assert.equal(virtNormalize(""), "/");
    assert.equal(virtNormalize("/"), "/");
    assert.equal(virtNormalize("css/style.css"), "/css/style.css");
    assert.equal(virtParent("/css/style.css"), "/css");
    assert.equal(virtParent("/css"), "/");
    assert.equal(virtParent("/"), null);
    assert.equal(virtJoin("/", "index.php"), "/index.php");
    assert.equal(virtJoin("/css", "app.css"), "/css/app.css");
    assert.throws(() => splitRel("../etc/passwd"), /outside this account/);
    assert.throws(() => splitRel("foo/../../etc"), /outside this account/);
    assert.throws(() => splitRel("foo\0bar"), /Invalid/);
    assert.throws(() => splitRel("C:\\Windows"), /Absolute/);
    assert.throws(() => assertEntryName("a/b"), /slashes/);
    assert.throws(() => assertEntryName(".."), /Invalid/);
    assert.throws(() => assertVirtRoot("/etc/passwd"), /Home directory/);
    assert.throws(() => assertVirtRoot("/home/../www"), /Home directory/);
    assert.equal(assertVirtRoot("/home/s_site/www"), "/home/s_site/www");
    assert.equal(appVirtRoot("API Example"), "/home/sa_api-example/app");
  });

  it("joinJail stays inside the physical root", async () => {
    await withJail(async (jail) => {
      assert.equal(joinJail(jail, "a/b"), join(jail, "a", "b"));
      assert.equal(joinJail(jail, "/"), jail);
      assert.throws(() => joinJail(jail, "../outside"), /outside this account/);
    });
  });
});

describe("classify + format", () => {
  it("marks hosting source as editable and images as previews", () => {
    assert.deepEqual(classifyName("index.php"), { editable: true, preview: "text" });
    assert.deepEqual(classifyName(".htaccess"), { editable: true, preview: "text" });
    assert.deepEqual(classifyName(".env"), { editable: true, preview: "text" });
    assert.deepEqual(classifyName("logo.png"), { editable: false, preview: "image" });
    assert.deepEqual(classifyName("icon.svg"), { editable: true, preview: "image" });
    assert.deepEqual(classifyName("dump.sql.gz"), { editable: false, preview: "none" });
    assert.equal(formatSize(800), "800 B");
    assert.equal(formatSize(2048), "2.0 KB");
    assert.equal(parseMode("644"), 0o644);
    assert.equal(parseMode("0755"), 0o755);
    assert.throws(() => parseMode("999"), /octal/);
  });
});

describe("local file ops", () => {
  it("lists, writes, reads, renames, copies, and deletes inside the jail", async () => {
    await withJail(async (jail) => {
      await localMkdir(jail, "css");
      await localWrite(jail, "index.php", "<?php echo 'ok';\n", "utf8");
      await localWrite(jail, "css/style.css", "body{}\n", "utf8");
      await localCreate(jail, ".env");

      const listing = await localList(jail, "/");
      assert.equal(listing.path, "/");
      assert.equal(listing.parent, null);
      const names = listing.entries.map((e) => e.name);
      assert.deepEqual(names, ["css", ".env", "index.php"]);
      assert.equal(listing.entries.find((e) => e.name === "css")?.kind, "dir");
      assert.equal(listing.entries.find((e) => e.name === ".env")?.hidden, true);

      const read = await localRead(jail, "index.php");
      assert.equal(read.encoding, "utf8");
      assert.match(read.content, /echo 'ok'/);
      assert.equal(read.editable, true);

      await localRename(jail, "index.php", "app.php");
      await localCopy(jail, "app.php", "app.copy.php");
      const copied = await localRead(jail, "app.copy.php");
      assert.match(copied.content, /echo 'ok'/);

      await localDelete(jail, "app.copy.php");
      const after = await localList(jail, "/");
      assert.equal(
        after.entries.some((e) => e.name === "app.copy.php"),
        false,
      );
      assert.equal(
        after.entries.some((e) => e.name === "app.php"),
        true,
      );
    });
  });

  it("refuses to delete the jail root and blocks binary as text", async () => {
    await withJail(async (jail) => {
      await assert.rejects(() => localDelete(jail, "/"), /home directory/);
      await assert.rejects(() => localRename(jail, "/", "other"), /home directory/);
      await writeFile(join(jail, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 9]));
      await assert.rejects(() => localRead(jail, "blob.bin"), /Binary/);
      const down = await localRead(jail, "blob.bin", { binary: true });
      assert.equal(down.encoding, "base64");
      assert.equal(Buffer.from(down.content, "base64").equals(Buffer.from([0, 1, 2, 3, 0, 9])), true);
    });
  });

  it("does not follow a symlink out of the jail", async () => {
    if (process.platform === "win32") return;
    await withJail(async (jail) => {
      const outside = await mkdtemp(join(tmpdir(), "schela-fm-out-"));
      try {
        await writeFile(join(outside, "secret.txt"), "classified");
        await symlink(join(outside, "secret.txt"), join(jail, "leak.txt"));
        const listing = await localList(jail, "/");
        const leak = listing.entries.find((e) => e.name === "leak.txt");
        assert.equal(leak?.unsafe, true);
        await assert.rejects(() => localRead(jail, "leak.txt"), /outside the account/);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("creates exclusive files and nested writes stay jailed", async () => {
    await withJail(async (jail) => {
      await localCreate(jail, "notes.txt");
      await assert.rejects(() => localCreate(jail, "notes.txt"));
      await mkdir(join(jail, "css"));
      await localWrite(jail, "/css/ok.css", "x", "utf8");
      const body = await readFile(join(jail, "css", "ok.css"), "utf8");
      assert.equal(body, "x");
      await assert.rejects(() => localWrite(jail, "/css/../secret", "x", "utf8"), /outside this account/);
      await localChmod(jail, "notes.txt", "0644").catch((err: unknown) => {
        if (process.platform !== "win32") throw err;
      });
    });
  });
});
