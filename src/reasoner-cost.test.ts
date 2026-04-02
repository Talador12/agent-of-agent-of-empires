import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { estimateCallCost, parseTokenUsage, ReasonerCostTracker } from "./reasoner-cost.js";

describe("estimateCallCost", () => {
  it("computes cost from token counts", () => {
    // 1000 input @ $3/M + 500 output @ $15/M = 0.003 + 0.0075 = 0.0105
    const cost = estimateCallCost(1000, 500);
    assert.ok(Math.abs(cost - 0.0105) < 0.0001);
  });

  it("returns 0 for zero tokens", () => {
    assert.equal(estimateCallCost(0, 0), 0);
  });

  it("handles large token counts", () => {
    const cost = estimateCallCost(200_000, 8_000);
    assert.ok(cost > 0);
    assert.ok(cost < 10); // sanity check
  });
});

describe("parseTokenUsage", () => {
  it("parses 'N input tokens, M output tokens'", () => {
    const result = parseTokenUsage("used 1,234 input tokens, 567 output tokens");
    assert.ok(result);
    assert.equal(result.input, 1234);
    assert.equal(result.output, 567);
  });

  it("parses 'tokens: N/M'", () => {
    const result = parseTokenUsage("tokens: 5000/1200");
    assert.ok(result);
    assert.equal(result.input, 5000);
    assert.equal(result.output, 1200);
  });

  it("returns null for no token info", () => {
    assert.equal(parseTokenUsage("no relevant info here"), null);
  });

  it("handles commas in numbers", () => {
    const result = parseTokenUsage("12,345 input tokens and 6,789 output tokens");
    assert.ok(result);
    assert.equal(result.input, 12345);
    assert.equal(result.output, 6789);
  });
});

describe("ReasonerCostTracker", () => {
  it("starts with zero calls", () => {
    const tracker = new ReasonerCostTracker();
    assert.equal(tracker.callCount, 0);
  });

  it("records calls and computes summary", () => {
    const tracker = new ReasonerCostTracker();
    const now = Date.now();
    tracker.recordCall("test", 5000, 1000, 2000, now);
    tracker.recordCall("test", 3000, 800, 1500, now + 60_000);

    const summary = tracker.getSummary(now + 60_000);
    assert.equal(summary.totalCalls, 2);
    assert.equal(summary.totalInputTokens, 8000);
    assert.equal(summary.totalOutputTokens, 1800);
    assert.ok(summary.totalCostUsd > 0);
    assert.ok(summary.avgInputTokens > 0);
    assert.ok(summary.callsPerHour > 0);
  });

  it("prunes old calls", () => {
    const tracker = new ReasonerCostTracker(60_000); // 1 min window
    const now = Date.now();
    tracker.recordCall("test", 1000, 100, 500, now - 120_000); // 2 min ago
    tracker.recordCall("test", 2000, 200, 600, now);

    const summary = tracker.getSummary(now);
    assert.equal(summary.totalCalls, 1); // old call pruned
  });

  it("formatSummary handles empty tracker", () => {
    const tracker = new ReasonerCostTracker();
    const lines = tracker.formatSummary();
    assert.ok(lines[0].includes("no reasoner calls"));
  });

  it("formatSummary shows cost info", () => {
    const tracker = new ReasonerCostTracker();
    tracker.recordCall("test", 5000, 1000, 2000);
    const lines = tracker.formatSummary();
    assert.ok(lines.some((l) => l.includes("$")));
    assert.ok(lines.some((l) => l.includes("Tokens")));
  });

  it("computes cost per hour", () => {
    const tracker = new ReasonerCostTracker();
    const now = Date.now();
    // 10 calls over 1 hour
    for (let i = 0; i < 10; i++) {
      tracker.recordCall("test", 5000, 1000, 2000, now - (9 - i) * 6 * 60_000);
    }
    const summary = tracker.getSummary(now);
    assert.ok(summary.callsPerHour > 5 && summary.callsPerHour < 15);
    assert.ok(summary.costPerHour > 0);
  });
});
