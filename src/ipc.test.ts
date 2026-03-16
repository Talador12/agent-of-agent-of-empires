import { describe, it, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// IPC integration tests: validates the cross-module daemon<->chat contract
// using isolated state files. Tests the IPC path between:
// - daemon-state.ts (writeState, readState, interrupt flag)
// - chat.ts (isDaemonRunning, getCountdown, buildStatusLine)

import { writeState, readState, requestInterrupt, checkInterrupt, clearInterrupt, cleanupState, resetInternalState, setStateDir } from "./daemon-state.js";
import { isDaemonRunningFromState, getCountdownFromState, buildStatusLineFromState } from "./chat.js";

// each test file gets its own temp dir so parallel test processes don't race
const TEST_STATE_DIR = join(tmpdir(), `aoaoe-ipc-test-${process.pid}-${Date.now()}`);
mkdirSync(TEST_STATE_DIR, { recursive: true });
setStateDir(TEST_STATE_DIR);

describe("IPC — daemon lifecycle simulation", () => {
  beforeEach(() => {
    cleanupState();
    resetInternalState();
  });

  afterEach(() => {
    cleanupState();
    clearInterrupt();
  });

  it("simulates a full daemon tick as seen by chat", () => {
    const now = Date.now();

    // 1. daemon starts polling
    writeState("polling", { pollCount: 1, pollIntervalMs: 10_000, tickStartedAt: now, sessionCount: 2 });
    let state = readState()!;
    assert.equal(isDaemonRunningFromState(state, now), true);
    let line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("polling"));

    // 2. daemon enters reasoning
    writeState("reasoning", { pollCount: 1, pollIntervalMs: 10_000, sessionCount: 2 });
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

  after(() => {
    cleanupState();
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });
});
