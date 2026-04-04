import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildSparkline, detectTrend, buildSparklineEntries, formatSparklineDashboard } from "./goal-sparkline-dashboard.js";

describe("buildSparkline", () => {
  it("returns empty for no values", () => { assert.equal(buildSparkline([]), ""); });
  it("renders increasing values", () => {
    const spark = buildSparkline([10, 20, 30, 40, 50]);
    assert.equal(spark.length, 5);
    assert.ok(spark[0] < spark[4]); // first char should be "lower" than last
  });
  it("renders same values", () => {
    const spark = buildSparkline([50, 50, 50]);
    assert.equal(spark.length, 3);
  });
});

describe("detectTrend", () => {
  it("detects upward trend", () => {
    assert.equal(detectTrend([10, 20, 30, 40, 50]), "up");
  });
  it("detects downward trend", () => {
    assert.equal(detectTrend([50, 40, 30, 20, 10]), "down");
  });
  it("detects flat trend", () => {
    assert.equal(detectTrend([50, 50, 50, 51, 50]), "flat");
  });
  it("returns flat for insufficient data", () => {
    assert.equal(detectTrend([50, 60]), "flat");
  });
});

describe("buildSparklineEntries", () => {
  it("builds entries sorted by progress (worst first)", () => {
    const entries = buildSparklineEntries([
      { title: "fast", progressHistory: [20, 40, 60, 80] },
      { title: "slow", progressHistory: [5, 10, 15, 20] },
    ]);
    assert.equal(entries[0].sessionTitle, "slow");
  });
  it("handles empty input", () => {
    assert.equal(buildSparklineEntries([]).length, 0);
  });
});

describe("formatSparklineDashboard", () => {
  it("shows no-data message when empty", () => {
    const lines = formatSparklineDashboard([]);
    assert.ok(lines[0].includes("no sessions"));
  });
  it("shows sparklines with trends", () => {
    const entries = buildSparklineEntries([
      { title: "alpha", progressHistory: [10, 20, 30, 40, 50] },
    ]);
    const lines = formatSparklineDashboard(entries);
    assert.ok(lines[0].includes("Sparklines"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("↑") || l.includes("→") || l.includes("↓")));
  });
});
