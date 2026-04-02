import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { renderSparkline, ActivityTracker } from "./activity-heatmap.js";

describe("renderSparkline", () => {
  it("returns empty for empty input", () => {
    assert.equal(renderSparkline([]), "");
  });

  it("returns spaces for all zeros", () => {
    assert.equal(renderSparkline([0, 0, 0]), "   ");
  });

  it("renders full blocks for uniform values", () => {
    const result = renderSparkline([5, 5, 5]);
    assert.ok(result.length === 3);
    // all same value -> all same character (max block)
    assert.equal(result[0], result[1]);
    assert.equal(result[1], result[2]);
  });

  it("renders ascending values with ascending blocks", () => {
    const result = renderSparkline([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // first should be space (0), last should be highest block
    assert.equal(result[0], " ");
    assert.ok(result[result.length - 1] !== " ");
  });

  it("handles single value", () => {
    const result = renderSparkline([10]);
    assert.equal(result.length, 1);
    // single value = max, so should be full block
    assert.ok(result !== " ");
  });
});

describe("ActivityTracker", () => {
  it("starts with zero sessions", () => {
    const tracker = new ActivityTracker();
    assert.equal(tracker.sessionCount, 0);
  });

  it("tracks events per session", () => {
    const tracker = new ActivityTracker();
    tracker.recordEvent("session-a");
    tracker.recordEvent("session-b");
    tracker.recordEvent("session-a");
    assert.equal(tracker.sessionCount, 2);
  });

  it("getHeatmap returns buckets with correct counts", () => {
    const tracker = new ActivityTracker(60_000, 5); // 1min buckets, 5 buckets
    const now = Date.now();
    // record 3 events in the current bucket
    tracker.recordEvent("test", now);
    tracker.recordEvent("test", now - 1000);
    tracker.recordEvent("test", now - 2000);
    // record 1 event 2 minutes ago
    tracker.recordEvent("test", now - 2 * 60_000);

    const heatmap = tracker.getHeatmap("test", now);
    assert.equal(heatmap.totalEvents, 4);
    assert.equal(heatmap.peakRate, 3); // 3 events in the latest bucket
    assert.equal(heatmap.sparkline.length, 5); // 5 buckets
  });

  it("prunes events outside the window", () => {
    const tracker = new ActivityTracker(60_000, 5); // 5 min window
    const now = Date.now();
    // event 10 minutes ago should be pruned
    tracker.recordEvent("test", now - 10 * 60_000);
    tracker.recordEvent("test", now);

    const heatmap = tracker.getHeatmap("test", now);
    assert.equal(heatmap.totalEvents, 1); // old event pruned
  });

  it("getAllHeatmaps returns all sessions", () => {
    const tracker = new ActivityTracker();
    tracker.recordEvent("a");
    tracker.recordEvent("b");
    tracker.recordEvent("c");
    const all = tracker.getAllHeatmaps();
    assert.equal(all.length, 3);
  });

  it("returns empty heatmap for unknown session", () => {
    const tracker = new ActivityTracker();
    const heatmap = tracker.getHeatmap("nonexistent");
    assert.equal(heatmap.totalEvents, 0);
    assert.equal(heatmap.peakRate, 0);
  });

  it("format produces readable output", () => {
    const tracker = new ActivityTracker(60_000, 10);
    tracker.recordEvent("adventure");
    tracker.recordEvent("adventure");
    const heatmap = tracker.getHeatmap("adventure");
    const formatted = ActivityTracker.format(heatmap);
    assert.ok(formatted.includes("adventure"));
    assert.ok(formatted.includes("ev"));
  });

  it("formatAll handles empty tracker", () => {
    const tracker = new ActivityTracker();
    const lines = tracker.formatAll();
    assert.ok(lines.some((l) => l.includes("no activity")));
  });

  it("formatAll handles populated tracker", () => {
    const tracker = new ActivityTracker();
    tracker.recordEvent("a");
    tracker.recordEvent("b");
    const lines = tracker.formatAll();
    assert.ok(lines.length >= 3); // header + 2 sessions
  });
});
