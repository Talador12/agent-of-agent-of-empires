import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createShutdownState, initiateShutdown, markDrained, isDrainComplete, advancePhase, markSaveComplete, pendingSessions, formatShutdownState } from "./daemon-graceful-shutdown.js";

describe("createShutdownState", () => {
  it("starts in running phase", () => { assert.equal(createShutdownState().phase, "running"); });
});

describe("initiateShutdown", () => {
  it("transitions to draining", () => {
    const s = createShutdownState();
    const plan = initiateShutdown(s, ["a", "b"], 0);
    assert.equal(s.phase, "draining");
    assert.equal(plan.sessionsTodrain.length, 2);
    assert.ok(plan.actions.length >= 3);
  });
  it("handles empty sessions", () => {
    const s = createShutdownState();
    const plan = initiateShutdown(s, []);
    assert.equal(plan.estimatedDrainMs, 0);
  });
});

describe("markDrained + isDrainComplete", () => {
  it("completes when all sessions drained", () => {
    const s = createShutdownState();
    initiateShutdown(s, ["a", "b"]);
    markDrained(s, "a");
    assert.ok(!isDrainComplete(s));
    markDrained(s, "b");
    assert.ok(isDrainComplete(s));
  });
  it("completes on timeout", () => {
    const s = createShutdownState(1000);
    initiateShutdown(s, ["a"], 0, 1000);
    assert.ok(!isDrainComplete(s, 1500));
    assert.ok(isDrainComplete(s, 3000)); // 2s > 1s timeout
  });
  it("deduplicates drain marks", () => {
    const s = createShutdownState();
    initiateShutdown(s, ["a"]);
    markDrained(s, "a");
    markDrained(s, "a"); // duplicate
    assert.equal(s.drainedSessions.length, 1);
  });
});

describe("advancePhase", () => {
  it("advances draining → saving when drain complete", () => {
    const s = createShutdownState();
    initiateShutdown(s, ["a"]);
    markDrained(s, "a");
    assert.equal(advancePhase(s), "saving");
  });
  it("advances saving → exiting when save done", () => {
    const s = createShutdownState();
    initiateShutdown(s, []);
    advancePhase(s); // → saving
    markSaveComplete(s);
    assert.equal(advancePhase(s), "exiting");
  });
  it("advances exiting → complete", () => {
    const s = createShutdownState();
    s.phase = "exiting";
    assert.equal(advancePhase(s), "complete");
  });
});

describe("pendingSessions", () => {
  it("returns not-yet-drained sessions", () => {
    const s = createShutdownState();
    initiateShutdown(s, ["a", "b", "c"]);
    markDrained(s, "a");
    assert.deepEqual(pendingSessions(s), ["b", "c"]);
  });
});

describe("formatShutdownState", () => {
  it("shows running state", () => {
    const lines = formatShutdownState(createShutdownState());
    assert.ok(lines[0].includes("not initiated"));
  });
  it("shows draining progress", () => {
    const s = createShutdownState();
    initiateShutdown(s, ["alpha", "beta"]);
    markDrained(s, "alpha");
    const lines = formatShutdownState(s);
    assert.ok(lines[0].includes("draining"));
    assert.ok(lines.some((l) => l.includes("1/2")));
  });
});
