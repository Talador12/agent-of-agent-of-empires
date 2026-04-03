import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  buildReplayState, seekTo, step, currentEntry,
  filterBySession, replayStats, formatReplayEntry, formatReplayStats,
} from "./action-replay.js";

function sampleLines(): string[] {
  const base = 1700000000000;
  return [
    JSON.stringify({ timestamp: base, action: { action: "send_input", session: "alpha" }, success: true, detail: "nudge alpha" }),
    JSON.stringify({ timestamp: base + 1000, action: { action: "wait" }, success: true, detail: "no action needed" }),
    JSON.stringify({ timestamp: base + 60000, action: { action: "send_input", session: "beta" }, success: true, detail: "nudge beta" }),
    JSON.stringify({ timestamp: base + 61000, action: { action: "complete_task", session: "alpha" }, success: true, detail: "done" }),
    JSON.stringify({ timestamp: base + 120000, action: { action: "send_input", session: "gamma" }, success: false, detail: "failed" }),
  ];
}

describe("buildReplayState", () => {
  it("groups actions into ticks by timestamp", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    assert.ok(state.entries.length >= 2);
    assert.equal(state.currentIdx, state.entries.length - 1); // starts at end
  });

  it("handles empty input", () => {
    const state = buildReplayState([]);
    assert.equal(state.entries.length, 0);
  });

  it("skips malformed lines", () => {
    const state = buildReplayState(["not json", "{}", ...sampleLines()]);
    assert.ok(state.entries.length > 0);
  });
});

describe("seekTo", () => {
  it("navigates to a specific tick", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const entry = seekTo(state, 1);
    assert.ok(entry);
    assert.equal(entry!.tickNum, 1);
    assert.equal(state.currentIdx, 0);
  });

  it("returns null for invalid tick", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    assert.equal(seekTo(state, 999), null);
  });
});

describe("step", () => {
  it("steps forward", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    seekTo(state, 1);
    const entry = step(state, "forward");
    assert.ok(entry);
    assert.equal(state.currentIdx, 1);
  });

  it("steps backward", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const entry = step(state, "backward");
    assert.ok(entry);
    assert.ok(state.currentIdx < state.entries.length - 1 || state.entries.length === 1);
  });

  it("stays at bounds", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    seekTo(state, 1);
    step(state, "backward"); // already at 0 or stays
    assert.ok(state.currentIdx >= 0);
  });
});

describe("currentEntry", () => {
  it("returns current entry", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const entry = currentEntry(state);
    assert.ok(entry);
    assert.ok(entry!.actions.length > 0);
  });

  it("returns null for empty state", () => {
    const state = buildReplayState([]);
    assert.equal(currentEntry(state), null);
  });
});

describe("filterBySession", () => {
  it("filters entries to matching session", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const filtered = filterBySession(state, "alpha");
    assert.ok(filtered.length > 0);
    for (const e of filtered) {
      assert.ok(e.actions.every((a) => a.sessionTitle.toLowerCase() === "alpha"));
    }
  });

  it("returns all entries when filter is null", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const all = filterBySession(state, null);
    assert.equal(all.length, state.entries.length);
  });
});

describe("replayStats", () => {
  it("computes correct stats", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const stats = replayStats(state);
    assert.ok(stats.totalTicks > 0);
    assert.equal(stats.totalActions, 5);
    assert.equal(stats.failedActions, 1);
    assert.ok(stats.sessionsInvolved >= 2);
  });
});

describe("formatReplayEntry", () => {
  it("shows no-entries message for null", () => {
    const lines = formatReplayEntry(null, 0);
    assert.ok(lines[0].includes("no entries"));
  });

  it("shows tick details", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const entry = currentEntry(state);
    const lines = formatReplayEntry(entry, state.entries.length);
    assert.ok(lines[0].includes("Tick #"));
  });
});

describe("formatReplayStats", () => {
  it("shows stats summary", () => {
    const state = buildReplayState(sampleLines(), 30_000);
    const lines = formatReplayStats(state);
    assert.ok(lines[0].includes("Action Replay"));
  });

  it("shows empty message for no history", () => {
    const state = buildReplayState([]);
    const lines = formatReplayStats(state);
    assert.ok(lines[0].includes("no action history"));
  });
});
