import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { ProgressVelocityTracker } from "./progress-velocity.js";

describe("ProgressVelocityTracker", () => {
  it("returns null with fewer than 2 samples", () => {
    const tracker = new ProgressVelocityTracker();
    tracker.recordProgress("test", 10);
    assert.equal(tracker.estimate("test"), null);
  });

  it("computes velocity from 2 samples", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("test", 10, now - 3_600_000); // 10% 1h ago
    tracker.recordProgress("test", 30, now); // 30% now

    const est = tracker.estimate("test", now);
    assert.ok(est);
    assert.equal(est.currentPercent, 30);
    assert.ok(Math.abs(est.velocityPerHour - 20) < 1); // 20%/hr
    assert.ok(est.etaMs > 0);
    assert.ok(est.etaLabel !== "stalled");
  });

  it("detects stalled progress", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("test", 50, now - 7_200_000);
    tracker.recordProgress("test", 50.01, now); // barely moved

    const est = tracker.estimate("test", now);
    assert.ok(est);
    assert.equal(est.trend, "stalled");
  });

  it("reports done at 100%", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("test", 50, now - 3_600_000);
    tracker.recordProgress("test", 100, now);

    const est = tracker.estimate("test", now);
    assert.ok(est);
    assert.equal(est.etaLabel, "done");
    assert.equal(est.etaMs, 0);
  });

  it("deduplicates same % samples", () => {
    const tracker = new ProgressVelocityTracker();
    tracker.recordProgress("test", 50);
    tracker.recordProgress("test", 50);
    tracker.recordProgress("test", 50);
    assert.equal(tracker.getSampleCount("test"), 1);
  });

  it("estimateAll returns all tracked tasks", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("a", 10, now - 60_000);
    tracker.recordProgress("a", 20, now);
    tracker.recordProgress("b", 30, now - 60_000);
    tracker.recordProgress("b", 60, now);
    const all = tracker.estimateAll(now);
    assert.equal(all.length, 2);
  });

  it("formatAll handles empty", () => {
    const tracker = new ProgressVelocityTracker();
    const lines = tracker.formatAll();
    assert.ok(lines[0].includes("no velocity data"));
  });

  it("formatAll shows velocity info", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("adventure", 20, now - 3_600_000);
    tracker.recordProgress("adventure", 50, now);
    const lines = tracker.formatAll(now);
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("%/hr")));
  });

  it("detects acceleration trend", () => {
    const tracker = new ProgressVelocityTracker(24 * 3_600_000); // 24h window
    const now = Date.now();
    // very slow first half, very fast second half
    tracker.recordProgress("test", 5, now - 6 * 3_600_000);
    tracker.recordProgress("test", 6, now - 5 * 3_600_000);
    tracker.recordProgress("test", 7, now - 4 * 3_600_000);
    tracker.recordProgress("test", 8, now - 3 * 3_600_000); // 1%/hr first half
    tracker.recordProgress("test", 30, now - 2 * 3_600_000);
    tracker.recordProgress("test", 60, now - 1 * 3_600_000);
    tracker.recordProgress("test", 90, now);              // 30%/hr second half
    const est = tracker.estimate("test", now);
    assert.ok(est);
    assert.equal(est.trend, "accelerating");
  });
});
