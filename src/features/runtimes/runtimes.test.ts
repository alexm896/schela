import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NODE_CATALOG, PHP_CATALOG, RUNTIME_CATALOG } from "./catalog.ts";
import {
  defaultVersion,
  nodeMajors,
  selectableVersions,
  versionAllowed,
  versionOptions,
  type RuntimeCatalog,
} from "./runtimes.ts";

const php: RuntimeCatalog = {
  supported: ["8.2", "8.3", "8.4", "8.5"],
  retired: ["8.1"],
  default: "8.3",
};

describe("version catalog (installer/versions.json)", () => {
  it("offers PHP 8.2 to 8.5 and retires 8.1", () => {
    assert.deepEqual(PHP_CATALOG.supported, ["8.2", "8.3", "8.4", "8.5"]);
    assert.deepEqual(PHP_CATALOG.retired, ["8.1"]);
  });

  it("offers Node 22, 24, 26 with 26 as default and retires 18 and 20", () => {
    assert.deepEqual(NODE_CATALOG.supported, ["22", "24", "26"]);
    assert.deepEqual(NODE_CATALOG.retired, ["18", "20"]);
    assert.equal(NODE_CATALOG.default, "26");
  });

  it("is consistent for every runtime", () => {
    for (const [name, c] of Object.entries(RUNTIME_CATALOG)) {
      assert.ok(c.supported.includes(c.default), `${name}: default must be supported`);
      for (const v of c.retired) assert.ok(!c.supported.includes(v), `${name}: ${v} is both`);
      for (const v of [...c.supported, ...c.retired]) {
        assert.match(v, name === "php" ? /^\d+\.\d+$/ : /^\d+$/, `${name}: bad version ${v}`);
      }
    }
  });
});

describe("selectableVersions", () => {
  it("offers every supported version when the box was not checked (local dev)", () => {
    assert.deepEqual(selectableVersions(php), ["8.2", "8.3", "8.4", "8.5"]);
  });

  it("offers only supported versions that are installed", () => {
    assert.deepEqual(selectableVersions(php, ["8.1", "8.3", "8.5"]), ["8.3", "8.5"]);
  });

  it("never offers a retired version, even when installed", () => {
    assert.ok(!selectableVersions(php, ["8.1", "8.2"]).includes("8.1"));
  });
});

describe("defaultVersion", () => {
  it("uses the catalog default when it can be picked", () => {
    assert.equal(defaultVersion(php, ["8.2", "8.3", "8.5"]), "8.3");
  });

  it("falls back to the newest pickable version", () => {
    assert.equal(defaultVersion(php, ["8.4", "8.5"]), "8.5");
  });
});

describe("versionAllowed", () => {
  const selectable = ["8.2", "8.3", "8.4", "8.5"];

  it("allows a supported version for a new site", () => {
    assert.ok(versionAllowed(selectable, "8.5"));
  });

  it("refuses a retired version for a new site", () => {
    assert.ok(!versionAllowed(selectable, "8.1"));
  });

  it("refuses an unknown version", () => {
    assert.ok(!versionAllowed(selectable, "7.4"));
    assert.ok(!versionAllowed(selectable, "8.5; rm -rf /"));
  });

  it("lets a site on a retired version keep it", () => {
    assert.ok(versionAllowed(selectable, "8.1", "8.1"));
  });

  it("refuses switching back to a retired version", () => {
    assert.ok(!versionAllowed(selectable, "8.1", "8.3"));
  });

  it("allows moving off a retired version", () => {
    assert.ok(versionAllowed(selectable, "8.4", "8.1"));
  });
});

describe("versionOptions", () => {
  it("lists the selectable versions", () => {
    assert.deepEqual(
      versionOptions(php, ["8.4", "8.5"]).map((o) => [o.value, o.disabled]),
      [
        ["8.4", false],
        ["8.5", false],
      ],
    );
  });

  it("shows a retired current version as disabled", () => {
    assert.deepEqual(versionOptions(php, ["8.4"], "8.1")[0], {
      value: "8.1",
      disabled: true,
      note: "retired",
    });
  });

  it("shows a supported but uninstalled current version as disabled", () => {
    assert.deepEqual(versionOptions(php, ["8.4"], "8.2")[0], {
      value: "8.2",
      disabled: true,
      note: "not installed",
    });
  });

  it("does not repeat a current version that is selectable", () => {
    assert.equal(versionOptions(php, ["8.4", "8.5"], "8.5").length, 2);
  });
});

describe("nodeMajors", () => {
  it("reads majors from n's cache folders", () => {
    assert.deepEqual(nodeMajors(["22.23.5", "24.11.1", "26.2.0", "22.1.0"]).sort(), [
      "22",
      "24",
      "26",
    ]);
  });

  it("ignores anything that is not a version folder", () => {
    assert.deepEqual(nodeMajors([".DS_Store", "lts", "24", "v24.1.0"]), []);
  });
});
