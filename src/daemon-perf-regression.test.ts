import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DaemonPerfRegression, formatPerfRegression } from "./daemon-perf-regression.js";

describe("DaemonPerfRegression", () => {
  it("starts with no samples", () => {
    const d = new DaemonPerfRegression();
    assert.equal(d.sampleCount(), 0);
    assert.equal(d.baseline(), 0);
  });
  it("computes median baseline", () => {
    const d = new DaemonPerfRegression();
    for (let i = 0; i < 10; i++) d.record(i, 100 + i * 10);
    const base = d.baseline();
    assert.ok(base > 0);
    assert.ok(base >= 100 && base <= 200);
  });
  it("detects warning regression", () => {
    const d = new DaemonPerfRegression(100, 2.0, 4.0);
    for (let i = 0; i < 10; i++) d.record(i, 100);
    d.record(10, 250); // 2.5x baseline
    const alert = d.check();
    assert.ok(alert);
    assert.equal(alert!.severity, "warning");
  });
  it("detects critical regression", () => {
    const d = new DaemonPerfRegression(100, 2.0, 4.0);
    for (let i = 0; i < 10; i++) d.record(i, 100);
    d.record(10, 500); // 5x baseline
    const alert = d.check();
    assert.ok(alert);
    assert.equal(alert!.severity, "critical");
  });
  it("returns null when within range", () => {
    const d = new DaemonPerfRegression();
    for (let i = 0; i < 10; i++) d.record(i, 100);
    d.record(10, 110);
    assert.equal(d.check(), null);
  });
  it("returns null with insufficient data", () => {
    const d = new DaemonPerfRegression();
    d.record(0, 500);
    assert.equal(d.check(), null);
  });
  it("enforces max samples", () => {
    const d = new DaemonPerfRegression(5);
    for (let i = 0; i < 10; i++) d.record(i, 100);
    assert.equal(d.sampleCount(), 5);
  });
  it("computes average duration", () => {
    const d = new DaemonPerfRegression();
    d.record(0, 100); d.record(1, 200);
    assert.equal(d.avgDuration(), 150);
  });
  it("gets recent alerts", () => {
    const d = new DaemonPerfRegression(100, 2.0, 4.0);
    for (let i = 0; i < 10; i++) d.record(i, 100);
    d.record(10, 300);
    d.record(11, 100);
    d.record(12, 500);
    const alerts = d.recentAlerts();
    assert.ok(alerts.length >= 2);
  });
});

describe("formatPerfRegression", () => {
  it("shows no-regression message when clean", () => {
    const d = new DaemonPerfRegression();
    for (let i = 0; i < 10; i++) d.record(i, 100);
    const lines = formatPerfRegression(d);
    assert.ok(lines.some((l) => l.includes("No regressions")));
  });
  it("shows alert details", () => {
    const d = new DaemonPerfRegression(100, 2.0, 4.0);
    for (let i = 0; i < 10; i++) d.record(i, 100);
    d.record(10, 500);
    const lines = formatPerfRegression(d);
    assert.ok(lines[0].includes("Perf Regression"));
    assert.ok(lines.some((l) => l.includes("critical")));
  });
});
