import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colorize, isDaemonRunningFromState, getCountdownFromState, buildStatusLineFromState } from "./chat.js";
import type { DaemonState } from "./types.js";

// --- helpers ---

function makeState(overrides?: Partial<DaemonState>): DaemonState {
  return {
    tickStartedAt: Date.now(),
    nextTickAt: Date.now() + 10_000,
    pollIntervalMs: 10_000,
    phase: "sleeping",
    phaseStartedAt: Date.now(),
    pollCount: 5,
    paused: false,
    sessionCount: 3,
    changeCount: 1,
    sessions: [],
    ...overrides,
  };
}

// --- colorize ---

describe("colorize", () => {
  it("colorizes observation tags", () => {
    const input = "[12:00:00] [observation] 3 sessions, 1 changed";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[2m"), "should contain DIM escape code");
    assert.ok(output.includes("observation"), "should contain the tag text");
  });

  it("colorizes 'you' tags in green", () => {
    const input = "[12:00:00] [you] check on agent-a please";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[32m"), "should contain GREEN escape code");
  });

  it("colorizes 'reasoner' tags in cyan", () => {
    const input = "[12:00:00] [reasoner] all agents are progressing well";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[36m"), "should contain CYAN escape code");
  });

  it("colorizes '+ action' tags in yellow", () => {
    const input = "[12:00:00] [+ action] send_input to session-1";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[33m"), "should contain YELLOW escape code");
  });

  it("colorizes '! action' tags in red", () => {
    const input = "[12:00:00] [! action] failed to send input";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[31m"), "should contain RED escape code");
  });

  it("colorizes 'system' tags as dim", () => {
    const input = "[12:00:00] [system] verbose toggled on";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[2m"), "should contain DIM escape code");
  });

  it("leaves untagged lines unchanged", () => {
    const input = "some plain text without tags";
    const output = colorize(input);
    assert.equal(output, input);
  });

  it("handles multiline text", () => {
    const input = "[12:00:00] [you] hello\n[12:00:01] [reasoner] hi back\nplain line";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[32m"), "should colorize 'you' line");
    assert.ok(output.includes("\x1b[36m"), "should colorize 'reasoner' line");
    assert.ok(output.includes("plain line"), "should preserve plain lines");
  });

  it("handles empty string", () => {
    assert.equal(colorize(""), "");
  });
});

// --- isDaemonRunningFromState ---

describe("isDaemonRunningFromState", () => {
  it("returns false for null state", () => {
    assert.equal(isDaemonRunningFromState(null), false);
  });

  it("returns true when state is recent", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now - 5_000, pollIntervalMs: 10_000 });
    assert.equal(isDaemonRunningFromState(state, now), true);
  });

  it("returns false when state is stale (beyond stale threshold)", () => {
    const now = Date.now();
    // pollIntervalMs=10_000 -> staleMs = max(20_000, 30_000) = 30_000
    // 35s > 30s -> stale
    const state = makeState({ phaseStartedAt: now - 35_000, pollIntervalMs: 10_000 });
    assert.equal(isDaemonRunningFromState(state, now), false);
  });

  it("uses 30s minimum staleness threshold", () => {
    const now = Date.now();
    // pollInterval is 5s -> 2x = 10s, but minimum is 30s
    const state = makeState({ phaseStartedAt: now - 15_000, pollIntervalMs: 5_000 });
    assert.equal(isDaemonRunningFromState(state, now), true, "15s should be within 30s minimum");
  });

  it("returns false when beyond 30s minimum threshold", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now - 35_000, pollIntervalMs: 5_000 });
    assert.equal(isDaemonRunningFromState(state, now), false, "35s exceeds 30s minimum");
  });

  it("handles high poll intervals correctly", () => {
    const now = Date.now();
    // pollInterval is 60s -> staleMs = 120s
    const state = makeState({ phaseStartedAt: now - 100_000, pollIntervalMs: 60_000 });
    assert.equal(isDaemonRunningFromState(state, now), true, "100s within 120s threshold");
  });

  it("edge case: phaseStartedAt equals now", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now });
    assert.equal(isDaemonRunningFromState(state, now), true);
  });
});

