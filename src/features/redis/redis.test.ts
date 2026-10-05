import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRedisInfo } from "./redis.ts";

describe("redis INFO parse", () => {
  it("reads version and memory from INFO text", () => {
    const info = parseRedisInfo("# Server\nredis_version:7.0.15\n# Memory\nused_memory_human:1.23M\n");
    assert.equal(info.redis_version, "7.0.15");
    assert.equal(info.used_memory_human, "1.23M");
  });
});
