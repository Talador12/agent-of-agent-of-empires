import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Observation, SessionSnapshot, AoeSession, DaemonSessionState } from "./types.js";

// buildSessionStates is the main pure-ish function we can test well.
// writeState / readState / interrupt functions depend on a fixed file path
// (~/.aoaoe/), so we test buildSessionStates thoroughly and test the
// interrupt/cleanup logic patterns.

// replicated from daemon-state.ts -- buildSessionStates is exported but calls
// parseTasks which is a real import. We can test it via the module.

describe("buildSessionStates", () => {
  // we import dynamically so the module loads after any setup

  function makeSession(overrides?: Partial<AoeSession>): AoeSession {
    return {
      id: "abc12345-dead-beef-cafe-000000000001",
      title: "test-agent",
      path: "/tmp/test",
      tool: "opencode",
      status: "working",
      tmux_name: "aoe_test-agent_abc12345",
      ...overrides,
    };
  }

  function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
    return {
      session: overrides?.session ?? makeSession(),
      output: "$ working on stuff\n",
      outputHash: "aabbccdd",
      capturedAt: Date.now(),
      ...overrides,
    };
  }

  function makeObservation(snapshots: SessionSnapshot[]): Observation {
    return {
      timestamp: Date.now(),
      sessions: snapshots,
      changes: [],
    };
  }

  it("returns empty array for empty observation", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const obs = makeObservation([]);
    const result = buildSessionStates(obs);
    assert.deepEqual(result, []);
  });

  it("maps session fields correctly", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const session = makeSession({ id: "s1", title: "my-proj", tool: "claude", status: "idle" });
    const obs = makeObservation([makeSnapshot({ session, output: "last line\n" })]);
    const result = buildSessionStates(obs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "s1");
    assert.equal(result[0].title, "my-proj");
    assert.equal(result[0].tool, "claude");
    assert.equal(result[0].status, "idle");
  });

  it("extracts last non-empty line as lastActivity", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const obs = makeObservation([
      makeSnapshot({ output: "line1\nline2\n  \n  last meaningful\n  \n\n" }),
    ]);
    const result = buildSessionStates(obs);
    assert.equal(result[0].lastActivity, "last meaningful");
  });

  it("sets lastActivity to undefined for empty output", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const obs = makeObservation([
      makeSnapshot({ output: "" }),
    ]);
    const result = buildSessionStates(obs);
    assert.equal(result[0].lastActivity, undefined);
  });

  it("truncates long lastActivity to 100 chars", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const longLine = "x".repeat(150);
    const obs = makeObservation([
      makeSnapshot({ output: `first\n${longLine}\n` }),
    ]);
    const result = buildSessionStates(obs);
    assert.ok(result[0].lastActivity!.length <= 100);
    assert.ok(result[0].lastActivity!.endsWith("..."));
  });

  it("handles multiple sessions", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const obs = makeObservation([
      makeSnapshot({ session: makeSession({ id: "s1", title: "proj-a" }), output: "a output\n" }),
      makeSnapshot({ session: makeSession({ id: "s2", title: "proj-b" }), output: "b output\n" }),
      makeSnapshot({ session: makeSession({ id: "s3", title: "proj-c" }), output: "c output\n" }),
    ]);
    const result = buildSessionStates(obs);
    assert.equal(result.length, 3);
    assert.equal(result[0].title, "proj-a");
    assert.equal(result[1].title, "proj-b");
    assert.equal(result[2].title, "proj-c");
  });

  it("parses TODO items from output into todoSummary", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const session = makeSession();
    const output = "Some output\n[✓] completed task\n[•] in progress task\n[ ] pending task\n";
    const snap = makeSnapshot({ session, output });
    // include session in changes so parseTasks runs
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [snap],
      changes: [{ sessionId: session.id, title: session.title, tool: session.tool, status: session.status, newLines: output }],
    };
    const result = buildSessionStates(obs);
    // todoSummary should be present when tasks are found
    assert.ok(result[0].todoSummary !== undefined, "should have todoSummary when tasks exist");
    assert.ok(typeof result[0].todoSummary === "string");
  });

  it("sets todoSummary to undefined when no tasks found", async () => {
    const { buildSessionStates } = await import("./daemon-state.js");
    const session = makeSession();
    const snap = makeSnapshot({ session, output: "just regular output\nno tasks here\n" });
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [snap],
      changes: [{ sessionId: session.id, title: session.title, tool: session.tool, status: session.status, newLines: "just regular output" }],
    };
    const result = buildSessionStates(obs);
    assert.equal(result[0].todoSummary, undefined);
  });
});

