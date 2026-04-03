import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { runDiagnostics, formatDiagnostics } from "./daemon-diagnostics.js";

describe("runDiagnostics", () => {
  it("passes with valid config in test mode", () => {
    const report = runDiagnostics({ testMode: true, reasonerBackend: "opencode", pollIntervalMs: 10_000, nodeVersion: "v22.0.0" });
    assert.equal(report.errorCount, 0);
    assert.ok(report.passCount >= 3);
  });

  it("warns on old node version", () => {
    const report = runDiagnostics({ testMode: true, nodeVersion: "v18.0.0" });
    assert.ok(report.checks.some((c) => c.name === "node-version" && c.severity === "error"));
  });

  it("warns on non-standard reasoner", () => {
    const report = runDiagnostics({ testMode: true, reasonerBackend: "custom-llm" });
    assert.ok(report.checks.some((c) => c.name === "reasoner" && c.severity === "warn"));
  });

  it("errors on dangerously fast poll", () => {
    const report = runDiagnostics({ testMode: true, pollIntervalMs: 100 });
    assert.ok(report.checks.some((c) => c.name === "poll-interval" && c.severity === "error"));
  });

  it("warns on very slow poll", () => {
    const report = runDiagnostics({ testMode: true, pollIntervalMs: 300_000 });
    assert.ok(report.checks.some((c) => c.name === "poll-interval" && c.severity === "warn"));
  });

  it("includes uptime and tick info", () => {
    const report = runDiagnostics({ testMode: true, uptimeMs: 7_200_000, tickCount: 500 });
    assert.ok(report.checks.some((c) => c.name === "uptime"));
    assert.ok(report.checks.some((c) => c.name === "tick-count"));
  });

  it("warns on zero sessions", () => {
    const report = runDiagnostics({ testMode: true, sessionCount: 0 });
    assert.ok(report.checks.some((c) => c.name === "sessions" && c.severity === "warn"));
  });

  it("passes with sessions present", () => {
    const report = runDiagnostics({ testMode: true, sessionCount: 5 });
    assert.ok(report.checks.some((c) => c.name === "sessions" && c.severity === "ok"));
  });

  it("counts pass/warn/error correctly", () => {
    const report = runDiagnostics({ testMode: true, nodeVersion: "v18.0.0", pollIntervalMs: 100, reasonerBackend: "bad" });
    assert.ok(report.errorCount >= 2);
    assert.ok(report.warnCount >= 1);
  });
});

describe("formatDiagnostics", () => {
  it("shows ALL CLEAR for healthy daemon", () => {
    const report = runDiagnostics({ testMode: true, reasonerBackend: "opencode", nodeVersion: "v22.0.0" });
    const lines = formatDiagnostics(report);
    assert.ok(lines[0].includes("ALL CLEAR"));
  });

  it("shows ISSUES FOUND for errors", () => {
    const report = runDiagnostics({ testMode: true, nodeVersion: "v16.0.0" });
    const lines = formatDiagnostics(report);
    assert.ok(lines[0].includes("ISSUES"));
  });

  it("includes suggestions for issues", () => {
    const report = runDiagnostics({ testMode: true, nodeVersion: "v16.0.0" });
    const lines = formatDiagnostics(report);
    assert.ok(lines.some((l) => l.includes("→")));
  });
});
