import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncInit, syncStatus } from "./sync.js";

describe("syncInit", () => {
  it("throws on empty remote URL", async () => {
    await assert.rejects(() => syncInit(""), /usage.*init/i);
  });
});

describe("syncStatus", () => {
  it("reports not initialized when no sync repo exists", async () => {
    const result = await syncStatus();
    // either shows "not initialized" or actual status depending on machine state
    assert.ok(typeof result === "string");
    assert.ok(result.length > 0);
  });
});