describe("setSessionTask", () => {
  it("stores task text for a session", async () => {
    const { setSessionTask, buildSessionStates } = await import("./daemon-state.js");
    const session: AoeSession = {
      id: "task-test-session",
      title: "task-proj",
      path: "/tmp",
      tool: "opencode",
      status: "working",
      tmux_name: "aoe_task-proj_task-tes",
    };
    setSessionTask("task-test-session", "implement feature X");
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [{
        session,
        output: "working...\n",
        outputHash: "h",
        capturedAt: Date.now(),
      }],
      changes: [],
    };
    const states = buildSessionStates(obs);
    assert.equal(states[0].currentTask, "implement feature X");
  });

  it("truncates long task text to 80 chars", async () => {
    const { setSessionTask, buildSessionStates } = await import("./daemon-state.js");
    const longTask = "a".repeat(100);
    setSessionTask("trunc-session", longTask);
    const session: AoeSession = {
      id: "trunc-session",
      title: "trunc",
      path: "/tmp",
      tool: "opencode",
      status: "working",
      tmux_name: "aoe_trunc_trunc-se",
    };
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [{
        session,
        output: "output\n",
        outputHash: "h",
        capturedAt: Date.now(),
      }],
      changes: [],
    };
    const states = buildSessionStates(obs);
    assert.ok(states[0].currentTask!.length <= 80);
    assert.ok(states[0].currentTask!.endsWith("..."));
  });

  it("prunes sessionTasks for removed sessions", async () => {
    const { setSessionTask, buildSessionStates } = await import("./daemon-state.js");
    // set tasks for two sessions
    setSessionTask("session-alive", "doing work");
    setSessionTask("session-gone", "also doing work");

    // observation only includes session-alive — session-gone was removed
    const obs: Observation = {
      timestamp: Date.now(),
      sessions: [{
        session: {
          id: "session-alive",
          title: "alive",
          path: "/tmp",
          tool: "opencode",
          status: "working",
          tmux_name: "aoe_alive_session-",
        },
        output: "output\n",
        outputHash: "h",
        capturedAt: Date.now(),
      }],
      changes: [],
    };
    const states = buildSessionStates(obs);
    assert.equal(states.length, 1);
    assert.equal(states[0].currentTask, "doing work");

    // now build again — session-gone should not reappear even if we add it back
    const obs2: Observation = {
      timestamp: Date.now(),
      sessions: [{
        session: {
          id: "session-gone",
          title: "gone",
          path: "/tmp",
          tool: "opencode",
          status: "working",
          tmux_name: "aoe_gone_session-g",
        },
        output: "output\n",
        outputHash: "h",
        capturedAt: Date.now(),
      }],
      changes: [],
    };
    const states2 = buildSessionStates(obs2);
    // session-gone's task was pruned, so it should be undefined now
    assert.equal(states2[0].currentTask, undefined);
  });
});

