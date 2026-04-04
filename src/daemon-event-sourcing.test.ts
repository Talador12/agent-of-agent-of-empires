import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createEventStore, appendEvent, queryByType, queryBySource, queryByTimeRange, eventTypeCounts, replayEvents, eventStoreStats, formatEventStore } from "./daemon-event-sourcing.js";

describe("createEventStore", () => {
  it("starts empty", () => { assert.equal(createEventStore().events.length, 0); });
});

describe("appendEvent", () => {
  it("appends with incremental ID", () => {
    const s = createEventStore();
    const e1 = appendEvent(s, "task:created", { session: "a" }, "task-manager");
    const e2 = appendEvent(s, "session:started", { session: "b" }, "poller");
    assert.equal(e1.id, 1); assert.equal(e2.id, 2);
    assert.equal(s.events.length, 2);
  });
  it("enforces max events", () => {
    const s = createEventStore(3);
    for (let i = 0; i < 5; i++) appendEvent(s, "test", {}, "mod");
    assert.equal(s.events.length, 3);
  });
});

describe("queryByType", () => {
  it("filters by event type", () => {
    const s = createEventStore();
    appendEvent(s, "task:created", {}, "a");
    appendEvent(s, "session:error", {}, "b");
    appendEvent(s, "task:created", {}, "c");
    assert.equal(queryByType(s, "task:created").length, 2);
  });
});

describe("queryBySource", () => {
  it("filters by source", () => {
    const s = createEventStore();
    appendEvent(s, "x", {}, "poller");
    appendEvent(s, "y", {}, "reasoner");
    assert.equal(queryBySource(s, "poller").length, 1);
  });
});

describe("queryByTimeRange", () => {
  it("filters by time", () => {
    const s = createEventStore();
    appendEvent(s, "a", {}, "m", 1000);
    appendEvent(s, "b", {}, "m", 2000);
    appendEvent(s, "c", {}, "m", 3000);
    assert.equal(queryByTimeRange(s, 1500, 2500).length, 1);
  });
});

describe("eventTypeCounts", () => {
  it("counts by type", () => {
    const s = createEventStore();
    appendEvent(s, "a", {}, "m"); appendEvent(s, "a", {}, "m"); appendEvent(s, "b", {}, "m");
    const c = eventTypeCounts(s);
    assert.equal(c.get("a"), 2);
    assert.equal(c.get("b"), 1);
  });
});

describe("replayEvents", () => {
  it("replays through reducer to reconstruct state", () => {
    const s = createEventStore();
    appendEvent(s, "add", { value: 10 }, "calc");
    appendEvent(s, "add", { value: 5 }, "calc");
    appendEvent(s, "add", { value: 3 }, "calc");
    const total = replayEvents(s, 0, (state, e) => state + (e.payload.value as number));
    assert.equal(total, 18);
  });
  it("supports upToId for partial replay", () => {
    const s = createEventStore();
    appendEvent(s, "add", { value: 10 }, "calc");
    appendEvent(s, "add", { value: 5 }, "calc");
    appendEvent(s, "add", { value: 3 }, "calc");
    const partial = replayEvents(s, 0, (state, e) => state + (e.payload.value as number), 2);
    assert.equal(partial, 15); // only first 2 events
  });
});

describe("eventStoreStats", () => {
  it("computes correct stats", () => {
    const s = createEventStore();
    appendEvent(s, "a", {}, "x", 1000);
    appendEvent(s, "b", {}, "y", 2000);
    const stats = eventStoreStats(s);
    assert.equal(stats.totalEvents, 2);
    assert.equal(stats.types, 2);
    assert.equal(stats.sources, 2);
    assert.equal(stats.oldestMs, 1000);
    assert.equal(stats.newestMs, 2000);
  });
});

describe("formatEventStore", () => {
  it("shows empty message", () => {
    const lines = formatEventStore(createEventStore());
    assert.ok(lines.some((l) => l.includes("No events")));
  });
  it("shows event summary", () => {
    const s = createEventStore();
    appendEvent(s, "task:created", {}, "task-manager");
    const lines = formatEventStore(s);
    assert.ok(lines[0].includes("Event Store"));
  });
});
