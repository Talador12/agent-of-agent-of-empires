import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createHeartbeatState, recordHeartbeat, evaluateHeartbeats,
  removeHeartbeat, formatHeartbeats,
} from "./session-heartbeat.js";

describe("createHeartbeatState", () => {
  it("starts empty", () => {
    const state = createHeartbeatState();
    assert.equal(state.sessions.size, 0);
  });
});

describe("recordHeartbeat", () => {
  it("registers new session as alive", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "alpha", "hash1", 1000);
    assert.equal(state.sessions.get("alpha")!.status, "alive");
  });

  it("resets missed ticks on output change", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "alpha", "hash1", 1000);
    recordHeartbeat(state, "alpha", "hash1", 2000); // no change
    recordHeartbeat(state, "alpha", "hash1", 3000); // no change
    assert.equal(state.sessions.get("alpha")!.missedTicks, 2);
    recordHeartbeat(state, "alpha", "hash2", 4000); // changed!
    assert.equal(state.sessions.get("alpha")!.missedTicks, 0);
  });

  it("increments missed ticks on same hash", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    recordHeartbeat(state, "a", "h1", 2000);
    recordHeartbeat(state, "a", "h1", 3000);
    assert.equal(state.sessions.get("a")!.missedTicks, 2);
  });
});

describe("evaluateHeartbeats", () => {
  it("marks alive when under stale threshold", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    recordHeartbeat(state, "a", "h1", 2000); // 1 miss
    const results = evaluateHeartbeats(state, ["a"], 5);
    assert.equal(results[0].status, "alive");
  });

  it("marks stale after threshold", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    for (let i = 0; i < 6; i++) recordHeartbeat(state, "a", "h1", 2000 + i * 1000);
    const results = evaluateHeartbeats(state, ["a"], 5, 10, 20);
    assert.equal(results[0].status, "stale");
  });

  it("marks unresponsive after higher threshold", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    for (let i = 0; i < 11; i++) recordHeartbeat(state, "a", "h1", 2000 + i * 1000);
    const results = evaluateHeartbeats(state, ["a"], 5, 10, 20);
    assert.equal(results[0].status, "unresponsive");
  });

  it("marks dead after max threshold", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    for (let i = 0; i < 21; i++) recordHeartbeat(state, "a", "h1", 2000 + i * 1000);
    const results = evaluateHeartbeats(state, ["a"], 5, 10, 20);
    assert.equal(results[0].status, "dead");
  });

  it("sorts by most missed ticks first", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    recordHeartbeat(state, "b", "h2", 1000);
    for (let i = 0; i < 8; i++) recordHeartbeat(state, "a", "h1", 2000 + i);
    for (let i = 0; i < 3; i++) recordHeartbeat(state, "b", "h2", 2000 + i);
    const results = evaluateHeartbeats(state, ["a", "b"]);
    assert.equal(results[0].sessionTitle, "a");
  });
});

describe("removeHeartbeat", () => {
  it("removes session from tracking", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1");
    removeHeartbeat(state, "a");
    assert.equal(state.sessions.size, 0);
  });
});

describe("formatHeartbeats", () => {
  it("shows all-alive message", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1");
    const hbs = evaluateHeartbeats(state, ["a"]);
    const lines = formatHeartbeats(hbs);
    assert.ok(lines[0].includes("alive"));
  });

  it("shows problem sessions", () => {
    const state = createHeartbeatState();
    recordHeartbeat(state, "a", "h1", 1000);
    for (let i = 0; i < 6; i++) recordHeartbeat(state, "a", "h1", 2000 + i);
    const hbs = evaluateHeartbeats(state, ["a"], 5);
    const lines = formatHeartbeats(hbs);
    assert.ok(lines.some((l) => l.includes("stale")));
  });

  it("shows empty message for no sessions", () => {
    const lines = formatHeartbeats([]);
    assert.ok(lines[0].includes("no sessions"));
  });
});
