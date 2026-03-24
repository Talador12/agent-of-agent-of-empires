// e2e.test.ts — end-to-end integration tests
// Wires together: tick() (with mocks) → daemon state IPC → chat state readers.
// Validates the full daemon→IPC→chat pipeline without real processes, tmux, or LLMs.
//
// The three modules under test:
//   loop.ts    — tick() pure logic (poll → reason → execute)
//   daemon-state.ts — writeState/readState/buildSessionStates (IPC state file)
//   chat.ts    — isDaemonRunningFromState, buildStatusLineFromState, formatSessionsList, getCountdownFromState

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { tick, type PollerLike, type ExecutorLike, type ActionResult } from "./loop.js";
import { writeState, readState, buildSessionStates, cleanupState, resetInternalState, setSessionTask, setStateDir } from "./daemon-state.js";
import { isDaemonRunningFromState, getCountdownFromState, buildStatusLineFromState, formatSessionsList } from "./chat.js";
import type { Observation, Reasoner, ReasonerResult, Action, AoaoeConfig, SessionSnapshot, AoeSession, SessionChange } from "./types.js";
import type { SessionPolicyState } from "./reasoner/prompt.js";

// each test file gets its own temp dir so parallel test processes don't race
const TEST_STATE_DIR = join(tmpdir(), `aoaoe-e2e-test-${process.pid}-${Date.now()}`);
mkdirSync(TEST_STATE_DIR, { recursive: true });
setStateDir(TEST_STATE_DIR);

// ── test fixtures ───────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<AoeSession>): AoeSession {
  return {
    id: "abc12345-dead-beef-cafe-000000000001",
    title: "test-agent",
    path: "/tmp/test-project",
    tool: "opencode",
    status: "working",
    tmux_name: "aoe_test-agent_abc12345",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  const session = overrides?.session ?? makeSession();
  return {
    session,
    output: "$ some terminal output\nworking on task...\n",
    outputHash: "aabbccdd",
    capturedAt: Date.now(),
    ...overrides,
  };
}

function makeObservation(snapshots: SessionSnapshot[], changes?: Observation["changes"]): Observation {
  return {
    timestamp: Date.now(),
    sessions: snapshots,
    changes: changes ?? [],
  };
}

function defaultConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    reasonIntervalMs: 60_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: true, resume: true },
    aoe: { profile: "default" },
    policies: {
      maxIdleBeforeNudgeMs: 120_000,
      maxErrorsBeforeRestart: 3,
      autoAnswerPermissions: true,
    },
    contextFiles: [],
    sessionDirs: {},
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    observe: false,
    confirm: false,
    protectedSessions: [],
    ...overrides,
  };
}

// ── mock implementations ────────────────────────────────────────────────────

class MockPoller implements PollerLike {
  private observations: Observation[] = [];
  private callIndex = 0;

  enqueue(...obs: Observation[]) {
    this.observations.push(...obs);
  }

  async poll(): Promise<Observation> {
    const idx = Math.min(this.callIndex, this.observations.length - 1);
    this.callIndex++;
    return this.observations[idx] ?? makeObservation([]);
  }
}

class MockReasoner implements Reasoner {
  private responses: ReasonerResult[] = [];
  private callIndex = 0;
  calls: Observation[] = [];

  enqueue(...results: ReasonerResult[]) {
    this.responses.push(...results);
  }

  async init() {}

  async decide(observation: Observation): Promise<ReasonerResult> {
    this.calls.push(observation);
    const idx = Math.min(this.callIndex, this.responses.length - 1);
    this.callIndex++;
    return this.responses[idx] ?? { actions: [{ action: "wait" }] };
  }

  async shutdown() {}
}

class MockExecutor implements ExecutorLike {
  executed: Array<{ actions: Action[]; snapshots: SessionSnapshot[] }> = [];

  async execute(actions: Action[], snapshots: SessionSnapshot[]): Promise<ActionResult[]> {
    this.executed.push({ actions, snapshots });
    return actions.map((a) => ({
      action: a,
      success: true,
      detail: `mock executed ${a.action}`,
    }));
  }
}

