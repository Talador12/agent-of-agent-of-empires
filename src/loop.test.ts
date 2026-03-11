import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tick, type PollerLike, type ExecutorLike, type ActionResult } from "./loop.js";
import type { Observation, Reasoner, ReasonerResult, Action, AoaoeConfig, SessionSnapshot, AoeSession } from "./types.js";
import type { SessionPolicyState } from "./reasoner/prompt.js";

// --- helpers to build test fixtures ---

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
    protectedSessions: [],
    ...overrides,
  };
}

// --- mock implementations ---

class MockPoller implements PollerLike {
  private observations: Observation[] = [];
  private callIndex = 0;
  pollCount = 0;

  /** Queue observations to be returned in order. Last one repeats forever. */
  enqueue(...obs: Observation[]) {
    this.observations.push(...obs);
  }

  async poll(): Promise<Observation> {
    this.pollCount++;
    const idx = Math.min(this.callIndex, this.observations.length - 1);
    this.callIndex++;
    return this.observations[idx] ?? makeObservation([]);
  }
}

class MockReasoner implements Reasoner {
  private responses: ReasonerResult[] = [];
  private callIndex = 0;
  calls: Observation[] = []; // recorded observations passed to decide()
  initCalled = false;
  shutdownCalled = false;

  /** Queue responses to be returned in order. Last one repeats forever. */
  enqueue(...results: ReasonerResult[]) {
    this.responses.push(...results);
  }

  async init() { this.initCalled = true; }

  async decide(observation: Observation, _signal?: AbortSignal): Promise<ReasonerResult> {
    this.calls.push(observation);
    const idx = Math.min(this.callIndex, this.responses.length - 1);
    this.callIndex++;
    return this.responses[idx] ?? { actions: [{ action: "wait" }] };
  }

