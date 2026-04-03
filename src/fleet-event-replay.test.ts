import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import type { FleetEvent } from "./fleet-event-bus.js";
import {
  createEventReplay, stepForward, stepBackward, seekTo, seekToTime,
  setFilter, currentEvent, replayProgress, timeRange, formatEventReplay,
} from "./fleet-event-replay.js";

function sampleEvents(): FleetEvent[] {
  return [
    { type: "session:started", timestamp: 1000, sessionTitle: "alpha", detail: "started" },
    { type: "session:error", timestamp: 2000, sessionTitle: "alpha", detail: "compile error" },
    { type: "cost:exceeded", timestamp: 3000, sessionTitle: "beta", detail: "over budget" },
    { type: "session:completed", timestamp: 4000, sessionTitle: "alpha", detail: "done" },
    { type: "health:degraded", timestamp: 5000, sessionTitle: "beta", detail: "low health" },
  ];
}

describe("createEventReplay", () => {
  it("sorts events by timestamp", () => {
    const unsorted = [sampleEvents()[2], sampleEvents()[0], sampleEvents()[1]];
    const state = createEventReplay(unsorted);
    assert.ok(state.events[0].timestamp <= state.events[1].timestamp);
  });

  it("starts at cursor 0", () => {
    const state = createEventReplay(sampleEvents());
    assert.equal(state.cursor, 0);
  });
});

describe("stepForward", () => {
  it("advances cursor and returns events", () => {
    const state = createEventReplay(sampleEvents());
    const events = stepForward(state, 2);
    assert.equal(events.length, 2);
    assert.equal(state.cursor, 2);
  });

  it("stops at end", () => {
    const state = createEventReplay(sampleEvents());
    const events = stepForward(state, 100);
    assert.equal(events.length, 5);
    assert.equal(state.cursor, 5);
  });
});

describe("stepBackward", () => {
  it("moves cursor back", () => {
    const state = createEventReplay(sampleEvents());
    stepForward(state, 3);
    stepBackward(state, 2);
    assert.equal(state.cursor, 1);
  });

  it("stops at 0", () => {
    const state = createEventReplay(sampleEvents());
    stepBackward(state, 5);
    assert.equal(state.cursor, 0);
  });
});

describe("seekTo", () => {
  it("seeks to position", () => {
    const state = createEventReplay(sampleEvents());
    seekTo(state, 3);
    assert.equal(state.cursor, 3);
  });

  it("clamps to bounds", () => {
    const state = createEventReplay(sampleEvents());
    seekTo(state, 100);
    assert.equal(state.cursor, 4); // last valid index
  });
});

describe("seekToTime", () => {
  it("finds nearest event at timestamp", () => {
    const state = createEventReplay(sampleEvents());
    seekToTime(state, 2500);
    assert.equal(currentEvent(state)!.timestamp, 3000);
  });
});

describe("setFilter", () => {
  it("filters by event type", () => {
    const state = createEventReplay(sampleEvents());
    setFilter(state, "session:error");
    const prog = replayProgress(state);
    assert.equal(prog.total, 1);
  });

  it("filters by session", () => {
    const state = createEventReplay(sampleEvents());
    setFilter(state, undefined, "alpha");
    const prog = replayProgress(state);
    assert.equal(prog.total, 3); // started, error, completed
  });

  it("resets cursor on filter change", () => {
    const state = createEventReplay(sampleEvents());
    stepForward(state, 3);
    setFilter(state, "session:error");
    assert.equal(state.cursor, 0);
  });
});

describe("replayProgress", () => {
  it("computes percentage", () => {
    const state = createEventReplay(sampleEvents());
    stepForward(state, 2);
    const prog = replayProgress(state);
    assert.equal(prog.cursor, 2);
    assert.equal(prog.total, 5);
    assert.equal(prog.pct, 40);
  });
});

describe("timeRange", () => {
  it("returns start and end", () => {
    const state = createEventReplay(sampleEvents());
    const range = timeRange(state);
    assert.ok(range);
    assert.equal(range!.startMs, 1000);
    assert.equal(range!.endMs, 5000);
    assert.equal(range!.durationMs, 4000);
  });

  it("returns null for empty", () => {
    const state = createEventReplay([]);
    assert.equal(timeRange(state), null);
  });
});

describe("formatEventReplay", () => {
  it("shows replay status", () => {
    const state = createEventReplay(sampleEvents());
    const lines = formatEventReplay(state);
    assert.ok(lines[0].includes("Event Replay"));
  });

  it("shows current event", () => {
    const state = createEventReplay(sampleEvents());
    const lines = formatEventReplay(state);
    assert.ok(lines.some((l) => l.includes("started")));
  });
});
