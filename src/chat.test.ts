import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colorize, isDaemonRunningFromState, getCountdownFromState, buildStatusLineFromState, formatCompactSessions, formatSessionsList } from "./chat.js";
import type { DaemonState, DaemonSessionState } from "./types.js";

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

  it("colorizes 'status' tags as dim", () => {
    const input = "[12:00:00] [status] reasoning...";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[2m"), "should contain DIM escape code");
    assert.ok(output.includes("status"), "should contain the tag text");
  });

  it("handles multiline text", () => {
    const input = "[12:00:00] [you] hello\n[12:00:01] [reasoner] hi back\nplain line";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[32m"), "should colorize 'you' line");
    assert.ok(output.includes("\x1b[36m"), "should colorize 'reasoner' line");
    assert.ok(output.includes("plain line"), "should preserve plain lines");
  });

  it("colorizes status receipts", () => {
    const input = "[12:00:00] [status] received (1/2): fix the bug";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[2m"), "receipt should be dim");
    assert.ok(output.includes("fix the bug"), "should preserve content");
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
    // pollIntervalMs=10_000 -> staleMs = max(20_000, 120_000) = 120_000
    // 125s > 120s -> stale
    const state = makeState({ phaseStartedAt: now - 125_000, pollIntervalMs: 10_000 });
    assert.equal(isDaemonRunningFromState(state, now), false);
  });

  it("uses 120s minimum staleness threshold (covers reasoning phase)", () => {
    const now = Date.now();
    // pollInterval is 5s -> 2x = 10s, but minimum is 120s to cover 90s+ reasoning calls
    const state = makeState({ phaseStartedAt: now - 90_000, pollIntervalMs: 5_000 });
    assert.equal(isDaemonRunningFromState(state, now), true, "90s should be within 120s minimum");
  });

  it("returns false when beyond 120s minimum threshold", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now - 125_000, pollIntervalMs: 5_000 });
    assert.equal(isDaemonRunningFromState(state, now), false, "125s exceeds 120s minimum");
  });

  it("handles high poll intervals correctly", () => {
    const now = Date.now();
    // pollInterval is 120s -> staleMs = max(240_000, 120_000) = 240_000
    const state = makeState({ phaseStartedAt: now - 200_000, pollIntervalMs: 120_000 });
    assert.equal(isDaemonRunningFromState(state, now), true, "200s within 240s threshold");
  });

  it("does not false-positive stale during long reasoning calls", () => {
    const now = Date.now();
    // reasoning can take 90s — daemon at 85s into reasoning should still be "running"
    const state = makeState({ phaseStartedAt: now - 85_000, pollIntervalMs: 10_000, phase: "reasoning" });
    assert.equal(isDaemonRunningFromState(state, now), true, "85s reasoning should not be stale");
  });


});

// --- getCountdownFromState ---

describe("getCountdownFromState", () => {
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


});

// --- buildStatusLineFromState ---

describe("buildStatusLineFromState", () => {
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

  it("returns offline for forTitle when daemon not running", () => {
    const now = Date.now();
    const state = makeState({ phaseStartedAt: now - 100_000, pollIntervalMs: 10_000 });
    // daemon is stale, but we pass daemonRunning=false
    assert.equal(buildStatusLineFromState(state, false, true), "aoaoe (daemon offline)");
  });

  it("shows session names and statuses when sessions available", () => {
    const now = Date.now();
    const sessions: DaemonSessionState[] = [
      { id: "1", title: "adventure", tool: "opencode", status: "working" },
      { id: "2", title: "chv", tool: "opencode", status: "idle" },
    ];
    const state = makeState({ phase: "sleeping", nextTickAt: now + 5_000, sessions, sessionCount: 2, pollCount: 10 });
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("adventure: working"), `expected session info in '${line}'`);
    assert.ok(line?.includes("chv: idle"), `expected session info in '${line}'`);
  });

  it("falls back to session count for forTitle mode", () => {
    const now = Date.now();
    const sessions: DaemonSessionState[] = [
      { id: "1", title: "adventure", tool: "opencode", status: "working" },
    ];
    const state = makeState({ phase: "sleeping", nextTickAt: now + 5_000, sessions, sessionCount: 1, pollCount: 5 });
    const line = buildStatusLineFromState(state, true, true, now);
    assert.ok(line?.includes("1 sessions"), `forTitle should use count, got '${line}'`);
  });
});