  async shutdown() { this.shutdownCalled = true; }
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

// --- tests ---

describe("tick — full observe/reason/execute loop", () => {
  let poller: MockPoller;
  let reasoner: MockReasoner;
  let executor: MockExecutor;
  let policyStates: Map<string, SessionPolicyState>;

  beforeEach(() => {
    poller = new MockPoller();
    reasoner = new MockReasoner();
    executor = new MockExecutor();
    policyStates = new Map();
  });

  it("skips reasoning when no sessions and no user message", async () => {
    poller.enqueue(makeObservation([]));

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(result.skippedReason, "no sessions");
    assert.equal(result.result, null);
    assert.equal(reasoner.calls.length, 0);
    assert.equal(executor.executed.length, 0);
  });

  it("skips reasoning when sessions exist but no changes", async () => {
    const snap = makeSnapshot();
    poller.enqueue(makeObservation([snap], [])); // no changes

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(result.skippedReason, "no changes");
    assert.equal(reasoner.calls.length, 0);
  });

  it("calls reasoner when changes detected", async () => {
    const snap = makeSnapshot();
    const changes = [{
      sessionId: snap.session.id,
      title: snap.session.title,
      tool: snap.session.tool,
      status: snap.session.status,
      newLines: "task complete!",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({ actions: [{ action: "wait" }], reasoning: "all good" });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(result.skippedReason, undefined);
    assert.equal(reasoner.calls.length, 1);
    assert.equal(result.result?.reasoning, "all good");
    // wait-only -> no execution
    assert.equal(executor.executed.length, 0);
  });

  it("executes send_input action from reasoner", async () => {
    const snap = makeSnapshot();
    const changes = [{
      sessionId: snap.session.id,
      title: snap.session.title,
      tool: snap.session.tool,
      status: snap.session.status,
      newLines: "stuck on error",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: snap.session.id, text: "try running npm test" }],
      reasoning: "agent is stuck, nudging",
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(executor.executed.length, 1);
    assert.equal(executor.executed[0].actions.length, 1);
    assert.equal(executor.executed[0].actions[0].action, "send_input");
    assert.equal(result.executed.length, 1);
    assert.equal(result.executed[0].success, true);
  });

  it("handles multiple actions from reasoner", async () => {
    const snap1 = makeSnapshot({ session: makeSession({ id: "id-1", title: "agent-a" }) });
    const snap2 = makeSnapshot({ session: makeSession({ id: "id-2", title: "agent-b", status: "error" }) });
    const changes = [
      { sessionId: "id-1", title: "agent-a", tool: "opencode", status: "working", newLines: "done" },
      { sessionId: "id-2", title: "agent-b", tool: "opencode", status: "error", newLines: "crash" },
    ];
    poller.enqueue(makeObservation([snap1, snap2], changes));
    reasoner.enqueue({
      actions: [
        { action: "send_input", session: "id-1", text: "good job, move to next task" },
        { action: "start_session", session: "id-2" },
      ],
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(executor.executed.length, 1);
    assert.equal(executor.executed[0].actions.length, 2);
    assert.equal(result.executed.length, 2);
    assert.ok(result.executed.every((e) => e.success));
  });

  it("dry-run mode logs actions but does not execute", async () => {
    const snap = makeSnapshot();
    const changes = [{
      sessionId: snap.session.id,
      title: snap.session.title,
      tool: snap.session.tool,
      status: snap.session.status,
      newLines: "waiting for input",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: snap.session.id, text: "continue" }],
    });

    const result = await tick({
      config: defaultConfig({ dryRun: true }),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    // reasoner was called
    assert.equal(reasoner.calls.length, 1);
    // executor was NOT called
    assert.equal(executor.executed.length, 0);
    // dryRunActions shows what would have happened
    assert.equal(result.dryRunActions?.length, 1);
    assert.equal(result.dryRunActions?.[0].action, "send_input");
  });

  it("forces reasoning on user message even with no changes", async () => {
    const snap = makeSnapshot();
    poller.enqueue(makeObservation([snap], [])); // no changes
    reasoner.enqueue({ actions: [{ action: "wait" }] });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
      userMessage: "check on agent-a please",
    });

    assert.equal(result.skippedReason, undefined);
    assert.equal(reasoner.calls.length, 1);
    assert.equal(reasoner.calls[0].userMessage, "check on agent-a please");
  });

  it("forces reasoning when session is idle beyond threshold", async () => {
    const session = makeSession({ id: "idle-1" });
    const snap = makeSnapshot({ session });
    poller.enqueue(makeObservation([snap], [])); // no changes

    // pre-seed policy state with old lastOutputChangeAt
    policyStates.set("idle-1", {
      sessionId: "idle-1",
      lastOutputChangeAt: Date.now() - 200_000, // 200s ago, threshold is 120s
      consecutiveErrorPolls: 0,
      hasPermissionPrompt: false,
    });

    reasoner.enqueue({
      actions: [{ action: "send_input", session: "idle-1", text: "are you still working?" }],
      reasoning: "session idle for 200s",
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 2,
    });

    assert.equal(result.skippedReason, undefined);
    assert.equal(reasoner.calls.length, 1);
    // policy context was attached
    assert.ok(reasoner.calls[0].policyContext);
    assert.equal(executor.executed.length, 1);
  });

  it("forces reasoning when session has consecutive errors", async () => {
    const session = makeSession({ id: "err-1", status: "error" });
    const snap = makeSnapshot({ session });
    poller.enqueue(makeObservation([snap], []));

    // pre-seed: already had 2 error polls, this will be the 3rd (>= threshold of 3)
    policyStates.set("err-1", {
      sessionId: "err-1",
      lastOutputChangeAt: Date.now(),
      consecutiveErrorPolls: 2,
      hasPermissionPrompt: false,
    });

    reasoner.enqueue({
      actions: [{ action: "start_session", session: "err-1" }],
      reasoning: "restarting after 3 errors",
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 3,
    });

    assert.equal(reasoner.calls.length, 1);
    assert.equal(executor.executed.length, 1);
    assert.equal(executor.executed[0].actions[0].action, "start_session");
    // policy state was incremented to 3
    assert.equal(policyStates.get("err-1")?.consecutiveErrorPolls, 3);
  });

  it("forces reasoning when permission prompt detected", async () => {
    const session = makeSession({ id: "perm-1" });
    const snap = makeSnapshot({
      session,
      output: "Do you want to allow this operation? (y/n)",
    });
    poller.enqueue(makeObservation([snap], []));

    reasoner.enqueue({
      actions: [{ action: "send_input", session: "perm-1", text: "y" }],
      reasoning: "answering permission prompt",
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(reasoner.calls.length, 1);
    assert.ok(policyStates.get("perm-1")?.hasPermissionPrompt);
    assert.equal(executor.executed.length, 1);
  });

  it("resets error counter when session recovers", async () => {
    const session = makeSession({ id: "recov-1", status: "working" });
    const snap = makeSnapshot({ session });
    const changes = [{
      sessionId: "recov-1", title: session.title,
      tool: session.tool, status: "working", newLines: "back to normal",
    }];
    poller.enqueue(makeObservation([snap], changes));

    // had 2 errors before, now working
    policyStates.set("recov-1", {
      sessionId: "recov-1",
      lastOutputChangeAt: Date.now() - 10_000,
      consecutiveErrorPolls: 2,
      hasPermissionPrompt: false,
    });

    reasoner.enqueue({ actions: [{ action: "wait" }] });

    await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(policyStates.get("recov-1")?.consecutiveErrorPolls, 0);
  });

  it("prunes policy states for sessions that no longer exist", async () => {
    poller.enqueue(makeObservation([], [])); // no sessions

    policyStates.set("gone-1", {
      sessionId: "gone-1",
      lastOutputChangeAt: Date.now(),
      consecutiveErrorPolls: 0,
      hasPermissionPrompt: false,
    });

    await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(policyStates.has("gone-1"), false);
  });

  it("wait-only response skips executor", async () => {
    const snap = makeSnapshot();
    const changes = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "compiling...",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "wait", reason: "agent is compiling, let it finish" }],
    });

    const result = await tick({
      config: defaultConfig(),
      poller, reasoner, executor, policyStates,
      pollCount: 1,
    });

    assert.equal(reasoner.calls.length, 1);
    assert.equal(executor.executed.length, 0);
    assert.equal(result.executed.length, 0);
    assert.equal(result.dryRunActions, undefined);
  });
});

describe("tick — multi-tick sequences", () => {
  let poller: MockPoller;
  let reasoner: MockReasoner;
  let executor: MockExecutor;
  let policyStates: Map<string, SessionPolicyState>;

  beforeEach(() => {
    poller = new MockPoller();
    reasoner = new MockReasoner();
    executor = new MockExecutor();
    policyStates = new Map();
  });

  it("policy state accumulates across ticks", async () => {
    const session = makeSession({ id: "multi-1", status: "error" });
    const snap = makeSnapshot({ session });
    const config = defaultConfig({ policies: { maxIdleBeforeNudgeMs: 120_000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true } });

    // Queue all observations upfront — MockPoller returns them in order
    poller.enqueue(
      makeObservation([snap], []),  // tick 1
      makeObservation([snap], []),  // tick 2
      makeObservation([snap], []),  // tick 3
    );
    // Reasoner response for when it gets called (tick 3)
    reasoner.enqueue({ actions: [{ action: "start_session", session: "multi-1" }] });

    // tick 1: first error poll — 1 < 3, skip reasoning
    await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    assert.equal(policyStates.get("multi-1")?.consecutiveErrorPolls, 1);
    assert.equal(reasoner.calls.length, 0);

    // tick 2: second error — 2 < 3, skip reasoning
    await tick({ config, poller, reasoner, executor, policyStates, pollCount: 2 });
    assert.equal(policyStates.get("multi-1")?.consecutiveErrorPolls, 2);
    assert.equal(reasoner.calls.length, 0);

    // tick 3: third error — 3 >= 3, triggers reasoning + execution
    const result = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 3 });
    assert.equal(policyStates.get("multi-1")?.consecutiveErrorPolls, 3);
    assert.equal(reasoner.calls.length, 1);
    assert.equal(executor.executed.length, 1);
  });

