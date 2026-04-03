import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildCheckpoint, formatCheckpointInfo } from "./session-checkpoint.js";

describe("buildCheckpoint", () => {
  it("creates checkpoint with version and timestamp", () => {
    const cp = buildCheckpoint({
      graduation: { test: { mode: "auto", successes: 10, failures: 1, rate: 0.91 } },
      escalation: {},
      velocitySamples: {},
      nudgeRecords: [],
      budgetSamples: {},
      cacheStats: { hits: 5, misses: 3 },
      slaHistory: [80, 75, 85],
      pollInterval: 10_000,
    });
    assert.equal(cp.version, 1);
    assert.ok(cp.savedAt > 0);
    assert.equal(cp.graduation.test.mode, "auto");
    assert.equal(cp.cacheStats.hits, 5);
    assert.equal(cp.slaHistory.length, 3);
  });
});

describe("formatCheckpointInfo", () => {
  it("handles missing checkpoint", () => {
    // will return "no checkpoint found" if file doesn't exist at ~/.aoaoe/checkpoints/
    const lines = formatCheckpointInfo();
    assert.ok(lines.length >= 1);
  });
});