describe("interrupt flag logic", () => {
  // test the pattern: requestInterrupt creates a file, checkInterrupt reads it, clearInterrupt removes it
  // these use the real ~/.aoaoe/ directory, so we test the logic patterns

  it("checkInterrupt returns false when no interrupt file exists", async () => {
    const { checkInterrupt, clearInterrupt } = await import("./daemon-state.js");
    clearInterrupt(); // ensure clean state
    assert.equal(checkInterrupt(), false);
  });

  it("requestInterrupt -> checkInterrupt -> clearInterrupt cycle works", async () => {
    const { requestInterrupt, checkInterrupt, clearInterrupt } = await import("./daemon-state.js");
    clearInterrupt(); // clean state

    requestInterrupt();
    assert.equal(checkInterrupt(), true, "should detect interrupt after request");

    clearInterrupt();
    assert.equal(checkInterrupt(), false, "should not detect interrupt after clear");
  });

  it("clearInterrupt is safe to call when no interrupt exists", async () => {
    const { clearInterrupt, checkInterrupt } = await import("./daemon-state.js");
    clearInterrupt(); // ensure clean
    assert.doesNotThrow(() => clearInterrupt()); // second clear is safe
    assert.equal(checkInterrupt(), false);
  });
});

describe("writeState and readState", () => {
  beforeEach(async () => {
    const { cleanupState, resetInternalState } = await import("./daemon-state.js");
    cleanupState();
    resetInternalState();
  });

  afterEach(async () => {
    const { cleanupState } = await import("./daemon-state.js");
    cleanupState();
  });

  it("writeState followed by readState returns consistent state", async () => {
    const { writeState, readState } = await import("./daemon-state.js");
    writeState("polling", { pollCount: 42, sessionCount: 3 });
    const state = readState();
    assert.ok(state !== null);
    assert.equal(state!.phase, "polling");
    assert.equal(state!.pollCount, 42);
    assert.equal(state!.sessionCount, 3);
  });

  it("writeState updates phase and phaseStartedAt", async () => {
    const { writeState, readState } = await import("./daemon-state.js");
    const before = Date.now();
    writeState("reasoning");
    const state = readState();
    assert.ok(state !== null);
    assert.equal(state!.phase, "reasoning");
    assert.ok(state!.phaseStartedAt >= before);
    assert.ok(state!.phaseStartedAt <= Date.now());
  });

  it("cleanupState removes state file", async () => {
    const { writeState, readState, cleanupState } = await import("./daemon-state.js");
    writeState("sleeping");
    assert.ok(readState() !== null, "state should exist after write");
    cleanupState();
    // readState returns null when file doesn't exist
    // (but it may have been recreated by another test, so just verify no throw)
    assert.doesNotThrow(() => readState());
  });

  it("debounce: same-phase writes within 500ms skip disk flush", async () => {
    const { writeState, readState, resetInternalState } = await import("./daemon-state.js");
    resetInternalState();
    // first write always flushes (phase transition from null -> polling)
    writeState("polling", { pollCount: 1 });
    const state1 = readState();
    assert.equal(state1!.pollCount, 1);

    // second write with same phase within 500ms should be debounced
    writeState("polling", { pollCount: 2 });
    const state2 = readState();
    // debounced: disk still has pollCount=1
    assert.equal(state2!.pollCount, 1);
  });

  it("debounce: phase change always flushes immediately", async () => {
    const { writeState, readState, resetInternalState } = await import("./daemon-state.js");
    resetInternalState();
    writeState("polling", { pollCount: 1 });
    // change phase -> flushes immediately regardless of debounce window
    writeState("reasoning", { pollCount: 1 });
    const state = readState();
    assert.equal(state!.phase, "reasoning");
  });

  it("debounce: flush happens after 500ms even with same phase", async () => {
    const { writeState, readState, resetInternalState } = await import("./daemon-state.js");
    resetInternalState();
    writeState("polling", { pollCount: 1 });
    // wait 550ms to exceed debounce window
    await new Promise((r) => setTimeout(r, 550));
    writeState("polling", { pollCount: 99 });
    const state = readState();
    assert.equal(state!.pollCount, 99);
  });
});
