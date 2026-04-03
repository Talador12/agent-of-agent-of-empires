import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { TokenQuotaManager } from "./token-quota.js";

describe("TokenQuotaManager", () => {
  it("starts unblocked with no quotas", () => {
    const mgr = new TokenQuotaManager();
    assert.equal(mgr.isBlocked("claude-sonnet"), false);
  });

  it("blocks when input quota exceeded", () => {
    const mgr = new TokenQuotaManager([{ model: "claude", maxInputTokensPerHour: 10_000, maxOutputTokensPerHour: 5_000 }]);
    const now = Date.now();
    mgr.recordUsage("claude", 11_000, 100, now);
    assert.equal(mgr.isBlocked("claude", now), true);
  });

  it("blocks when output quota exceeded", () => {
    const mgr = new TokenQuotaManager([{ model: "claude", maxInputTokensPerHour: 100_000, maxOutputTokensPerHour: 5_000 }]);
    const now = Date.now();
    mgr.recordUsage("claude", 1_000, 6_000, now);
    assert.equal(mgr.isBlocked("claude", now), true);
  });

  it("tracks usage within hourly window", () => {
    const mgr = new TokenQuotaManager([{ model: "test", maxInputTokensPerHour: 50_000, maxOutputTokensPerHour: 10_000 }]);
    const now = Date.now();
    mgr.recordUsage("test", 5_000, 1_000, now);
    mgr.recordUsage("test", 3_000, 500, now + 60_000);
    const status = mgr.getStatus("test", now + 60_000);
    assert.equal(status.inputTokensUsed, 8_000);
    assert.equal(status.outputTokensUsed, 1_500);
    assert.equal(status.blocked, false);
  });

  it("old usage falls out of window", () => {
    const mgr = new TokenQuotaManager([{ model: "test", maxInputTokensPerHour: 10_000, maxOutputTokensPerHour: 5_000 }]);
    const now = Date.now();
    mgr.recordUsage("test", 11_000, 100, now - 2 * 3_600_000); // 2h ago
    mgr.recordUsage("test", 1_000, 100, now); // recent
    assert.equal(mgr.isBlocked("test", now), false); // old usage expired
  });

  it("setQuota adds new model quota", () => {
    const mgr = new TokenQuotaManager();
    mgr.setQuota("gemini", 100_000, 20_000);
    const status = mgr.getStatus("gemini");
    assert.equal(status.inputLimit, 100_000);
    assert.equal(status.blocked, false);
  });

  it("getAllStatuses returns all models", () => {
    const mgr = new TokenQuotaManager([
      { model: "a", maxInputTokensPerHour: 10_000, maxOutputTokensPerHour: 5_000 },
      { model: "b", maxInputTokensPerHour: 20_000, maxOutputTokensPerHour: 10_000 },
    ]);
    assert.equal(mgr.getAllStatuses().length, 2);
  });

  it("formatAll shows model quotas", () => {
    const mgr = new TokenQuotaManager([{ model: "claude", maxInputTokensPerHour: 100_000, maxOutputTokensPerHour: 20_000 }]);
    mgr.recordUsage("claude", 50_000, 10_000);
    const lines = mgr.formatAll();
    assert.ok(lines.some((l) => l.includes("claude")));
    assert.ok(lines.some((l) => l.includes("50,000")));
  });

  it("formatAll handles empty", () => {
    const mgr = new TokenQuotaManager();
    const lines = mgr.formatAll();
    assert.ok(lines[0].includes("no token quotas"));
  });

  it("reports correct percentages", () => {
    const mgr = new TokenQuotaManager([{ model: "test", maxInputTokensPerHour: 10_000, maxOutputTokensPerHour: 10_000 }]);
    mgr.recordUsage("test", 5_000, 2_500);
    const status = mgr.getStatus("test");
    assert.equal(status.inputPercent, 50);
    assert.equal(status.outputPercent, 25);
  });
});
