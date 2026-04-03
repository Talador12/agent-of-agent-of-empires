import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetUtilizationTracker } from "./fleet-utilization.js";

describe("FleetUtilizationTracker", () => {
  it("starts with no data", () => {
    const tracker = new FleetUtilizationTracker();
    const report = tracker.getReport();
    assert.equal(report.totalEvents, 0);
    assert.equal(report.activeSessions.size, 0);
  });

  it("records events and tracks sessions", () => {
    const tracker = new FleetUtilizationTracker();
    tracker.recordEvent("a");
    tracker.recordEvent("b");
    tracker.recordEvent("a");
    const report = tracker.getReport();
    assert.equal(report.totalEvents, 3);
    assert.equal(report.activeSessions.size, 2);
  });

  it("assigns events to correct hour buckets", () => {
    const tracker = new FleetUtilizationTracker();
    const now = new Date();
    const currentHour = now.getHours();
    tracker.recordEvent("test", now.getTime());
    tracker.recordEvent("test", now.getTime());
    const report = tracker.getReport(now.getTime());
    assert.equal(report.hourly[currentHour].eventCount, 2);
  });

  it("identifies peak and quiet hours", () => {
    const tracker = new FleetUtilizationTracker();
    const now = Date.now();
    // cluster events at a specific hour
    const target = new Date(now);
    target.setHours(14, 0, 0, 0);
    for (let i = 0; i < 10; i++) tracker.recordEvent("test", target.getTime() + i * 1000);
    const report = tracker.getReport(now);
    assert.equal(report.peakHour, 14);
  });

  it("prunes events outside window", () => {
    const tracker = new FleetUtilizationTracker(60_000); // 1 min window
    const now = Date.now();
    tracker.recordEvent("old", now - 120_000); // 2 min ago
    tracker.recordEvent("new", now);
    const report = tracker.getReport(now);
    assert.equal(report.totalEvents, 1);
  });

  it("formatHeatmap handles empty", () => {
    const tracker = new FleetUtilizationTracker();
    const lines = tracker.formatHeatmap();
    assert.ok(lines[0].includes("no utilization data"));
  });

  it("formatHeatmap shows sparkline when populated", () => {
    const tracker = new FleetUtilizationTracker();
    for (let i = 0; i < 20; i++) tracker.recordEvent("test");
    const lines = tracker.formatHeatmap();
    assert.ok(lines.some((l) => l.includes("Fleet utilization")));
    assert.ok(lines.length >= 3);
  });

  it("tracks unique sessions per hour", () => {
    const tracker = new FleetUtilizationTracker();
    const now = Date.now();
    tracker.recordEvent("a", now);
    tracker.recordEvent("b", now);
    tracker.recordEvent("a", now); // duplicate session
    const report = tracker.getReport(now);
    const currentHour = new Date(now).getHours();
    assert.equal(report.hourly[currentHour].sessionCount, 2);
  });
});
