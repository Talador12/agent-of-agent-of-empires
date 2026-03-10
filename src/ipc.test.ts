import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

// IPC integration tests: validates the daemon<->chat communication patterns
// using real files in a temp directory. Tests the contract between:
// - daemon-state.ts (writeState, readState, interrupt flag)
// - console.ts (conversation log, pending-input)
// - chat.ts (isDaemonRunning, getCountdown, colorize, buildStatusLine)

import { writeState, readState, requestInterrupt, checkInterrupt, clearInterrupt, cleanupState, buildSessionStates } from "./daemon-state.js";
import { isDaemonRunningFromState, getCountdownFromState, buildStatusLineFromState, colorize } from "./chat.js";
import type { DaemonState, Observation, SessionSnapshot, AoeSession } from "./types.js";

// --- helpers ---

function makeSession(overrides?: Partial<AoeSession>): AoeSession {
  return {
    id: "ipc-test-" + randomBytes(4).toString("hex"),
    title: "ipc-test-agent",
    path: "/tmp/test",
    tool: "opencode",
    status: "working",
    tmux_name: "aoe_ipc-test_12345678",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  const session = overrides?.session ?? makeSession();
  return {
    session,
    output: "compiling src/index.ts...\nbuild complete\n",
    outputHash: "testhash",
    capturedAt: Date.now(),
    ...overrides,
  };
}

// --- IPC: daemon state round-trip ---

describe("IPC — daemon state round-trip", () => {
  it("writeState -> readState preserves all fields", () => {
    writeState("polling", {
      pollCount: 42,
      pollIntervalMs: 15_000,
      sessionCount: 3,
      changeCount: 1,
      tickStartedAt: Date.now(),
    });
    const state = readState();
    assert.ok(state);
    assert.equal(state.phase, "polling");
    assert.equal(state.pollCount, 42);
    assert.equal(state.pollIntervalMs, 15_000);
    assert.equal(state.sessionCount, 3);
    assert.equal(state.changeCount, 1);
  });

  it("phase transitions are reflected immediately", () => {
    const t0 = Date.now();
    writeState("polling", { pollCount: 1 });
    assert.equal(readState()?.phase, "polling");

    writeState("reasoning", { pollCount: 1 });
    assert.equal(readState()?.phase, "reasoning");

    writeState("executing", { pollCount: 1 });
    assert.equal(readState()?.phase, "executing");

    writeState("sleeping", { pollCount: 1, nextTickAt: t0 + 10_000 });
    assert.equal(readState()?.phase, "sleeping");
    assert.ok(readState()!.nextTickAt > t0);
  });

  it("chat can determine daemon liveness from state", () => {
    const now = Date.now();

    // fresh state -> daemon running
    writeState("polling", { pollCount: 1, pollIntervalMs: 10_000 });
    const state1 = readState();
    assert.equal(isDaemonRunningFromState(state1, now), true);

    // no state -> not running
    assert.equal(isDaemonRunningFromState(null), false);
  });

  it("chat can compute countdown from sleeping state", () => {
    const now = Date.now();
    writeState("sleeping", { pollCount: 5, pollIntervalMs: 10_000, nextTickAt: now + 8_000 });

    const state = readState()!;
    const countdown = getCountdownFromState(state, true, now);
    assert.equal(countdown, 8);
  });

  it("chat status line reflects daemon phase changes", () => {
    const now = Date.now();

    writeState("reasoning", { pollCount: 3, sessionCount: 2, pollIntervalMs: 10_000 });
    const state1 = readState()!;
    const line1 = buildStatusLineFromState(state1, true, false, now);
    assert.ok(line1?.includes("reasoning"));

    writeState("sleeping", { pollCount: 3, sessionCount: 2, pollIntervalMs: 10_000, nextTickAt: now + 5_000 });
    const state2 = readState()!;
    const line2 = buildStatusLineFromState(state2, true, false, now);
    assert.ok(line2?.includes("next: 5s"));
  });
});

// --- IPC: interrupt flag ---

describe("IPC — interrupt flag", () => {
  afterEach(() => {
    clearInterrupt();
  });

  it("request -> check -> clear lifecycle", () => {
    assert.equal(checkInterrupt(), false);
    requestInterrupt();
    assert.equal(checkInterrupt(), true);
    clearInterrupt();
    assert.equal(checkInterrupt(), false);
  });

  it("double clear is safe", () => {
    requestInterrupt();
    clearInterrupt();
    clearInterrupt(); // should not throw
    assert.equal(checkInterrupt(), false);
  });

  it("interrupt without prior request returns false", () => {
    clearInterrupt(); // ensure clean
    assert.equal(checkInterrupt(), false);
  });
});

// --- IPC: session state building ---

describe("IPC — session state building", () => {
  it("buildSessionStates creates DaemonSessionState from Observation", () => {
    const snap = makeSnapshot({
      output: "running tests...\n✓ 42 tests passed\n",
    });
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [snap],
      changes: [],
    };

    const states = buildSessionStates(obs);
    assert.equal(states.length, 1);
    assert.equal(states[0].title, snap.session.title);
    assert.equal(states[0].tool, snap.session.tool);
    assert.equal(states[0].status, snap.session.status);
    assert.ok(states[0].lastActivity?.includes("42 tests passed"));
  });

  it("multiple sessions are all represented", () => {
    const snap1 = makeSnapshot({ session: makeSession({ title: "agent-a" }) });
    const snap2 = makeSnapshot({ session: makeSession({ title: "agent-b", status: "idle" }) });
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [snap1, snap2],
      changes: [],
    };

    const states = buildSessionStates(obs);
    assert.equal(states.length, 2);
    assert.equal(states[0].title, "agent-a");
    assert.equal(states[1].title, "agent-b");
    assert.equal(states[1].status, "idle");
  });
});

