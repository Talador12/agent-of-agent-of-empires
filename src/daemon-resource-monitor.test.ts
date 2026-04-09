// daemon-resource-monitor.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createResourceMonitor,
  recordSample,
  detectTrend,
  summarizeResources,
  formatResourceMonitor,
} from "./daemon-resource-monitor.js";

describe("recordSample", () => {
  it("records a sample with memory and CPU", () => {
    const state = createResourceMonitor();
    const sample = recordSample(state, 1);
    assert.ok(sample.heapUsedMB > 0);
    assert.ok(sample.rssMB > 0);
    assert.ok(sample.heapTotalMB > 0);
    assert.equal(sample.tickNum, 1);
    assert.equal(state.samples.length, 1);
  });

  it("computes CPU delta between samples", () => {
    const state = createResourceMonitor();
    recordSample(state, 1, 1000);
    // do some work to burn CPU
    let x = 0; for (let i = 0; i < 100000; i++) x += Math.sqrt(i);
    const s2 = recordSample(state, 2, 2000);
    // CPU delta should be positive (or at least 0) for second sample
    assert.ok(s2.cpuUserMs >= 0);
  });

  it("tracks peak heap", () => {
    const state = createResourceMonitor();
    recordSample(state, 1);
    assert.ok(state.peakHeapMB > 0);
  });

  it("tracks peak RSS", () => {
    const state = createResourceMonitor();
    recordSample(state, 1);
    assert.ok(state.peakRssMB > 0);
  });

  it("trims old samples", () => {
    const state = createResourceMonitor(5);
    for (let i = 0; i < 10; i++) {
      recordSample(state, i);
    }
    assert.equal(state.samples.length, 5);
  });
});

describe("detectTrend", () => {
  it("detects increasing trend", () => {
    const trend = detectTrend([10, 11, 12, 13, 20, 22, 25, 30]);
    assert.equal(trend, "increasing");
  });

  it("detects decreasing trend", () => {
    const trend = detectTrend([30, 28, 25, 22, 15, 12, 10, 8]);
    assert.equal(trend, "decreasing");
  });

  it("detects stable trend", () => {
    const trend = detectTrend([50, 51, 49, 50, 50, 51, 49, 50]);
    assert.equal(trend, "stable");
  });

  it("returns stable for insufficient data", () => {
    assert.equal(detectTrend([1, 2, 3]), "stable");
  });

  it("returns stable for empty input", () => {
    assert.equal(detectTrend([]), "stable");
  });
});

describe("summarizeResources", () => {
  it("summarizes recorded samples", () => {
    const state = createResourceMonitor();
    recordSample(state, 1);
    recordSample(state, 2);
    recordSample(state, 3);
    const summary = summarizeResources(state);
    assert.ok(summary.currentHeapMB > 0);
    assert.ok(summary.currentRssMB > 0);
    assert.ok(summary.peakHeapMB > 0);
    assert.ok(summary.avgHeapMB > 0);
    assert.equal(summary.sampleCount, 3);
    assert.ok(["increasing", "decreasing", "stable"].includes(summary.heapTrend));
    assert.ok(summary.heapUtilizationPct > 0 && summary.heapUtilizationPct <= 100);
  });

  it("handles empty state", () => {
    const state = createResourceMonitor();
    const summary = summarizeResources(state);
    assert.equal(summary.sampleCount, 0);
    assert.equal(summary.currentHeapMB, 0);
    assert.equal(summary.heapTrend, "stable");
  });
});

describe("formatResourceMonitor", () => {
  it("formats state for TUI", () => {
    const state = createResourceMonitor();
    for (let i = 0; i < 5; i++) recordSample(state, i);
    const lines = formatResourceMonitor(state);
    assert.ok(lines[0].includes("5 samples"));
    assert.ok(lines.some((l) => l.includes("heap:")));
    assert.ok(lines.some((l) => l.includes("rss:")));
    assert.ok(lines.some((l) => l.includes("cpu:")));
    assert.ok(lines.some((l) => l.includes("heap trend:")));
  });

  it("handles empty state", () => {
    const state = createResourceMonitor();
    const lines = formatResourceMonitor(state);
    assert.ok(lines[0].includes("0 samples"));
  });
});
