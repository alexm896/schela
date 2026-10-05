import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertCronCommand, assertCronSchedule } from "./cron.ts";

describe("cron", () => {
  it("accepts five-field schedules and safe commands", () => {
    assert.equal(assertCronSchedule("*/5 * * * *"), "*/5 * * * *");
    assert.equal(assertCronSchedule("0 3 1 * 0"), "0 3 1 * 0");
    assert.throws(() => assertCronSchedule("0 3 * *"), /five/);
    assert.throws(() => assertCronSchedule("* * * * *; rm"), /five/);
    assert.equal(assertCronCommand("php artisan schedule:run"), "php artisan schedule:run");
    assert.throws(() => assertCronCommand("echo %"), /newlines or %/);
  });
});