// --- getCountdownFromState ---

describe("getCountdownFromState", () => {
  it("returns null for null state", () => {
    assert.equal(getCountdownFromState(null, false), null);
  });

  it("returns null when daemon is not running", () => {
    const state = makeState();
    assert.equal(getCountdownFromState(state, false), null);
  });

  it("returns null when phase is not sleeping", () => {
    const state = makeState({ phase: "reasoning", nextTickAt: Date.now() + 10_000 });
    assert.equal(getCountdownFromState(state, true), null);
  });

  it("returns remaining seconds when sleeping with nextTickAt", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now + 7_500 });
    const countdown = getCountdownFromState(state, true, now);
    assert.equal(countdown, 8); // ceil(7500/1000)
  });

  it("returns 0 when nextTickAt is in the past", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now - 1_000 });
    assert.equal(getCountdownFromState(state, true, now), 0);
  });

  it("returns exact seconds for round numbers", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now + 5_000 });
    assert.equal(getCountdownFromState(state, true, now), 5);
  });

  it("returns null when nextTickAt is 0 (not set)", () => {
    const state = makeState({ phase: "sleeping", nextTickAt: 0 });
    assert.equal(getCountdownFromState(state, true), null);
  });
});

// --- buildStatusLineFromState ---

describe("buildStatusLineFromState", () => {
  it("returns null when daemon not running and not forTitle", () => {
    assert.equal(buildStatusLineFromState(null, false), null);
  });

  it("returns offline string when daemon not running and forTitle", () => {
    assert.equal(buildStatusLineFromState(null, false, true), "aoaoe (daemon offline)");
  });

  it("shows countdown when sleeping", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now + 7_000, sessionCount: 3, pollCount: 10 });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("next: 7s"), `expected 'next: 7s' in '${line}'`);
    assert.ok(line?.includes("3 sessions"));
    assert.ok(line?.includes("poll #10"));
  });

  it("shows elapsed time when reasoning", () => {
    const now = Date.now();
    const state = makeState({ phase: "reasoning", phaseStartedAt: now - 5_000, sessionCount: 2, pollCount: 3 });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("reasoning: 5s"), `expected 'reasoning: 5s' in '${line}'`);
  });

  it("shows phase name for other phases", () => {
    const now = Date.now();
    const state = makeState({ phase: "executing", sessionCount: 1, pollCount: 7 });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("executing"), `expected 'executing' in '${line}'`);
  });

  it("shows PAUSED when paused", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now + 5_000, paused: true });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("PAUSED"), `expected 'PAUSED' in '${line}'`);
  });

  it("does not show PAUSED when not paused", () => {
    const now = Date.now();
    const state = makeState({ phase: "sleeping", nextTickAt: now + 5_000, paused: false });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(!line?.includes("PAUSED"), `should not contain 'PAUSED' in '${line}'`);
  });

  it("formats all parts with pipe separator", () => {
    const now = Date.now();
    const state = makeState({ phase: "polling", sessionCount: 4, pollCount: 15 });
    const line = buildStatusLineFromState(state, true, false, now);
    const pipes = (line?.match(/\|/g) ?? []).length;
    assert.ok(pipes >= 2, `expected at least 2 pipe separators in '${line}'`);
  });

  it("returns offline for forTitle when state is null", () => {
    assert.equal(buildStatusLineFromState(null, false, true), "aoaoe (daemon offline)");
  });

  it("returns offline for forTitle when daemon not running", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now - 100_000, pollIntervalMs: 10_000 });
    // daemon is stale, but we pass daemonRunning=false
    assert.equal(buildStatusLineFromState(state, false, true), "aoaoe (daemon offline)");
  });
});
