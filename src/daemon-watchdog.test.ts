import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createWatchdog, tickWatchdog, checkWatchdog, setWatchdogEnabled, setWatchdogThreshold, formatWatchdog } from "./daemon-watchdog.js";

describe("createWatchdog", () => {
  it("starts enabled with defaults", () => {
    const w = createWatchdog();
    assert.ok(w.enabled);
    assert.equal(w.tickCount, 0);
    assert.equal(w.stallCount, 0);
  });
});

describe("tickWatchdog", () => {
  it("updates tick count and timestamp", () => {
    const w = createWatchdog();
    tickWatchdog(w, 5000);
    assert.equal(w.tickCount, 1);
    assert.equal(w.lastTickAt, 5000);
  });
});

describe("checkWatchdog", () => {
  it("returns ok when within threshold", () => {
    const w = createWatchdog(60_000);
    tickWatchdog(w, 10_000);
    const check = checkWatchdog(w, 20_000); // 10s since tick, threshold 60s
    assert.ok(!check.stalled);
    assert.equal(check.recommendation, "ok");
  });

  it("detects stall beyond threshold", () => {
    const w = createWatchdog(5000);
    tickWatchdog(w, 1000);
    const check = checkWatchdog(w, 10_000); // 9s since tick, threshold 5s
    assert.ok(check.stalled);
    assert.ok(check.stalledMs >= 5000);
    assert.equal(w.stallCount, 1);
  });

  it("escalates to restart at 2x threshold", () => {
    const w = createWatchdog(5000, "warn");
    tickWatchdog(w, 1000);
    const check = checkWatchdog(w, 12_000); // 11s > 2x5s=10s, but < 3x5s=15s
    assert.equal(check.recommendation, "restart");
  });

  it("escalates to exit at 3x threshold", () => {
    const w = createWatchdog(5000, "warn");
    tickWatchdog(w, 1000);
    const check = checkWatchdog(w, 17_000); // 16s > 3x5s=15s
    assert.equal(check.recommendation, "exit");
  });

  it("returns ok when disabled", () => {
    const w = createWatchdog(1000);
    tickWatchdog(w, 1000);
    setWatchdogEnabled(w, false);
    const check = checkWatchdog(w, 100_000);
    assert.ok(!check.stalled);
  });

  it("tracks stall count", () => {
    const w = createWatchdog(1000);
    tickWatchdog(w, 1000);
    checkWatchdog(w, 5000);
    checkWatchdog(w, 6000);
    assert.equal(w.stallCount, 2);
  });
});

describe("setWatchdogThreshold", () => {
  it("enforces minimum 10s", () => {
    const w = createWatchdog();
    setWatchdogThreshold(w, 1000);
    assert.equal(w.thresholdMs, 10_000);
  });

  it("accepts valid thresholds", () => {
    const w = createWatchdog();
    setWatchdogThreshold(w, 60_000);
    assert.equal(w.thresholdMs, 60_000);
  });
});

describe("formatWatchdog", () => {
  it("shows OK status for healthy daemon", () => {
    const w = createWatchdog(60_000);
    tickWatchdog(w);
    const lines = formatWatchdog(w);
    assert.ok(lines[0].includes("OK"));
  });

  it("shows STALLED status", () => {
    const w = createWatchdog(1000);
    tickWatchdog(w, 1000);
    const lines = formatWatchdog(w, 10_000);
    assert.ok(lines[0].includes("STALLED"));
  });

  it("shows DISABLED when off", () => {
    const w = createWatchdog();
    setWatchdogEnabled(w, false);
    const lines = formatWatchdog(w);
    assert.ok(lines[0].includes("DISABLED"));
  });
});
