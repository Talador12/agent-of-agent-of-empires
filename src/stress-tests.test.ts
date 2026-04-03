// stress-tests.test.ts — edge case and stress tests for intelligence modules.
// verifies modules handle extreme inputs without crashing or breaking invariants.

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ObservationCache } from "./observation-cache.js";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";
import { TokenQuotaManager } from "./token-quota.js";
import { GraduationManager } from "./session-graduation.js";
import { FleetSlaMonitor } from "./fleet-sla.js";
import { NudgeTracker } from "./nudge-tracker.js";
import { EscalationManager } from "./notify-escalation.js";
import { AdaptivePollController } from "./adaptive-poll.js";
import { ABReasoningTracker, compareResults } from "./ab-reasoning.js";
import { createWorkflowChain, advanceChain } from "./workflow-chain.js";
import { ApprovalQueue } from "./approval-queue.js";
import { compressObservation } from "./context-compressor.js";
import { computeStats } from "./anomaly-detector.js";
import type { ReasonerResult } from "./types.js";

describe("stress: graduation rapid cycling", () => {
  it("handles 200 alternating success/failure", () => {
    const mgr = new GraduationManager({ cooldownTicks: 0, minActionsForPromotion: 3 });
    for (let i = 0; i < 200; i++) {
      if (i % 3 === 0) mgr.recordFailure("test");
      else mgr.recordSuccess("test");
      mgr.evaluate("test");
    }
    const state = mgr.getState("test")!;
    assert.ok(state.successRate >= 0 && state.successRate <= 1);
    assert.ok(["observe", "confirm", "auto"].includes(state.currentMode));
  });
});

describe("stress: SLA oscillating health", () => {
  it("handles 100 ticks of random health", () => {
    const monitor = new FleetSlaMonitor({ healthThreshold: 50, windowTicks: 10, alertCooldownTicks: 3 });
    for (let i = 0; i < 100; i++) {
      const status = monitor.recordHealth(Math.floor(Math.random() * 100));
      assert.ok(status.averageHealth >= 0 && status.averageHealth <= 100);
    }
  });
});

describe("stress: cache eviction", () => {
  it("handles 200 entries with max 50", () => {
    const cache = new ObservationCache(60_000, 50);
    for (let i = 0; i < 200; i++) {
      cache.set(`{"id":${i}}`, { actions: [{ action: "wait" as const, reason: `${i}` }] });
    }
    assert.equal(cache.getStats().entries, 50);
  });
});

describe("stress: rate limiter burst", () => {
  it("handles 50 rapid costs", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 10, cooldownMs: 0 });
    const now = Date.now();
    for (let i = 0; i < 50; i++) limiter.recordCost(0.1, now);
    assert.ok(Math.abs(limiter.getStatus(now).hourlyCostUsd - 5) < 0.01);
  });
});

describe("stress: token quota multi-model", () => {
  it("tracks 5 models independently", () => {
    const mgr = new TokenQuotaManager();
    for (let m = 0; m < 5; m++) mgr.setQuota(`m${m}`, 50_000, 25_000);
    const now = Date.now();
    for (let i = 0; i < 50; i++) mgr.recordUsage(`m${i % 5}`, 1000, 500, now);
    for (let m = 0; m < 5; m++) {
      const s = mgr.getStatus(`m${m}`, now);
      assert.equal(s.inputTokensUsed, 10_000);
    }
  });
});

describe("stress: escalation 10 sessions to critical", () => {
  it("all reach critical", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 2, criticalAfterCount: 4, cooldownMs: 0 });
    for (let s = 0; s < 10; s++) {
      for (let i = 0; i < 5; i++) mgr.recordStuck(`s${s}`);
    }
    assert.ok(mgr.getAllStates().every((s) => s.level === "critical"));
  });
});

describe("stress: nudge tracker 20 sessions", () => {
  it("tracks effectiveness correctly", () => {
    const tracker = new NudgeTracker(5 * 60_000);
    const now = Date.now();
    for (let s = 0; s < 20; s++) tracker.recordNudge(`s${s}`, `n${s}`, now);
    for (let s = 0; s < 10; s++) tracker.recordProgress(`s${s}`, now + 60_000);
    const r = tracker.getReport(now + 10 * 60_000);
    assert.equal(r.effectiveNudges, 10);
    assert.equal(r.ineffectiveNudges, 10);
  });
});

describe("stress: adaptive poll bounds", () => {
  it("stays within min/max after 200 transitions", () => {
    const ctrl = new AdaptivePollController({ baseIntervalMs: 10_000, minIntervalMs: 2_000, maxIntervalMs: 60_000 });
    for (let i = 0; i < 200; i++) ctrl.recordTick(i % 2 === 0 ? 5 : 0, false);
    assert.ok(ctrl.intervalMs >= 2_000 && ctrl.intervalMs <= 60_000);
  });
});

describe("stress: approval queue overflow", () => {
  it("caps at max pending", () => {
    const q = new ApprovalQueue({ maxPending: 20, expiryMs: 60_000 });
    for (let i = 0; i < 100; i++) q.enqueue(`s${i}`, "x", `m${i}`);
    assert.ok(q.getPending().length <= 20);
  });
});

describe("stress: compression edge cases", () => {
  it("empty input", () => {
    const r = compressObservation([], 30, 10);
    assert.equal(r.originalLineCount, 0);
  });
  it("single line", () => {
    const r = compressObservation(["hello"], 30, 10);
    assert.equal(r.text, "hello");
  });
  it("100 lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const r = compressObservation(lines, 20, 5);
    assert.ok(r.compressedLineCount < 100);
  });
});

describe("stress: computeStats extremes", () => {
  it("large numbers", () => {
    const { mean, stdDev } = computeStats([1e15, 2e15, 3e15]);
    assert.ok(isFinite(mean) && isFinite(stdDev));
  });
  it("identical values", () => {
    const { stdDev } = computeStats([42, 42, 42]);
    assert.equal(stdDev, 0);
  });
});

describe("stress: A/B 50 ties", () => {
  it("all ties recorded correctly", () => {
    const tracker = new ABReasoningTracker("a", "b");
    const r: ReasonerResult = { actions: [{ action: "wait", reason: "ok" }], confidence: "medium" };
    for (let i = 0; i < 50; i++) tracker.recordTrial(compareResults(r, r, "a", "b"));
    assert.equal(tracker.getStats().ties, 50);
  });
});

describe("stress: workflow chain diamond", () => {
  it("A → B,C → D completes correctly", () => {
    const chain = createWorkflowChain("diamond", [
      { workflowName: "A" },
      { workflowName: "B", dependsOn: ["A"] },
      { workflowName: "C", dependsOn: ["A"] },
      { workflowName: "D", dependsOn: ["B", "C"] },
    ]);
    advanceChain(chain, new Map()); // activate A
    chain.entries[0].status = "completed";
    advanceChain(chain, new Map()); // activate B,C
    chain.entries[1].status = "completed";
    chain.entries[2].status = "completed";
    advanceChain(chain, new Map()); // activate D
    chain.entries[3].status = "completed";
    const { completed } = advanceChain(chain, new Map());
    assert.equal(completed, true);
  });
});
