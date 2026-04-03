import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createAutoScaler, computeScaling, recordScaling, formatAutoScaler } from "./fleet-auto-scaler.js";

describe("computeScaling", () => {
  it("holds when utilization is in range", () => {
    const s = createAutoScaler();
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 3, queuedTasks: 0, completionsPerHour: 2, arrivalsPerHour: 1 });
    assert.equal(d.action, "hold");
  });
  it("scales up on high utilization", () => {
    const s = createAutoScaler();
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 5, queuedTasks: 3, completionsPerHour: 1, arrivalsPerHour: 3 });
    assert.equal(d.action, "scale-up");
    assert.ok(d.recommendedSlots > 5);
  });
  it("scales down on low utilization", () => {
    const s = createAutoScaler();
    const d = computeScaling(s, { currentSlots: 10, activeSlots: 2, queuedTasks: 0, completionsPerHour: 3, arrivalsPerHour: 1 });
    assert.equal(d.action, "scale-down");
    assert.ok(d.recommendedSlots < 10);
  });
  it("respects max slots", () => {
    const s = createAutoScaler({ maxSlots: 8 });
    const d = computeScaling(s, { currentSlots: 7, activeSlots: 7, queuedTasks: 10, completionsPerHour: 0, arrivalsPerHour: 5 });
    assert.ok(d.recommendedSlots <= 8);
  });
  it("respects min slots", () => {
    const s = createAutoScaler({ minSlots: 2 });
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 0, queuedTasks: 0, completionsPerHour: 0, arrivalsPerHour: 0 });
    assert.ok(d.recommendedSlots >= 2);
  });
  it("holds during cooldown", () => {
    const s = createAutoScaler({ cooldownMs: 60_000 });
    s.lastScaleAt = Date.now(); // just scaled
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 5, queuedTasks: 10, completionsPerHour: 0, arrivalsPerHour: 5 });
    assert.equal(d.action, "hold");
    assert.ok(d.reason.includes("cooldown"));
  });
});

describe("recordScaling", () => {
  it("records non-hold actions", () => {
    const s = createAutoScaler();
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 5, queuedTasks: 5, completionsPerHour: 0, arrivalsPerHour: 5 });
    recordScaling(s, d);
    assert.ok(s.scaleHistory.length > 0 || d.action === "hold");
  });
});

describe("formatAutoScaler", () => {
  it("shows scaling decision", () => {
    const s = createAutoScaler();
    const d = computeScaling(s, { currentSlots: 5, activeSlots: 3, queuedTasks: 0, completionsPerHour: 2, arrivalsPerHour: 1 });
    const lines = formatAutoScaler(d, s);
    assert.ok(lines[0].includes("Auto-Scaler"));
  });
});
