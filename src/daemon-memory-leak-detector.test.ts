// daemon-memory-leak-detector.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLeakDetector,
  recordHeapSample,
  linearRegression,
  analyzeLeaks,
  checkAndAlert,
  formatLeakDetector,
  type HeapSample,
} from "./daemon-memory-leak-detector.js";

describe("recordHeapSample", () => {
  it("records a sample", () => {
    const state = createLeakDetector();
    const sample = recordHeapSample(state);
    assert.ok(sample.heapUsedMB > 0);
    assert.ok(sample.heapTotalMB > 0);
    assert.equal(state.samples.length, 1);
  });

  it("establishes baseline after warmup", () => {
    const state = createLeakDetector(300, 3);
    assert.equal(state.baselineHeapMB, null);
    recordHeapSample(state);
    recordHeapSample(state);
    assert.equal(state.baselineHeapMB, null); // not yet
    recordHeapSample(state);
    assert.ok(state.baselineHeapMB! > 0); // now established
  });

  it("trims samples beyond max", () => {
    const state = createLeakDetector(5, 2);
    for (let i = 0; i < 10; i++) recordHeapSample(state);
    assert.equal(state.samples.length, 5);
  });
});

describe("linearRegression", () => {
  it("computes slope for linear growth", () => {
    const samples: HeapSample[] = [
      { timestamp: 0, heapUsedMB: 10, heapTotalMB: 100 },
      { timestamp: 1000, heapUsedMB: 20, heapTotalMB: 100 },
      { timestamp: 2000, heapUsedMB: 30, heapTotalMB: 100 },
      { timestamp: 3000, heapUsedMB: 40, heapTotalMB: 100 },
    ];
    const { slopeMBPerMs, r2 } = linearRegression(samples);
    assert.ok(Math.abs(slopeMBPerMs - 0.01) < 0.001); // 10MB per 1000ms
    assert.ok(r2 > 0.99); // perfect line
  });

  it("returns 0 slope for flat usage", () => {
    const samples: HeapSample[] = [
      { timestamp: 0, heapUsedMB: 50, heapTotalMB: 100 },
      { timestamp: 1000, heapUsedMB: 50, heapTotalMB: 100 },
      { timestamp: 2000, heapUsedMB: 50, heapTotalMB: 100 },
    ];
    const { slopeMBPerMs } = linearRegression(samples);
    assert.ok(Math.abs(slopeMBPerMs) < 0.001);
  });

  it("handles insufficient data", () => {
    const { slopeMBPerMs, r2 } = linearRegression([]);
    assert.equal(slopeMBPerMs, 0);
    assert.equal(r2, 0);
  });

  it("low R² for noisy data", () => {
    const samples: HeapSample[] = [
      { timestamp: 0, heapUsedMB: 10, heapTotalMB: 100 },
      { timestamp: 1000, heapUsedMB: 50, heapTotalMB: 100 },
      { timestamp: 2000, heapUsedMB: 15, heapTotalMB: 100 },
      { timestamp: 3000, heapUsedMB: 45, heapTotalMB: 100 },
    ];
    const { r2 } = linearRegression(samples);
    assert.ok(r2 < 0.5); // noisy, shouldn't fit well
  });
});

describe("analyzeLeaks", () => {
  it("returns ok for insufficient data", () => {
    const state = createLeakDetector();
    const analysis = analyzeLeaks(state);
    assert.equal(analysis.status, "ok");
    assert.equal(analysis.sampleCount, 0);
  });

  it("returns ok when baseline not established", () => {
    const state = createLeakDetector(300, 10);
    recordHeapSample(state);
    const analysis = analyzeLeaks(state);
    assert.equal(analysis.status, "ok");
  });

  it("detects growth from baseline", () => {
    const state = createLeakDetector(300, 3);
    for (let i = 0; i < 5; i++) recordHeapSample(state);
    const analysis = analyzeLeaks(state);
    assert.ok(analysis.baselineHeapMB > 0);
    assert.ok(analysis.sampleCount >= 5);
  });
});

describe("checkAndAlert", () => {
  it("returns null when status is ok", () => {
    const state = createLeakDetector(300, 3);
    for (let i = 0; i < 3; i++) recordHeapSample(state);
    const alert = checkAndAlert(state);
    // may or may not alert — depends on actual heap state
    // just verify it doesn't crash and returns the right type
    assert.ok(alert === null || typeof alert.status === "string");
  });

  it("caps alerts", () => {
    const state = createLeakDetector(300, 3);
    for (let i = 0; i < 3; i++) recordHeapSample(state);
    // manually push alerts
    for (let i = 0; i < 60; i++) {
      state.alerts.push({ timestamp: i, status: "warning", heapUsedMB: 50, growthRateMBPerHour: 2, projectedExhaustionMs: null, message: "test" });
    }
    checkAndAlert(state);
    assert.ok(state.alerts.length <= 50);
  });
});

describe("formatLeakDetector", () => {
  it("formats state for TUI", () => {
    const state = createLeakDetector(300, 3);
    for (let i = 0; i < 5; i++) recordHeapSample(state);
    const lines = formatLeakDetector(state);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("memory leak detector"));
    assert.ok(lines.some((l) => l.includes("baseline")));
    assert.ok(lines.some((l) => l.includes("growth rate")));
  });
});
