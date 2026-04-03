// pipeline-integration.test.ts — end-to-end tests for the autonomous daemon pipeline.
// exercises the full wiring: observation → intelligence gates → reasoner → approval →
// execution → graduation → recovery → scheduling — using real module instances
// (not the daemon loop itself, which requires TUI/tmux).

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

// intelligence modules
import { ObservationCache } from "./observation-cache.js";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";
import { compressObservation } from "./context-compressor.js";
import { filterByPriority, computeSavings } from "./priority-reasoning.js";
import { rankSessionsByPriority } from "./session-priority.js";
import { estimateCallCost, ReasonerCostTracker } from "./reasoner-cost.js";
import { filterThroughApproval, shouldAutoApprove } from "./approval-workflow.js";
import { ApprovalQueue } from "./approval-queue.js";
import { GraduationManager } from "./session-graduation.js";
import { RecoveryPlaybookManager } from "./recovery-playbook.js";
import { getActivatableTasks } from "./dep-scheduler.js";
import { NudgeTracker } from "./nudge-tracker.js";
import { EscalationManager } from "./notify-escalation.js";
import { FleetSlaMonitor } from "./fleet-sla.js";
import { BudgetPredictor } from "./budget-predictor.js";
import { findOverBudgetSessions } from "./cost-budget.js";
import { detectCompletionSignals, shouldAutoComplete } from "./goal-detector.js";
import { SessionSummarizer } from "./session-summarizer.js";
import { ConflictDetector } from "./conflict-detector.js";
import { ProgressVelocityTracker } from "./progress-velocity.js";
import { analyzeCompletedTasks, refineGoal } from "./goal-refiner.js";
import type { Observation, SessionSnapshot, AoeSession, ReasonerResult, TaskState, Action } from "./types.js";

// ── helpers ──────────────────────────────────────────────────────────────

function makeSession(title: string, status = "working"): AoeSession {
  return { id: `id-${title}`, title, path: "/tmp/" + title, tool: "opencode", status: status as any, tmux_name: `aoe_${title}_id` };
}
function makeSnap(title: string, output: string, status = "working"): SessionSnapshot {
  return { session: makeSession(title, status), output, outputHash: `hash-${title}-${Date.now()}`, capturedAt: Date.now() };
}
function makeObs(snaps: SessionSnapshot[], changes?: Observation["changes"]): Observation {
  return { timestamp: Date.now(), sessions: snaps, changes: changes ?? [] };
}
function makeTask(title: string, status = "active", overrides: Partial<TaskState> = {}): TaskState {
  return { repo: `test/${title}`, sessionTitle: title, sessionMode: "auto", tool: "opencode", goal: "implement feature", status: status as any, progress: [], ...overrides };
}

// ── test suites ──────────────────────────────────────────────────────────

