import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DaemonMetricsHistogram, formatMetricsHistogram } from "./daemon-metrics-histogram.js";

describe("DaemonMetricsHistogram", () => {
  it("starts with no samples", () => {
    const h = new DaemonMetricsHistogram();
    assert.equal(h.sampleCount("poll"), 0);
    assert.equal(h.stats("poll"), null);
  });

  it("records and retrieves stats", () => {
    const h = new DaemonMetricsHistogram();
    h.record("poll", 100);
    h.record("poll", 200);
    h.record("poll", 300);
    const s = h.stats("poll");
    assert.ok(s);
    assert.equal(s!.count, 3);
    assert.equal(s!.min, 100);
    assert.equal(s!.max, 300);
    assert.equal(s!.mean, 200);
  });

  it("computes percentiles correctly", () => {
    const h = new DaemonMetricsHistogram();
    for (let i = 1; i <= 100; i++) h.record("reason", i * 10);
    const s = h.stats("reason")!;
    assert.equal(s.p50, 510); // 51st element (0-indexed floor(100*0.5))
    assert.ok(s.p90 >= 900);
    assert.ok(s.p99 >= 990);
  });

  it("enforces max samples", () => {
    const h = new DaemonMetricsHistogram(10);
    for (let i = 0; i < 20; i++) h.record("poll", i * 100);
    assert.equal(h.sampleCount("poll"), 10);
  });

  it("clamps negative durations to 0", () => {
    const h = new DaemonMetricsHistogram();
    h.record("execute", -50);
    const s = h.stats("execute")!;
    assert.equal(s.min, 0);
  });

  it("allStats returns stats for all phases", () => {
    const h = new DaemonMetricsHistogram();
    h.record("poll", 10);
    h.record("reason", 20);
    h.record("execute", 5);
    h.record("tick-total", 35);
    const all = h.allStats();
    assert.equal(all.length, 4);
    assert.ok(all.some((s) => s.phase === "poll"));
    assert.ok(all.some((s) => s.phase === "tick-total"));
  });

  it("generates histogram buckets", () => {
    const h = new DaemonMetricsHistogram();
    for (let i = 0; i < 50; i++) h.record("tick-total", 50 + Math.floor(i * 10));
    const buckets = h.histogram("tick-total", 5);
    assert.equal(buckets.length, 5);
    assert.ok(buckets.every((b) => b.includes("█") || b.includes("▏") || b.trim().endsWith("0")));
  });

  it("returns empty histogram for no data", () => {
    const h = new DaemonMetricsHistogram();
    assert.deepEqual(h.histogram("poll"), []);
  });
});

describe("formatMetricsHistogram", () => {
  it("shows no-data message when empty", () => {
    const h = new DaemonMetricsHistogram();
    const lines = formatMetricsHistogram(h);
    assert.ok(lines[0].includes("no data"));
  });

  it("shows stats table and histogram", () => {
    const h = new DaemonMetricsHistogram();
    for (let i = 0; i < 20; i++) {
      h.record("poll", 50 + i * 5);
      h.record("reason", 200 + i * 20);
      h.record("tick-total", 300 + i * 25);
    }
    const lines = formatMetricsHistogram(h);
    assert.ok(lines[0].includes("Daemon Metrics"));
    assert.ok(lines.some((l) => l.includes("poll")));
    assert.ok(lines.some((l) => l.includes("reason")));
    assert.ok(lines.some((l) => l.includes("Tick latency")));
  });
});
