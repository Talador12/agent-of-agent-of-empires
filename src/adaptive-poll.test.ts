import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { AdaptivePollController } from "./adaptive-poll.js";

describe("AdaptivePollController", () => {
  it("starts at base interval", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000 });
    assert.equal(ctrl.intervalMs, 10_000);
  });

  it("speeds up after consecutive active ticks", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, minIntervalMs: 2_000, rampDownFactor: 2 });
    ctrl.recordTick(3, false); // active
    ctrl.recordTick(2, false); // active x2 → triggers speedup
    assert.ok(ctrl.intervalMs < 10_000);
  });

  it("slows down after consecutive idle ticks", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, maxIntervalMs: 60_000, rampUpFactor: 1.5 });
    ctrl.recordTick(0, false); // idle 1
    ctrl.recordTick(0, false); // idle 2
    ctrl.recordTick(0, false); // idle 3 → triggers slowdown
    assert.ok(ctrl.intervalMs > 10_000);
  });

  it("respects minIntervalMs", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, minIntervalMs: 5_000, rampDownFactor: 100 });
    for (let i = 0; i < 20; i++) ctrl.recordTick(5, true);
    assert.ok(ctrl.intervalMs >= 5_000);
  });

  it("respects maxIntervalMs", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, maxIntervalMs: 30_000, rampUpFactor: 10 });
    for (let i = 0; i < 20; i++) ctrl.recordTick(0, false);
    assert.ok(ctrl.intervalMs <= 30_000);
  });

  it("resets to base interval", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, maxIntervalMs: 60_000 });
    for (let i = 0; i < 10; i++) ctrl.recordTick(0, false);
    assert.ok(ctrl.intervalMs > 10_000);
    ctrl.reset();
    assert.equal(ctrl.intervalMs, 10_000);
  });

  it("reasoner action counts as active", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, minIntervalMs: 2_000 });
    ctrl.recordTick(0, true); // no changes but reasoner acted
    ctrl.recordTick(0, true);
    assert.ok(ctrl.intervalMs < 10_000);
  });

  it("does not slow down until 3 idle ticks", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000 });
    ctrl.recordTick(0, false);
    ctrl.recordTick(0, false);
    assert.equal(ctrl.intervalMs, 10_000); // only 2 idle, no change yet
  });

  it("does not speed up until 2 active ticks", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000 });
    ctrl.recordTick(5, false);
    assert.equal(ctrl.intervalMs, 10_000); // only 1 active, no change yet
  });

  it("formatStatus includes mode and interval", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000 });
    const status = ctrl.formatStatus();
    assert.ok(status.includes("10.0s"));
    assert.ok(status.includes("normal"));
  });

  it("alternating active/idle stays near base", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000 });
    for (let i = 0; i < 10; i++) {
      ctrl.recordTick(i % 2 === 0 ? 3 : 0, false);
    }
    // should stay near base since never getting consecutive runs
    assert.ok(ctrl.intervalMs >= 8_000 && ctrl.intervalMs <= 12_000);
  });
});
