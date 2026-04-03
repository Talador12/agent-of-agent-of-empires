import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SessionHealthHistory, formatHealthHistory } from "./session-health-history.js";

describe("SessionHealthHistory", () => {
  it("starts with no data", () => {
    const h = new SessionHealthHistory();
    assert.equal(h.getSampleCount("a"), 0);
    assert.equal(h.getTrend("a"), null);
  });

  it("requires 2+ samples for a trend", () => {
    const h = new SessionHealthHistory();
    h.record("a", 80, 1000);
    assert.equal(h.getTrend("a"), null);
  });

  it("computes trend from health samples", () => {
    const h = new SessionHealthHistory();
    h.record("a", 60, 1000);
    h.record("a", 70, 2000);
    h.record("a", 80, 3000);
    h.record("a", 90, 4000);
    const trend = h.getTrend("a");
    assert.ok(trend);
    assert.equal(trend!.trend, "improving");
    assert.equal(trend!.currentScore, 90);
    assert.equal(trend!.sampleCount, 4);
  });

  it("detects degrading trend", () => {
    const h = new SessionHealthHistory();
    h.record("a", 90, 1000);
    h.record("a", 80, 2000);
    h.record("a", 60, 3000);
    h.record("a", 40, 4000);
    const trend = h.getTrend("a");
    assert.ok(trend);
    assert.equal(trend!.trend, "degrading");
  });

  it("detects stable trend", () => {
    const h = new SessionHealthHistory();
    h.record("a", 75, 1000);
    h.record("a", 74, 2000);
    h.record("a", 76, 3000);
    h.record("a", 75, 4000);
    const trend = h.getTrend("a");
    assert.ok(trend);
    assert.equal(trend!.trend, "stable");
  });

  it("clamps scores to 0-100", () => {
    const h = new SessionHealthHistory();
    h.record("a", -10, 1000);
    h.record("a", 150, 2000);
    const trend = h.getTrend("a");
    assert.ok(trend);
    assert.equal(trend!.minScore, 0);
    assert.equal(trend!.maxScore, 100);
  });

  it("produces sparkline in trend", () => {
    const h = new SessionHealthHistory();
    for (let i = 0; i < 10; i++) h.record("a", 50 + i * 5, i * 1000);
    const trend = h.getTrend("a");
    assert.ok(trend);
    assert.ok(trend!.sparkline.length > 0);
  });

  it("prunes old samples outside window", () => {
    const h = new SessionHealthHistory(10, 5000); // 5s window
    h.record("a", 80, 1000);
    h.record("a", 85, 2000);
    h.record("a", 90, 8000); // both 1000 and 2000 are now >5s ago
    assert.equal(h.getSampleCount("a"), 1); // only 8000 survives
  });

  it("enforces max samples", () => {
    const h = new SessionHealthHistory(5, 3_600_000);
    for (let i = 0; i < 20; i++) h.record("a", 50 + i, i * 1000);
    assert.equal(h.getSampleCount("a"), 5);
  });

  it("getAllTrends returns sorted by worst health first", () => {
    const h = new SessionHealthHistory();
    h.record("healthy", 90, 1000); h.record("healthy", 95, 2000);
    h.record("sick", 20, 1000); h.record("sick", 25, 2000);
    const trends = h.getAllTrends();
    assert.equal(trends.length, 2);
    assert.equal(trends[0].sessionTitle, "sick");
  });
});

describe("formatHealthHistory", () => {
  it("shows no-data message when empty", () => {
    const lines = formatHealthHistory([]);
    assert.ok(lines[0].includes("no data"));
  });

  it("shows trend details", () => {
    const h = new SessionHealthHistory();
    h.record("test", 60, 1000);
    h.record("test", 80, 2000);
    const trends = h.getAllTrends();
    const lines = formatHealthHistory(trends);
    assert.ok(lines.some((l) => l.includes("test")));
    assert.ok(lines.some((l) => l.includes("%")));
  });
});
