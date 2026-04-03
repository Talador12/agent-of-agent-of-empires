import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { NudgeTracker } from "./nudge-tracker.js";

describe("NudgeTracker", () => {
  it("starts with no nudges", () => {
    const tracker = new NudgeTracker();
    const r = tracker.getReport();
    assert.equal(r.totalNudges, 0);
    assert.equal(r.effectivenessRate, 0);
  });

  it("records nudges", () => {
    const tracker = new NudgeTracker();
    tracker.recordNudge("test", "are you stuck?");
    assert.equal(tracker.getReport().totalNudges, 1);
    assert.equal(tracker.getReport().pendingNudges, 1);
  });

  it("marks nudge effective when progress follows within window", () => {
    const tracker = new NudgeTracker(10 * 60_000); // 10min window
    const now = Date.now();
    tracker.recordNudge("test", "check status", now);
    tracker.recordProgress("test", now + 5 * 60_000); // 5min later
    const r = tracker.getReport(now + 5 * 60_000);
    assert.equal(r.effectiveNudges, 1);
    assert.equal(r.effectivenessRate, 1);
  });

  it("marks nudge ineffective after window expires", () => {
    const tracker = new NudgeTracker(5 * 60_000); // 5min window
    const now = Date.now();
    tracker.recordNudge("test", "check status", now);
    // no progress within window
    const r = tracker.getReport(now + 10 * 60_000); // 10min later
    assert.equal(r.ineffectiveNudges, 1);
    assert.equal(r.effectivenessRate, 0);
  });

  it("tracks multiple sessions independently", () => {
    const tracker = new NudgeTracker(10 * 60_000);
    const now = Date.now();
    tracker.recordNudge("a", "nudge a", now);
    tracker.recordNudge("b", "nudge b", now);
    tracker.recordProgress("a", now + 60_000);
    // b has no progress
    const r = tracker.getReport(now + 15 * 60_000);
    assert.equal(r.effectiveNudges, 1);
    assert.equal(r.ineffectiveNudges, 1);
  });

  it("computes average response time", () => {
    const tracker = new NudgeTracker(30 * 60_000);
    const now = Date.now();
    tracker.recordNudge("a", "n1", now);
    tracker.recordProgress("a", now + 5 * 60_000); // 5min
    tracker.recordNudge("b", "n2", now);
    tracker.recordProgress("b", now + 10 * 60_000); // 10min
    const r = tracker.getReport(now + 10 * 60_000);
    assert.ok(r.avgResponseTimeMs > 0);
    // avg of 5min and 10min = 7.5min = 450_000ms
    assert.ok(Math.abs(r.avgResponseTimeMs - 450_000) < 1000);
  });

  it("only resolves most recent nudge per session", () => {
    const tracker = new NudgeTracker(30 * 60_000);
    const now = Date.now();
    tracker.recordNudge("test", "first", now);
    tracker.recordNudge("test", "second", now + 60_000);
    tracker.recordProgress("test", now + 120_000);
    const r = tracker.getReport(now + 35 * 60_000);
    assert.equal(r.effectiveNudges, 1); // only second nudge resolved
    assert.equal(r.ineffectiveNudges, 1); // first nudge expired
  });

  it("formatReport handles empty", () => {
    const tracker = new NudgeTracker();
    const lines = tracker.formatReport();
    assert.ok(lines[0].includes("no nudges"));
  });

  it("formatReport shows stats", () => {
    const tracker = new NudgeTracker(10 * 60_000);
    const now = Date.now();
    tracker.recordNudge("test", "msg", now);
    tracker.recordProgress("test", now + 60_000);
    const lines = tracker.formatReport(now + 60_000);
    assert.ok(lines.some((l) => l.includes("100%") || l.includes("effectiveness")));
  });
});