// --- IPC: conversation log format ---

describe("IPC — conversation log colorization", () => {
  it("full conversation log entry is colorized correctly", () => {
    const logLines = [
      "[12:00:00] [observation] 3 sessions, 1 changed",
      "[12:00:01] [reasoner] agent-a is stuck, sending nudge",
      "[12:00:02] [+ action] send_input -> agent-a: try npm test",
      "[12:00:03] [you] check on agent-b",
      "[12:00:04] [system] verbose toggled",
    ].join("\n");

    const colored = colorize(logLines);
    // every line should have been colorized (contains escape codes)
    const lines = colored.split("\n");
    for (const line of lines) {
      assert.ok(line.includes("\x1b["), `expected escape code in: ${line}`);
    }
  });

  it("action failure lines use red", () => {
    const line = "[12:00:00] [! action] failed to start session abc123";
    const colored = colorize(line);
    assert.ok(colored.includes("\x1b[31m"), "should use RED for failed actions");
  });
});

// --- IPC: end-to-end daemon lifecycle simulation ---

describe("IPC — daemon lifecycle simulation", () => {
  afterEach(() => {
    cleanupState();
    clearInterrupt();
  });

  it("simulates a full daemon tick as seen by chat", () => {
    const now = Date.now();

    // 1. daemon starts polling
    writeState("polling", { pollCount: 1, pollIntervalMs: 10_000, tickStartedAt: now });
    let state = readState()!;
    assert.equal(isDaemonRunningFromState(state, now), true);
    let line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("polling"));

    // 2. daemon enters reasoning
    writeState("reasoning", { pollCount: 1, pollIntervalMs: 10_000 });
    state = readState()!;
    line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("reasoning"));

    // 3. chat sends interrupt during reasoning
    requestInterrupt();
    assert.equal(checkInterrupt(), true);
    clearInterrupt();

    // 4. daemon finishes, goes to sleep
    writeState("sleeping", { pollCount: 1, pollIntervalMs: 10_000, nextTickAt: now + 10_000 });
    state = readState()!;
    const countdown = getCountdownFromState(state, true, now);
    assert.equal(countdown, 10);

    // 5. daemon shuts down
    cleanupState();
    assert.equal(readState(), null);
    assert.equal(isDaemonRunningFromState(null), false);
  });

  it("simulates paused daemon", () => {
    const now = Date.now();
    writeState("sleeping", { pollCount: 5, pollIntervalMs: 10_000, paused: true });

    const state = readState()!;
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("PAUSED"));
  });
});