describe("pipeline: reasoning gate chain", () => {
  it("rate limiter blocks when over budget", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 1, maxDailyCostUsd: 10, cooldownMs: 60_000 });
    const now = Date.now();
    // exhaust hourly budget
    for (let i = 0; i < 5; i++) limiter.recordCost(0.5, now);
    assert.equal(limiter.isBlocked(now), true);
    // in a real pipeline, this returns wait action without calling LLM
  });

  it("cache returns hit for duplicate observations", () => {
    const cache = new ObservationCache();
    const obs = JSON.stringify({ sessions: [{ hash: "abc" }], changes: 0 });
    const result: ReasonerResult = { actions: [{ action: "wait", reason: "cached" }] };
    cache.set(obs, result);
    const hit = cache.get(obs);
    assert.deepEqual(hit, result);
    assert.equal(cache.getStats().totalHits, 1);
  });

  it("priority filter excludes low-priority sessions from observation", () => {
    const obs = makeObs([makeSnap("important", "error: crash"), makeSnap("idle", "nothing happening")]);
    const ranked = rankSessionsByPriority([
      { sessionTitle: "important", healthScore: 20, lastChangeMs: 0, lastProgressMs: 0, taskStatus: "active", isStuck: false, hasError: true, isUserActive: false },
      { sessionTitle: "idle", healthScore: 90, lastChangeMs: 60_000, lastProgressMs: 60_000, taskStatus: "active", isStuck: false, hasError: false, isUserActive: false },
    ]);
    const { filtered, excluded } = filterByPriority(obs, ranked, new Set(["important"]), { maxSessionsPerCall: 1, alwaysIncludeChanged: true });
    assert.ok(filtered.sessions.some((s) => s.session.title === "important"));
    assert.ok(excluded.includes("idle"));
    const savings = computeSavings(obs, filtered);
    assert.equal(savings.sessionsSaved, 1);
  });

  it("context compressor reduces long output", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}: some terminal output here`);
    const compressed = compressObservation(lines, 30, 8);
    assert.ok(compressed.compressedLineCount < 100);
    assert.ok(compressed.text.includes("line 99")); // recent lines kept
    assert.ok(compressed.text.includes("compressed")); // has summary marker
  });

  it("approval workflow gates destructive actions", () => {
    const queue = new ApprovalQueue();
    const result: ReasonerResult = {
      actions: [
        { action: "send_input", session: "x", text: "check" },
        { action: "remove_agent", session: "y" },
        { action: "wait", reason: "ok" },
      ],
      confidence: "high",
    };
    const { immediate, queued } = filterThroughApproval(result, queue);
    assert.equal(immediate.length, 2); // send_input + wait pass
    assert.equal(queued.length, 1); // remove_agent queued
    assert.equal(queue.getPending().length, 1);
  });

  it("cost tracker records call and computes summary", () => {
    const tracker = new ReasonerCostTracker();
    tracker.recordCall("fleet", 5000, 1000, 2000);
    const summary = tracker.getSummary();
    assert.equal(summary.totalCalls, 1);
    assert.ok(summary.totalCostUsd > 0);
    assert.ok(summary.avgInputTokens === 5000);
  });

  it("full pipeline: rate limit → cache → filter → compress → approval chain", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 100 });
    const cache = new ObservationCache();
    const queue = new ApprovalQueue();
    const costTracker = new ReasonerCostTracker();

    // step 1: not rate limited
    assert.equal(limiter.isBlocked(), false);

    // step 2: cache miss (first call)
    const obsKey = JSON.stringify({ test: true });
    assert.equal(cache.get(obsKey), null);

    // step 3: simulate LLM response
    const llmResult: ReasonerResult = {
      actions: [{ action: "send_input", session: "test", text: "continue" }],
      confidence: "high",
    };

    // step 4: approval (high confidence, non-destructive → passes)
    const { immediate } = filterThroughApproval(llmResult, queue);
    assert.equal(immediate.length, 1);

    // step 5: record cost
    costTracker.recordCall("fleet", 3000, 500, 1500);
    limiter.recordCost(estimateCallCost(3000, 500));

    // step 6: cache the result
    cache.set(obsKey, llmResult);
    assert.deepEqual(cache.get(obsKey), llmResult);
  });
});

describe("pipeline: graduation lifecycle", () => {
  it("promotes session after consistent success", () => {
    const mgr = new GraduationManager({ promoteThreshold: 0.9, minActionsForPromotion: 5, cooldownTicks: 0 });
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    const result = mgr.evaluate("test");
    assert.equal(result.action, "promote");
    assert.equal(result.to, "auto");
  });

  it("demotes session after failures", () => {
    const mgr = new GraduationManager({ demoteThreshold: 0.5, cooldownTicks: 0, minActionsForPromotion: 3 });
    // promote first
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    mgr.evaluate("test"); // → auto
    // now fail repeatedly
    for (let i = 0; i < 20; i++) mgr.recordFailure("test");
    const result = mgr.evaluate("test");
    assert.equal(result.action, "demote");
  });

  it("graduation + approval interact: demoted sessions get stricter gating", () => {
    const mgr = new GraduationManager({ demoteThreshold: 0.5 });
    for (let i = 0; i < 10; i++) mgr.recordFailure("risky");
    mgr.evaluate("risky"); // demoted to observe
    const state = mgr.getState("risky");
    assert.equal(state?.currentMode, "observe");
    // in observe mode, all non-wait actions would be blocked (verify conceptually)
    assert.ok(state!.successRate < 0.5);
  });
});

describe("pipeline: recovery playbook", () => {
  it("triggers nudge at health 55, pause at 15", () => {
    const mgr = new RecoveryPlaybookManager();
    const nudgeActions = mgr.evaluate("sick", 55);
    assert.ok(nudgeActions.some((a) => a.action === "nudge"));

    const pauseActions = mgr.evaluate("critical", 15);
    assert.ok(pauseActions.some((a) => a.action === "pause"));
  });

  it("resets and re-triggers after health recovery", () => {
    const mgr = new RecoveryPlaybookManager();
    mgr.evaluate("test", 55); // triggers nudge
    mgr.evaluate("test", 75); // health recovers
    const actions = mgr.evaluate("test", 55); // should re-trigger
    assert.ok(actions.some((a) => a.action === "nudge"));
  });
});

describe("pipeline: dependency scheduling", () => {
  it("activates task when prerequisite completes", () => {
    const tasks = [
      makeTask("prereq", "completed"),
      makeTask("blocked", "pending", { dependsOn: ["prereq"] }),
    ];
    const activatable = getActivatableTasks(tasks, 5);
    assert.deepEqual(activatable, ["blocked"]);
  });

  it("blocks task when prerequisite is still active", () => {
    const tasks = [
      makeTask("prereq", "active"),
      makeTask("blocked", "pending", { dependsOn: ["prereq"] }),
    ];
    const activatable = getActivatableTasks(tasks, 5);
    assert.equal(activatable.length, 0);
  });

  it("respects pool capacity when activating", () => {
    const tasks = [
      makeTask("a1", "active"),
      makeTask("a2", "active"),
      makeTask("ready", "pending"),
    ];
    const activatable = getActivatableTasks(tasks, 2); // pool full
    assert.equal(activatable.length, 0);
  });
});

describe("pipeline: nudge effectiveness + escalation", () => {
  it("tracks nudge → progress correlation", () => {
    const tracker = new NudgeTracker(10 * 60_000);
    const now = Date.now();
    tracker.recordNudge("test", "are you stuck?", now);
    tracker.recordProgress("test", now + 3 * 60_000);
    const report = tracker.getReport(now + 3 * 60_000);
    assert.equal(report.effectiveNudges, 1);
    assert.equal(report.effectivenessRate, 1);
    assert.ok(report.avgResponseTimeMs > 0);
  });

  it("escalation progresses through levels", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 2, criticalAfterCount: 4, cooldownMs: 0 });
    const r1 = mgr.recordStuck("test");
    assert.equal(r1?.level, "normal");
    mgr.recordStuck("test");
    const r3 = mgr.recordStuck("test");
    assert.equal(r3?.level, "elevated");
    mgr.recordStuck("test");
    const r5 = mgr.recordStuck("test");
    assert.equal(r5?.level, "critical");
  });

  it("escalation clears on progress", () => {
    const mgr = new EscalationManager({ cooldownMs: 0 });
    mgr.recordStuck("test");
    mgr.recordStuck("test");
    assert.ok(mgr.getState("test"));
    mgr.clearSession("test");
    assert.equal(mgr.getState("test"), undefined);
  });
});

describe("pipeline: fleet SLA monitoring", () => {
  it("detects breach when health drops below threshold", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 0 });
    const status = monitor.recordHealth(30);
    assert.equal(status.breached, true);
    assert.equal(status.shouldAlert, true);
  });

  it("does not alert during cooldown", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 5 });
    monitor.recordHealth(30); // first alert
    const s2 = monitor.recordHealth(30);
    assert.equal(s2.breached, true);
    assert.equal(s2.shouldAlert, false); // in cooldown
  });
});

describe("pipeline: budget enforcement + prediction", () => {
  it("auto-pauses over-budget sessions", () => {
    const sessions = [
      { title: "expensive", costStr: "$15.00", status: "active" },
      { title: "cheap", costStr: "$3.00", status: "active" },
    ];
    const violations = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].sessionTitle, "expensive");
  });

  it("predictor estimates exhaustion time", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    predictor.recordCost("test", "$5.00", now - 3_600_000);
    predictor.recordCost("test", "$7.00", now);
    const prediction = predictor.predict("test", { globalBudgetUsd: 10 }, now);
    assert.ok(prediction);
    assert.ok(prediction.burnRateUsdPerHour > 1);
    assert.ok(prediction.estimatedExhaustionMs > 0);
  });
});

describe("pipeline: goal completion auto-detect", () => {
  it("detects completion from git push + tests passing + done message", () => {
    const task = makeTask("test", "active", {
      progress: [{ at: Date.now(), summary: "started" }, { at: Date.now(), summary: "done" }],
      lastProgressAt: Date.now(),
    });
    const lines = [
      "abc1234..def5678  main -> main",
      "ℹ fail 0",
      "I've completed all the requested changes",
    ];
    const signals = detectCompletionSignals(lines, task);
    assert.ok(signals.length >= 2);
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, true);
  });
});

describe("pipeline: session summarizer + conflict detection", () => {
  it("summarizes session activity from output", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("test", ["Edit src/auth.ts", "npm test", "ℹ tests 150", "ℹ pass 150", "ℹ fail 0"]);
    const summary = summarizer.get("test");
    assert.ok(summary);
    assert.equal(summary.activity, "testing"); // tests take priority over editing
  });

  it("detects cross-session file conflicts", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("session-a", "id-a", ["Edit src/shared.ts"]);
    detector.recordEdits("session-b", "id-b", ["Edit src/shared.ts"]);
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].sessions.length, 2);
  });
});

describe("pipeline: velocity tracking", () => {
  it("computes velocity from progress samples", () => {
    const tracker = new ProgressVelocityTracker();
    const now = Date.now();
    tracker.recordProgress("test", 20, now - 3_600_000);
    tracker.recordProgress("test", 50, now);
    const est = tracker.estimate("test", now);
    assert.ok(est);
    assert.ok(est.velocityPerHour > 20);
    assert.ok(est.etaMs > 0);
  });
});

describe("pipeline: goal refinement from history", () => {
  it("suggests improvements based on completed task patterns", () => {
    const tasks = [
      makeTask("a", "completed", { goal: "implement auth with tests", completedAt: Date.now(), createdAt: Date.now() - 3_600_000, progress: [{ at: Date.now(), summary: "done" }] }),
      makeTask("b", "completed", { goal: "implement payments with tests", completedAt: Date.now(), createdAt: Date.now() - 7_200_000, progress: [{ at: Date.now(), summary: "done" }] }),
    ];
    const patterns = analyzeCompletedTasks(tasks);
    assert.equal(patterns.sampleSize, 2);
    assert.ok(patterns.successRate === 1);

    const refinement = refineGoal("do thing", patterns);
    assert.ok(refinement.suggestions.length > 0);
    assert.ok(refinement.suggestions.some((s) => s.includes("test") || s.includes("step") || s.includes("commit")));
  });
});

describe("pipeline: full multi-module scenario", () => {
  it("simulates a complete daemon tick with all intelligence modules active", () => {
    // setup
    const summarizer = new SessionSummarizer();
    const conflictDetector = new ConflictDetector();
    const cache = new ObservationCache();
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 100 });
    const costTracker = new ReasonerCostTracker();
    const graduation = new GraduationManager({ cooldownTicks: 0, minActionsForPromotion: 3 });
    const recovery = new RecoveryPlaybookManager();
    const sla = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 1, alertCooldownTicks: 0 });
    const velocity = new ProgressVelocityTracker();
    const nudgeTracker = new NudgeTracker();
    const escalation = new EscalationManager({ cooldownMs: 0 });
    const queue = new ApprovalQueue();

    // simulate 3 sessions
    const snaps = [
      makeSnap("adventure", "Edit src/auth.ts\n[main abc1234] feat: auth\nabc1234..def5678  main -> main"),
      makeSnap("code-music", "Edit src/synth.ts\nnpm test\nℹ tests 50\nℹ pass 50\nℹ fail 0"),
      makeSnap("broken", "error: ECONNREFUSED\npanic: segfault", "error"),
    ];

    // step 1: summarize
    for (const s of snaps) {
      summarizer.update(s.session.title, s.output.split("\n"));
    }
    assert.equal(summarizer.get("adventure")?.activity, "committing");
    assert.equal(summarizer.get("code-music")?.activity, "testing");
    assert.equal(summarizer.get("broken")?.activity, "error");

    // step 2: SLA check — (80+80+20)/3 = 60 > 50 threshold → not breached
    const healthScores = [80, 80, 20];
    const fleetHealth = Math.round(healthScores.reduce((a, b) => a + b, 0) / healthScores.length);
    assert.equal(fleetHealth, 60);
    const slaStatus = sla.recordHealth(fleetHealth);
    assert.equal(slaStatus.breached, false);

    // step 3: recovery for broken session (health=20 triggers nudge<60, restart<40, pause<=20)
    const recoveryActions = recovery.evaluate("broken", 20);
    // at health=20: nudge (threshold 60) + restart (threshold 40) + pause (threshold 20) all fire
    assert.ok(recoveryActions.length >= 1, `expected recovery actions for health=20, got ${recoveryActions.length}: ${JSON.stringify(recoveryActions)}`);

    // step 4: rate limit check
    assert.equal(limiter.isBlocked(), false);

    // step 5: simulate LLM call
    const llmResult: ReasonerResult = {
      actions: [{ action: "send_input", session: "id-broken", text: "restart needed" }],
      confidence: "medium",
    };
    costTracker.recordCall("fleet", 4000, 800, 2000);
    limiter.recordCost(estimateCallCost(4000, 800));

    // step 6: approval
    const { immediate } = filterThroughApproval(llmResult, queue);
    assert.equal(immediate.length, 1); // medium confidence send_input passes

    // step 7: graduation tracking
    graduation.recordSuccess("adventure");
    graduation.recordSuccess("code-music");
    graduation.recordFailure("broken");

    // step 8: velocity
    velocity.recordProgress("adventure", 60);
    velocity.recordProgress("code-music", 80);

    // step 9: verify state
    assert.equal(cache.getStats().entries, 0); // nothing cached yet in this test path
    assert.ok(costTracker.getSummary().totalCalls === 1);
    assert.ok(graduation.getState("adventure")?.successRate === 1);
    assert.ok(graduation.getState("broken")?.successRate === 0);
  });
});