  it("recovers from poller error", async () => {
    // a poller that throws on first call, then succeeds
    let callCount = 0;
    const failingPoller: PollerLike = {
      async poll() {
        callCount++;
        if (callCount === 1) throw new Error("tmux not found");
        return makeObservation([makeSnapshot()], []);
      },
    };
    const reasoner = new MockReasoner();
    const executor = new MockExecutor();
    const policyStates = new Map<string, SessionPolicyState>();

    // first tick throws (poller error bubbles up)
    await assert.rejects(
      () => tick({ config: defaultConfig(), poller: failingPoller, reasoner, executor, policyStates, pollCount: 1 }),
      /tmux not found/
    );

    // second tick succeeds (poller returns data)
    const result = await tick({ config: defaultConfig(), poller: failingPoller, reasoner, executor, policyStates, pollCount: 2 });
    assert.equal(result.skippedReason, "no changes");
  });

  it("recovers from reasoner error", async () => {
    const snap = makeSnapshot();
    const changes = [{
      sessionId: snap.session.id, title: snap.session.title,
      tool: snap.session.tool, status: snap.session.status,
      newLines: "output",
    }];
    const poller = new MockPoller();
    poller.enqueue(
      makeObservation([snap], changes),
      makeObservation([snap], changes),
    );

    // reasoner that throws on first call, then succeeds
    let reasonerCallCount = 0;
    const failingReasoner: Reasoner = {
      async init() {},
      async decide() {
        reasonerCallCount++;
        if (reasonerCallCount === 1) throw new Error("API rate limited");
        return { actions: [{ action: "wait" as const }] };
      },
      async shutdown() {},
    };
    const executor = new MockExecutor();
    const policyStates = new Map<string, SessionPolicyState>();

    // first tick throws (reasoner error bubbles up)
    await assert.rejects(
      () => tick({ config: defaultConfig(), poller, reasoner: failingReasoner, executor, policyStates, pollCount: 1 }),
      /API rate limited/
    );

    // second tick succeeds
    const result = await tick({ config: defaultConfig(), poller, reasoner: failingReasoner, executor, policyStates, pollCount: 2 });
    assert.equal(result.result?.actions[0].action, "wait");
  });

  it("change then idle sequence", async () => {
    const session = makeSession({ id: "seq-1" });
    const snap = makeSnapshot({ session });
    const config = defaultConfig();

    // tick 1: change detected -> reason + execute
    const changes = [{
      sessionId: "seq-1", title: session.title,
      tool: session.tool, status: session.status,
      newLines: "new output",
    }];
    poller.enqueue(makeObservation([snap], changes));
    reasoner.enqueue({
      actions: [{ action: "send_input", session: "seq-1", text: "continue" }],
    });

    const r1 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 1 });
    assert.equal(r1.skippedReason, undefined);
    assert.equal(executor.executed.length, 1);

    // tick 2: no change -> skip
    poller.enqueue(makeObservation([snap], []));

    const r2 = await tick({ config, poller, reasoner, executor, policyStates, pollCount: 2 });
    assert.equal(r2.skippedReason, "no changes");
    assert.equal(executor.executed.length, 1); // unchanged from tick 1
  });
});
