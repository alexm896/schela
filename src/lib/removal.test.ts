import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertConfirmed,
  chosen,
  group,
  initialSelection,
  option,
  toggleOption,
  type RemovalPlan,
} from "./removal.ts";

type Key = "dns" | "files" | "databases";

const plan: RemovalPlan<Key> = {
  confirm: "shop.example",
  alsoRemoved: [{ label: "Cron jobs", items: ["nightly"] }],
  options: [
    { key: "dns", label: "DNS records", items: ["A shop.example"], defaultOn: true },
    { key: "files", label: "Files", items: ["/home/s_shop_example"], defaultOn: false },
  ],
  notes: [],
};

describe("removal plans", () => {
  it("starts with configuration ticked and data unticked", () => {
    assert.deepEqual(initialSelection(plan), ["dns"]);
  });

  it("ticks and unticks one option at a time", () => {
    assert.deepEqual(toggleOption(["dns"], "files", true), ["dns", "files"]);
    assert.deepEqual(toggleOption(["dns", "files"], "dns", false), ["files"]);
    assert.deepEqual(toggleOption(["dns"], "dns", true), ["dns"]);
  });

  it("only honours options the plan offers", () => {
    assert.deepEqual([...chosen(plan, ["files", "databases"])], ["files"]);
  });

  it("leaves out empty groups and options", () => {
    assert.deepEqual(group("Workers", []), []);
    assert.deepEqual(option("databases", "Databases", [], false), []);
    assert.deepEqual(option("databases", "Databases", ["shop"], false), [
      { key: "databases", label: "Databases", items: ["shop"], defaultOn: false },
    ]);
  });

  it("asks for the exact text when the plan wants it typed", () => {
    assert.throws(() => assertConfirmed(plan, "shop"), /Type shop.example to confirm/);
    assert.throws(() => assertConfirmed(plan, undefined), /Type shop.example to confirm/);
    assert.doesNotThrow(() => assertConfirmed(plan, " shop.example "));
    assert.doesNotThrow(() => assertConfirmed({ ...plan, confirm: null }, undefined));
  });
});
