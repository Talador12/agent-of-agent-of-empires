import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetSlaMonitor } from "./fleet-sla.js";

describe("FleetSlaMonitor", () => {
  it("starts with no breaches", () => {
    const monitor = new FleetSlaMonitor();
    assert.equal(monitor.breachCount, 0);
  });

  it("does not breach when health is above threshold", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50 });
    const status = monitor.recordHealth(80);
    assert.equal(status.breached, false);
    assert.equal(status.shouldAlert, false);
  });

  it("breaches when average health drops below threshold", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 3, alertCooldownTicks: 0 });
    monitor.recordHealth(30);
    monitor.recordHealth(40);
    const status = monitor.recordHealth(35);
    assert.equal(status.breached, true);
    assert.equal(status.shouldAlert, true);
    assert.equal(status.averageHealth, 35);
  });

  it("respects alert cooldown", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 3 });
    const s1 = monitor.recordHealth(30); // first alert fires
    assert.equal(s1.shouldAlert, true);
    const s2 = monitor.recordHealth(30); // cooldown
    assert.equal(s2.shouldAlert, false);
    const s3 = monitor.recordHealth(30);
    assert.equal(s3.shouldAlert, false);
    const s4 = monitor.recordHealth(30); // cooldown expired
    assert.equal(s4.shouldAlert, true);
  });

  it("tracks total breach count", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 0 });
    monitor.recordHealth(30);
    monitor.recordHealth(30);
    assert.equal(monitor.breachCount, 2);
  });

  it("uses sliding window for average", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 3, alertCooldownTicks: 0 });
    monitor.recordHealth(20); // bad
    monitor.recordHealth(20); // bad
    monitor.recordHealth(80); // good
    const s = monitor.recordHealth(80); // window: [20, 80, 80] = avg 60 > 50
    assert.equal(s.breached, false);
  });

  it("setThreshold updates the threshold", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 0 });
    monitor.setThreshold(90);
    const s = monitor.recordHealth(80);
    assert.equal(s.breached, true);
  });

  it("formatStatus handles empty", () => {
    const monitor = new FleetSlaMonitor();
    const lines = monitor.formatStatus();
    assert.ok(lines[0].includes("no health data"));
  });

  it("formatStatus shows status when populated", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50 });
    monitor.recordHealth(70);
    const lines = monitor.formatStatus();
    assert.ok(lines.some((l) => l.includes("70")));
    assert.ok(lines.some((l) => l.includes("50")));
  });
});