// ── helper: simulate what daemonTick() does after tick() returns ────────────
// In the real daemon, index.ts calls buildSessionStates(obs) + writeState()
// after each tick. This helper replicates that IPC write path.
// Note: resetInternalState() clears writeState's debounce timer so sequential
// writes to the same phase (e.g. two "sleeping" writes) always flush to disk.
function simulateDaemonStateWrite(
  tickResult: Awaited<ReturnType<typeof tick>>,
  pollCount: number,
  config: AoaoeConfig,
  phase: "sleeping" | "polling" | "reasoning" | "executing" = "sleeping",
  nextTickAt?: number,
) {
  resetInternalState(); // clear debounce so every write flushes
  const sessions = buildSessionStates(tickResult.observation);
  writeState(phase, {
    pollCount,
    pollIntervalMs: config.pollIntervalMs,
    sessionCount: tickResult.observation.sessions.length,
    changeCount: tickResult.observation.changes.length,
    sessions,
    tickStartedAt: Date.now(),
    ...(nextTickAt !== undefined ? { nextTickAt } : {}),
  });
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("e2e — tick → daemon state → chat reader", () => {
  let poller: MockPoller;
  let reasoner: MockReasoner;
  let executor: MockExecutor;
  let policyStates: Map<string, SessionPolicyState>;

  beforeEach(() => {
    cleanupState();
    resetInternalState();
    poller = new MockPoller();
    reasoner = new MockReasoner();
    executor = new MockExecutor();
    policyStates = new Map();
  });

  afterEach(() => {
    cleanupState();
  });

  it("single tick with action → chat sees running daemon with sessions", async () => {
    const now = Date.now();
    const snap = makeSnapshot({ session: makeSession({ title: "adventure" }) });
    const changes: SessionChange[] = [{
      sessionId: snap.session.id,
      title: "adventure",
      tool: "opencode",
      status: "working",
      newLines: "implementing login flow",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: snap.session.id, text: "continue with tests" }],
      reasoning: "agent is making progress, nudging to add tests",
    });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });

    // daemon writes state after tick
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);

    // chat reads state
    const state = readState();
    assert.ok(state, "state should be readable");
    assert.equal(isDaemonRunningFromState(state, now), true);
    assert.equal(state!.pollCount, 1);
    assert.equal(state!.sessionCount, 1);
    assert.equal(state!.phase, "sleeping");

    // session info should be present
    assert.equal(state!.sessions.length, 1);
    assert.equal(state!.sessions[0].title, "adventure");
    assert.equal(state!.sessions[0].tool, "opencode");
    assert.equal(state!.sessions[0].status, "working");

    // countdown should be ~10s
    const countdown = getCountdownFromState(state, true, now);
    assert.equal(countdown, 10);

    // status line should mention sleeping and the session
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("next:"), "should show countdown");
    assert.ok(line?.includes("adventure"), "should show session name");
    assert.ok(line?.includes("poll #1"), "should show poll count");

    // session list should format correctly
    const list = formatSessionsList(state!);
    assert.ok(list.includes("adventure"), "session list should include title");
    assert.ok(list.includes("opencode"), "session list should include tool");
    assert.ok(list.includes("working"), "session list should include status");
  });

  it("tick with wait-only response → no execution, daemon still visible", async () => {
    const now = Date.now();
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id,
      title: snap.session.title,
      tool: snap.session.tool,
      status: snap.session.status,
      newLines: "compiling...",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "wait", reason: "agent is compiling, let it finish" }],
    });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 3 });

    assert.equal(executor.executed.length, 0, "wait should not trigger execution");
    simulateDaemonStateWrite(tickResult, 3, config, "sleeping", now + 10_000);

    const state = readState();
    assert.ok(state);
    assert.equal(state!.pollCount, 3);
    assert.equal(isDaemonRunningFromState(state, now), true);
  });

  it("multi-tick sequence → chat tracks poll count and phase transitions", async () => {
    const now = Date.now();
    const session = makeSession({ id: "multi-1", title: "cloud-hypervisor" });
    const snap = makeSnapshot({ session });
    const config = defaultConfig();

    // tick 1: changes detected → reasoner called
    const changes1: SessionChange[] = [{
      sessionId: "multi-1", title: "cloud-hypervisor",
      tool: "opencode", status: "working", newLines: "building kernel",
    }];
    poller.enqueue(makeObservation([snap], changes1));
    reasoner.enqueue({ actions: [{ action: "wait" }], reasoning: "agent is busy" });

    const r1 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    simulateDaemonStateWrite(r1, 1, config, "sleeping", now + 10_000);

    let state = readState();
    assert.equal(state!.pollCount, 1);
    assert.equal(state!.sessions[0].title, "cloud-hypervisor");

    // tick 2: no changes → skipped
    poller.enqueue(makeObservation([snap], []));
    const r2 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 2 });
    assert.equal(r2.skippedReason, "no changes");

    // daemon still writes state even on skip (reflecting new poll count)
    simulateDaemonStateWrite(r2, 2, config, "sleeping", now + 20_000);
    state = readState();
    assert.equal(state!.pollCount, 2);
    assert.equal(isDaemonRunningFromState(state, now), true);

    // tick 3: new changes → reasoner acts
    const changes3: SessionChange[] = [{
      sessionId: "multi-1", title: "cloud-hypervisor",
      tool: "opencode", status: "working", newLines: "build complete, ready for testing",
    }];
    poller.enqueue(makeObservation([snap], changes3));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: "multi-1", text: "run the test suite" }],
      reasoning: "build done, time to test",
    });

    const r3 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 3 });
    assert.equal(executor.executed.length, 1);
    simulateDaemonStateWrite(r3, 3, config, "sleeping", now + 30_000);

    state = readState();
    assert.equal(state!.pollCount, 3);
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("poll #3"));
  });

  it("multiple sessions → chat sees all agents", async () => {
    const now = Date.now();
    const s1 = makeSession({ id: "s1-id", title: "adventure", status: "working" });
    const s2 = makeSession({ id: "s2-id", title: "cloud-hypervisor", status: "idle", tool: "claude-code" });
    const s3 = makeSession({ id: "s3-id", title: "aoaoe", status: "error" });
    const snap1 = makeSnapshot({ session: s1 });
    const snap2 = makeSnapshot({ session: s2, output: "waiting for instructions\n" });
    const snap3 = makeSnapshot({ session: s3, output: "ERROR: connection refused\n" });
    const changes: SessionChange[] = [{
      sessionId: "s1-id", title: "adventure",
      tool: "opencode", status: "working", newLines: "new commit pushed",
    }];

    poller.enqueue(makeObservation([snap1, snap2, snap3], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: "s1-id", text: "nice, keep going" }],
      reasoning: "adventure made progress",
    });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);

    const state = readState();
    assert.equal(state!.sessions.length, 3);
    assert.equal(state!.sessionCount, 3);

    // check each session
    const titles = state!.sessions.map((s) => s.title);
    assert.ok(titles.includes("adventure"));
    assert.ok(titles.includes("cloud-hypervisor"));
    assert.ok(titles.includes("aoaoe"));

    const adventureSess = state!.sessions.find((s) => s.title === "adventure");
    assert.equal(adventureSess?.status, "working");
    assert.equal(adventureSess?.tool, "opencode");

    const chvSess = state!.sessions.find((s) => s.title === "cloud-hypervisor");
    assert.equal(chvSess?.status, "idle");
    assert.equal(chvSess?.tool, "claude-code");

    const aoaoeSess = state!.sessions.find((s) => s.title === "aoaoe");
    assert.equal(aoaoeSess?.status, "error");

    // formatSessionsList should show all three
    const list = formatSessionsList(state!);
    assert.ok(list.includes("adventure"));
    assert.ok(list.includes("cloud-hypervisor"));
    assert.ok(list.includes("aoaoe"));
  });

  it("dry-run mode → tick returns planned actions but does not execute", async () => {
    const now = Date.now();
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "stuck on error",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: snap.session.id, text: "try again" }],
    });

    const config = defaultConfig({ dryRun: true });
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });

    assert.equal(executor.executed.length, 0, "dry-run should not execute");
    assert.equal(tickResult.dryRunActions?.length, 1);
    assert.equal(tickResult.dryRunActions?.[0].action, "send_input");

    // daemon still writes state in dry-run mode
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);
    const state = readState();
    assert.ok(isDaemonRunningFromState(state, now));
    assert.equal(state!.sessionCount, 1);
  });

  it("user message forces reasoning even without changes → chat sees result", async () => {
    const now = Date.now();
    const snap = makeSnapshot({ session: makeSession({ title: "adventure" }) });
    poller.enqueue(makeObservation([snap], [])); // no changes

    reasoner.enqueue({
      actions: [{ action: "send_input", session: snap.session.id, text: "focus on authentication" }],
      reasoning: "user asked to focus on auth",
    });

    const config = defaultConfig();
    const tickResult = await tick({
      config, poller, reasoner, executor, policyStates,
      pollCount: 5,
      userMessage: "please focus on the authentication module",
    });

    assert.equal(tickResult.skippedReason, undefined, "should not skip with user message");
    assert.equal(reasoner.calls.length, 1);
    assert.equal(reasoner.calls[0].userMessage, "please focus on the authentication module");
    assert.equal(executor.executed.length, 1);

    simulateDaemonStateWrite(tickResult, 5, config, "sleeping", now + 10_000);
    const state = readState();
    assert.equal(state!.pollCount, 5);
    assert.equal(isDaemonRunningFromState(state, now), true);
  });

  it("confirm mode → beforeExecute filters actions before daemon state write", async () => {
    const now = Date.now();
    const s1 = makeSession({ id: "c1", title: "agent-a" });
    const snap1 = makeSnapshot({ session: s1 });
    const changes: SessionChange[] = [{
      sessionId: "c1", title: "agent-a", tool: "opencode",
      status: "working", newLines: "output",
    }];
    poller.enqueue(makeObservation([snap1], changes));
    reasoner.enqueue({
      actions: [
        { action: "send_input", session: "c1", text: "go" },
        { action: "start_session", session: "c1" },
      ],
    });

    const config = defaultConfig();
    // only approve send_input, reject start_session
    const tickResult = await tick({
      config, poller, reasoner, executor, policyStates,
      pollCount: 1,
      beforeExecute: async (action) => action.action === "send_input",
    });

    assert.equal(tickResult.executed.length, 1);
    assert.equal(tickResult.executed[0].action.action, "send_input");

    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);
    const state = readState();
    assert.ok(state);
    assert.equal(state!.sessions[0].title, "agent-a");
  });

  it("session with currentTask → shows in formatSessionsList", async () => {
    const now = Date.now();
    const session = makeSession({ title: "adventure" });
    const snap = makeSnapshot({ session });
    const changes: SessionChange[] = [{
      sessionId: session.id, title: "adventure",
      tool: "opencode", status: "working", newLines: "started implementing",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: session.id, text: "implement the login page" }],
    });

    const config = defaultConfig();

    // simulate daemon tracking the task it sent
    setSessionTask(session.id, "implement the login page");

    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);

    const state = readState();
    assert.ok(state);
    const adventureSession = state!.sessions.find((s) => s.title === "adventure");
    assert.equal(adventureSession?.currentTask, "implement the login page");

    const list = formatSessionsList(state!);
    assert.ok(list.includes("implement the login page"), "session list should show current task");
  });

  it("error session triggers policy alert → reasoning forced → chat sees error state", async () => {
    const now = Date.now();
    const session = makeSession({ id: "err-1", title: "broken-agent", status: "error" });
    const snap = makeSnapshot({ session, output: "ERROR: segfault in module X\n" });
    const config = defaultConfig();

    // pre-seed: 2 consecutive error polls already tracked
    policyStates.set("err-1", {
      sessionId: "err-1",
      lastOutputChangeAt: now,
      consecutiveErrorPolls: 2,
      hasPermissionPrompt: false,
    });

    poller.enqueue(makeObservation([snap], [])); // no changes, but policy triggers
    reasoner.enqueue({
      actions: [{ action: "start_session", session: "err-1" }],
      reasoning: "agent has errored 3 times, restarting",
    });

    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 3 });
    assert.equal(tickResult.skippedReason, undefined, "policy alert should force reasoning");
    assert.equal(executor.executed.length, 1);
    assert.equal(executor.executed[0].actions[0].action, "start_session");

    simulateDaemonStateWrite(tickResult, 3, config, "sleeping", now + 10_000);

    const state = readState();
    assert.ok(state);
    const brokenSession = state!.sessions.find((s) => s.title === "broken-agent");
    assert.equal(brokenSession?.status, "error");

    const list = formatSessionsList(state!);
    assert.ok(list.includes("broken-agent"));
    assert.ok(list.includes("error"));
  });

  it("daemon goes offline → chat detects stale state", async () => {
    const now = Date.now();
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "output",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);

    // daemon is alive now
    const state = readState();
    assert.equal(isDaemonRunningFromState(state, now), true);

    // simulate daemon going offline — state is 5 minutes old
    const future = now + 300_000;
    assert.equal(isDaemonRunningFromState(state, future), false, "stale state should show daemon offline");

    const line = buildStatusLineFromState(state, false);
    assert.equal(line, null, "offline daemon should return null status line");
  });

  it("reasoning phase → chat status shows reasoning elapsed time", async () => {
    const now = Date.now();
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "data",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 2 });

    // write state as if we're in reasoning phase (mid-tick, before execution)
    simulateDaemonStateWrite(tickResult, 2, config, "reasoning");

    const state = readState();
    // check status line shows reasoning
    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("reasoning"), "should show reasoning phase");
    assert.ok(line?.includes("poll #2"));

    // no countdown during reasoning
    const countdown = getCountdownFromState(state, true, now);
    assert.equal(countdown, null, "no countdown during reasoning");
  });

  it("no sessions at all → tick skips, daemon state reflects empty", async () => {
    const now = Date.now();
    poller.enqueue(makeObservation([], []));

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    assert.equal(tickResult.skippedReason, "no sessions");

    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", now + 10_000);

    const state = readState();
    assert.ok(state);
    assert.equal(state!.sessionCount, 0);
    assert.equal(state!.sessions.length, 0);
    assert.equal(isDaemonRunningFromState(state, now), true);

    const list = formatSessionsList(state!);
    assert.ok(list.includes("no sessions"));
  });

  it("cleanup removes state → chat reads null", async () => {
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "output",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    simulateDaemonStateWrite(tickResult, 1, config, "sleeping", Date.now() + 10_000);

    assert.ok(readState(), "state should exist before cleanup");

    cleanupState();
    assert.equal(readState(), null, "state should be null after cleanup");
    assert.equal(isDaemonRunningFromState(null), false);
  });

  it("paused daemon → chat status shows PAUSED", async () => {
    const now = Date.now();
    const snap = makeSnapshot();
    const changes: SessionChange[] = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "output",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 4 });

    // write as paused daemon
    const sessions = buildSessionStates(tickResult.observation);
    writeState("sleeping", {
      pollCount: 4,
      pollIntervalMs: config.pollIntervalMs,
      sessionCount: 1,
      sessions,
      paused: true,
    });

    const state = readState();
    assert.ok(state?.paused);

    const line = buildStatusLineFromState(state, true, false, now);
    assert.ok(line?.includes("PAUSED"));
  });

  it("title-mode status line → compact format for terminal title", async () => {
    const now = Date.now();
    const s1 = makeSession({ id: "t1", title: "adventure" });
    const s2 = makeSession({ id: "t2", title: "cloud-hypervisor" });
    const snap1 = makeSnapshot({ session: s1 });
    const snap2 = makeSnapshot({ session: s2 });
    const changes: SessionChange[] = [{
      sessionId: "t1", title: "adventure",
      tool: "opencode", status: "working", newLines: "data",
    }];
    poller.enqueue(makeObservation([snap1, snap2], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const config = defaultConfig();
    const tickResult = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 7 });
    simulateDaemonStateWrite(tickResult, 7, config, "sleeping", now + 10_000);

    const state = readState();
    // forTitle=true gives compact output (session count instead of names)
    const titleLine = buildStatusLineFromState(state, true, true, now);
    assert.ok(titleLine?.includes("2 sessions"), "title mode shows session count");
    assert.ok(titleLine?.includes("poll #7"));
  });

  it("full lifecycle: tick → execute → sleep → stale → gone", async () => {
    const now = Date.now();
    const session = makeSession({ title: "lifecycle-agent" });
    const snap = makeSnapshot({ session });
    const config = defaultConfig();

    // phase 1: active tick with execution
    const changes: SessionChange[] = [{
      sessionId: session.id, title: session.title,
      tool: session.tool, status: session.status,
      newLines: "needs help",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: session.id, text: "continue" }],
    });

    const r1 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    assert.equal(r1.executed.length, 1);

    // phase 2: daemon writes state → chat sees running
    simulateDaemonStateWrite(r1, 1, config, "sleeping", now + 10_000);
    let state = readState();
    assert.equal(isDaemonRunningFromState(state, now), true);
    assert.equal(state!.sessions[0].title, "lifecycle-agent");

    // phase 3: time passes, state becomes stale → chat sees offline
    assert.equal(isDaemonRunningFromState(state, now + 300_000), false);

    // phase 4: daemon cleans up → state file gone
    cleanupState();
    state = readState();
    assert.equal(state, null);
    assert.equal(isDaemonRunningFromState(null), false);
    assert.equal(buildStatusLineFromState(null, false, true), "aoaoe (daemon offline)");
  });

  after(() => {
    cleanupState();
    rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  });
});
