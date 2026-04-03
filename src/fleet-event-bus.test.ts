import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetEventBus, formatEventBus } from "./fleet-event-bus.js";

describe("FleetEventBus", () => {
  it("starts with no subscriptions or history", () => {
    const bus = new FleetEventBus();
    assert.equal(bus.getSubscriptionCount(), 0);
    assert.equal(bus.getHistory().length, 0);
  });

  it("delivers events to matching subscribers", () => {
    const bus = new FleetEventBus();
    let received = 0;
    bus.on("session:error", () => { received++; });
    bus.publish("session:error", "test error", "session-1");
    assert.equal(received, 1);
  });

  it("does not deliver to non-matching subscribers", () => {
    const bus = new FleetEventBus();
    let received = 0;
    bus.on("session:completed", () => { received++; });
    bus.publish("session:error", "test error");
    assert.equal(received, 0);
  });

  it("wildcard * receives all events", () => {
    const bus = new FleetEventBus();
    let received = 0;
    bus.on("*", () => { received++; });
    bus.publish("session:error", "err");
    bus.publish("cost:exceeded", "cost");
    bus.publish("health:degraded", "health");
    assert.equal(received, 3);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new FleetEventBus();
    let received = 0;
    const id = bus.on("session:error", () => { received++; });
    bus.publish("session:error", "first");
    assert.equal(received, 1);
    bus.off(id);
    bus.publish("session:error", "second");
    assert.equal(received, 1); // still 1
  });

  it("off returns false for unknown id", () => {
    const bus = new FleetEventBus();
    assert.equal(bus.off(999), false);
  });

  it("stores event history", () => {
    const bus = new FleetEventBus();
    bus.publish("session:started", "s1", "a");
    bus.publish("session:stopped", "s2", "b");
    assert.equal(bus.getHistory().length, 2);
  });

  it("filters history by type", () => {
    const bus = new FleetEventBus();
    bus.publish("session:started", "s1");
    bus.publish("cost:exceeded", "c1");
    bus.publish("session:started", "s2");
    const filtered = bus.getHistory("session:started");
    assert.equal(filtered.length, 2);
  });

  it("limits history size", () => {
    const bus = new FleetEventBus(5);
    for (let i = 0; i < 10; i++) bus.publish("session:started", `event-${i}`);
    assert.equal(bus.getHistory().length, 5);
  });

  it("counts events by type", () => {
    const bus = new FleetEventBus();
    bus.publish("session:error", "e1");
    bus.publish("session:error", "e2");
    bus.publish("cost:exceeded", "c1");
    const counts = bus.getCounts();
    assert.equal(counts.get("session:error"), 2);
    assert.equal(counts.get("cost:exceeded"), 1);
  });

  it("swallows subscriber errors without crashing", () => {
    const bus = new FleetEventBus();
    bus.on("session:error", () => { throw new Error("boom"); });
    let received = false;
    bus.on("session:error", () => { received = true; });
    bus.publish("session:error", "test");
    assert.ok(received); // second subscriber still ran
  });

  it("multiple subscribers on same event", () => {
    const bus = new FleetEventBus();
    let count = 0;
    bus.on("task:completed", () => { count++; });
    bus.on("task:completed", () => { count++; });
    bus.publish("task:completed", "done");
    assert.equal(count, 2);
  });
});

describe("formatEventBus", () => {
  it("shows empty bus state", () => {
    const bus = new FleetEventBus();
    const lines = formatEventBus(bus);
    assert.ok(lines[0].includes("Fleet Event Bus"));
  });

  it("shows event counts and recent events", () => {
    const bus = new FleetEventBus();
    bus.publish("session:error", "test err", "alpha");
    bus.publish("cost:exceeded", "over budget", "beta");
    const lines = formatEventBus(bus);
    assert.ok(lines.some((l) => l.includes("session:error")));
    assert.ok(lines.some((l) => l.includes("alpha") || l.includes("beta")));
  });
});
