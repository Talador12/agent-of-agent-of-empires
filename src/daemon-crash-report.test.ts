import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateCrashReport, formatCrashReport, formatCrashReportTui } from "./daemon-crash-report.js";

describe("generateCrashReport", () => {
  it("generates a report with basic info", () => {
    const report = generateCrashReport({ uptimeMs: 7_200_000, tickCount: 500 });
    assert.ok(report.data.timestamp);
    assert.equal(report.data.uptime, "2h0m");
    assert.equal(report.data.tickCount, 500);
    assert.ok(report.filename.startsWith("crash-"));
  });

  it("includes error info when provided", () => {
    const err = new Error("something broke");
    const report = generateCrashReport({ uptimeMs: 1000, tickCount: 5, error: err });
    assert.ok(report.data.error);
    assert.equal(report.data.error!.message, "something broke");
    assert.ok(report.data.error!.stack);
  });

  it("includes recent events", () => {
    const report = generateCrashReport({
      uptimeMs: 1000, tickCount: 1,
      recentEvents: ["event1", "event2", "event3"],
    });
    assert.equal(report.data.recentEvents.length, 3);
  });

  it("limits recent events to 10", () => {
    const events = Array.from({ length: 20 }, (_, i) => `event-${i}`);
    const report = generateCrashReport({ uptimeMs: 1000, tickCount: 1, recentEvents: events });
    assert.equal(report.data.recentEvents.length, 10);
  });

  it("includes active sessions", () => {
    const report = generateCrashReport({
      uptimeMs: 1000, tickCount: 1,
      activeSessions: ["alpha", "beta"],
    });
    assert.equal(report.data.activeSessions.length, 2);
  });

  it("sanitizes config secrets", () => {
    const report = generateCrashReport({
      uptimeMs: 1000, tickCount: 1,
      config: { pollIntervalMs: 10000, apiKey: "sk-secret-123", nested: { secretToken: "abc" } },
    });
    assert.equal(report.data.config.pollIntervalMs, 10000);
    assert.equal(report.data.config.apiKey, "[REDACTED]");
    assert.equal((report.data.config.nested as Record<string, unknown>).secretToken, "[REDACTED]");
  });

  it("includes memory usage", () => {
    const report = generateCrashReport({ uptimeMs: 1000, tickCount: 1 });
    assert.ok(report.data.memoryUsage.heapUsedMB >= 0);
    assert.ok(report.data.memoryUsage.rssMB >= 0);
  });

  it("includes health score and incidents", () => {
    const report = generateCrashReport({
      uptimeMs: 1000, tickCount: 1,
      healthScore: 75, unresolvedIncidents: 3,
    });
    assert.equal(report.data.healthScore, 75);
    assert.equal(report.data.unresolvedIncidents, 3);
  });
});

describe("formatCrashReport", () => {
  it("produces readable text", () => {
    const report = generateCrashReport({ uptimeMs: 3_600_000, tickCount: 100, error: new Error("test") });
    const text = formatCrashReport(report.data);
    assert.ok(text.includes("CRASH REPORT"));
    assert.ok(text.includes("test"));
    assert.ok(text.includes("1h0m"));
  });
});

describe("formatCrashReportTui", () => {
  it("shows preview with filename", () => {
    const report = generateCrashReport({ uptimeMs: 1000, tickCount: 1 });
    const lines = formatCrashReportTui(report);
    assert.ok(lines[0].includes("Crash Report"));
    assert.ok(lines[0].includes("crash-"));
  });
});