// --- formatCompactSessions ---

describe("formatCompactSessions", () => {
  it("formats multiple sessions", () => {
    const sessions: DaemonSessionState[] = [
      { id: "1", title: "adventure", tool: "opencode", status: "working" },
      { id: "2", title: "cloud-hyp", tool: "opencode", status: "idle" },
    ];
    const result = formatCompactSessions(sessions);
    assert.ok(result.includes("adventure: working"));
    assert.ok(result.includes("cloud-hyp: idle"));
  });

  it("truncates long titles to 12 chars", () => {
    const sessions: DaemonSessionState[] = [
      { id: "1", title: "a-very-long-session-name", tool: "opencode", status: "working" },
    ];
    const result = formatCompactSessions(sessions);
    assert.ok(result.includes("a-very-lon.."), `expected truncated title in '${result}'`);
    assert.ok(!result.includes("a-very-long-session-name"), "full title should not appear");
  });

  it("returns '0 sessions' for empty array", () => {
    assert.equal(formatCompactSessions([]), "0 sessions");
  });
});

// --- formatSessionsList ---

describe("formatSessionsList", () => {
  it("shows session details with icons", () => {
    const state = makeState({
      sessions: [
        { id: "1", title: "adventure", tool: "opencode", status: "working", lastActivity: "editing auth.tsx" },
        { id: "2", title: "chv", tool: "opencode", status: "idle", lastActivity: "cargo build done" },
      ],
    });
    const result = formatSessionsList(state);
    assert.ok(result.includes("~ adventure"), "working session should have ~ icon");
    assert.ok(result.includes(". chv"), "idle session should have . icon");
    assert.ok(result.includes("editing auth.tsx"));
    assert.ok(result.includes("cargo build done"));
  });

  it("shows current task when present", () => {
    const state = makeState({
      sessions: [
        { id: "1", title: "proj", tool: "opencode", status: "working", currentTask: "fix bug #123", lastActivity: "running tests" },
      ],
    });
    const result = formatSessionsList(state);
    assert.ok(result.includes("task: fix bug #123"));
  });

  it("shows '(no output)' when no lastActivity", () => {
    const state = makeState({
      sessions: [
        { id: "1", title: "proj", tool: "opencode", status: "working" },
      ],
    });
    const result = formatSessionsList(state);
    assert.ok(result.includes("(no output)"));
  });

  it("returns '(no sessions)' for empty sessions", () => {
    const state = makeState({ sessions: [] });
    const result = formatSessionsList(state);
    assert.ok(result.includes("(no sessions)"));
  });
});

// --- colorize tick separators ---

describe("colorize tick separators", () => {
  it("colorizes tick separator lines as dim", () => {
    const input = "──── tick #42 ────";
    const output = colorize(input);
    assert.ok(output.includes("\x1b[2m"), "separator should have DIM escape code");
    assert.ok(output.includes("tick #42"));
  });

  it("colorizes separator mixed with other entries", () => {
    const input = "──── tick #5 ────\n10:30:00 [you] hello\n──── tick #6 ────";
    const output = colorize(input);
    // both separators should be dim
    const dimCount = (output.match(/\x1b\[2m/g) ?? []).length;
    assert.ok(dimCount >= 2, `expected at least 2 DIM codes, got ${dimCount}`);
    // user message should be green
    assert.ok(output.includes("\x1b[32m"), "user message should be green");
  });

  it("does not colorize lines with only a few dashes", () => {
    const input = "- a list item";
    const output = colorize(input);
    assert.equal(output, input, "single dash should not trigger separator coloring");
  });
});
