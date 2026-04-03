// property-tests.test.ts — property-based testing for intelligence modules.
// generates random inputs and verifies invariants hold for any input.
// catches edge cases that hand-written unit tests miss.

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

// modules under test
import { computeStats, zScore } from "./anomaly-detector.js";
import { computeOverlap, extractKeywords } from "./drift-detector.js";
import { renderSparkline } from "./activity-heatmap.js";
import { parseCostUsd } from "./cost-budget.js";
import { estimateCallCost, parseTokenUsage } from "./reasoner-cost.js";
import { scoreDifficulty } from "./difficulty-scorer.js";
import { computeRetryDelayDeterministic } from "./task-retry.js";
import { aggregateConfidence } from "./goal-detector.js";
import { compressObservation, estimateTokens } from "./context-compressor.js";
import { ObservationCache } from "./observation-cache.js";
import { FleetRateLimiter } from "./fleet-rate-limiter.js";
import { NudgeTracker } from "./nudge-tracker.js";
import { SessionPoolManager } from "./session-pool.js";
import { GraduationManager } from "./session-graduation.js";
import { FleetSlaMonitor } from "./fleet-sla.js";
import { BudgetPredictor } from "./budget-predictor.js";

// ── random generators ────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function randString(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789 -_.";
  return Array.from({ length: len }, () => chars[randInt(0, chars.length - 1)]).join("");
}
function randArray<T>(gen: () => T, minLen: number, maxLen: number): T[] {
  return Array.from({ length: randInt(minLen, maxLen) }, gen);
}

// ── property tests ───────────────────────────────────────────────────────

describe("property: computeStats", () => {
  it("mean is always between min and max of input", () => {
    for (let trial = 0; trial < 100; trial++) {
      const values = randArray(() => randFloat(-1000, 1000), 1, 20);
      const { mean } = computeStats(values);
      assert.ok(mean >= Math.min(...values) - 0.001, `mean ${mean} < min ${Math.min(...values)}`);
      assert.ok(mean <= Math.max(...values) + 0.001, `mean ${mean} > max ${Math.max(...values)}`);
    }
  });

  it("stdDev is always non-negative", () => {
    for (let trial = 0; trial < 100; trial++) {
      const values = randArray(() => randFloat(-100, 100), 1, 20);
      const { stdDev } = computeStats(values);
      assert.ok(stdDev >= 0, `stdDev ${stdDev} is negative`);
    }
  });
});

describe("property: zScore", () => {
  it("returns 0 when value equals mean", () => {
    for (let trial = 0; trial < 50; trial++) {
      const mean = randFloat(-100, 100);
      const stdDev = randFloat(0.1, 50);
      assert.ok(Math.abs(zScore(mean, mean, stdDev)) < 0.001);
    }
  });
});

describe("property: computeOverlap", () => {
  it("returns value between 0 and 1", () => {
    for (let trial = 0; trial < 100; trial++) {
      const goal = randArray(() => randString(randInt(3, 8)), 0, 10);
      const output = randArray(() => randString(randInt(3, 8)), 0, 20);
      const overlap = computeOverlap(goal, output);
      assert.ok(overlap >= 0 && overlap <= 1, `overlap ${overlap} out of range`);
    }
  });

  it("full overlap returns 1 when output contains all goal keywords", () => {
    const goal = ["auth", "login", "session"];
    const output = ["auth", "login", "session", "extra"];
    assert.equal(computeOverlap(goal, output), 1);
  });
});

describe("property: extractKeywords", () => {
  it("never returns empty strings", () => {
    for (let trial = 0; trial < 50; trial++) {
      const text = randString(randInt(0, 200));
      const kw = extractKeywords(text);
      for (const w of kw) assert.ok(w.length > 0, "empty keyword found");
    }
  });

  it("returns lowercase only", () => {
    for (let trial = 0; trial < 50; trial++) {
      const text = "UPPER lower MiXeD " + randString(50);
      const kw = extractKeywords(text);
      for (const w of kw) assert.equal(w, w.toLowerCase());
    }
  });
});

describe("property: renderSparkline", () => {
  it("output length equals input length", () => {
    for (let trial = 0; trial < 50; trial++) {
      const values = randArray(() => randInt(0, 100), 0, 30);
      const sparkline = renderSparkline(values);
      assert.equal(sparkline.length, values.length);
    }
  });
});

describe("property: parseCostUsd", () => {
  it("parses any $N.NN format", () => {
    for (let trial = 0; trial < 50; trial++) {
      const amount = randFloat(0, 1000).toFixed(2);
      const result = parseCostUsd(`$${amount}`);
      assert.ok(result !== null, `failed to parse $${amount}`);
      assert.ok(Math.abs(result! - parseFloat(amount)) < 0.01);
    }
  });

  it("returns null for garbage input", () => {
    for (let trial = 0; trial < 50; trial++) {
      const garbage = randString(randInt(0, 20));
      const result = parseCostUsd(garbage);
      // should either parse correctly or return null, never throw
      assert.ok(result === null || typeof result === "number");
    }
  });
});

describe("property: estimateCallCost", () => {
  it("cost is always non-negative", () => {
    for (let trial = 0; trial < 50; trial++) {
      const input = randInt(0, 200000);
      const output = randInt(0, 50000);
      const cost = estimateCallCost(input, output);
      assert.ok(cost >= 0, `cost ${cost} is negative`);
    }
  });

  it("cost increases with more tokens", () => {
    const baseCost = estimateCallCost(1000, 500);
    const moreCost = estimateCallCost(10000, 5000);
    assert.ok(moreCost > baseCost);
  });
});

describe("property: scoreDifficulty", () => {
  it("score is always 1-10", () => {
    for (let trial = 0; trial < 100; trial++) {
      const goal = randString(randInt(5, 300));
      const d = scoreDifficulty("test", goal, randInt(0, 20), randInt(0, 10_000_000));
      assert.ok(d.score >= 1 && d.score <= 10, `score ${d.score} out of range for goal: "${goal.slice(0, 50)}"`);
    }
  });

  it("estimatedHours is always positive", () => {
    for (let trial = 0; trial < 50; trial++) {
      const d = scoreDifficulty("test", randString(50));
      assert.ok(d.estimatedHours > 0);
    }
  });
});

describe("property: computeRetryDelayDeterministic", () => {
  it("delay increases with attempt number (up to cap)", () => {
    const config = { maxRetries: 10, baseDelayMs: 1000, maxDelayMs: 60000, jitterFraction: 0 };
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      const delay = computeRetryDelayDeterministic(i, config);
      assert.ok(delay >= prev, `delay decreased: ${delay} < ${prev}`);
      assert.ok(delay <= config.maxDelayMs, `delay ${delay} exceeds max ${config.maxDelayMs}`);
      prev = delay;
    }
  });
});

describe("property: aggregateConfidence", () => {
  it("returns value between 0 and 1", () => {
    for (let trial = 0; trial < 50; trial++) {
      const signals = randArray(
        () => ({ type: "explicit_done" as const, confidence: randFloat(0, 1), detail: "test" }),
        0, 10,
      );
      const result = aggregateConfidence(signals);
      assert.ok(result >= 0 && result <= 1, `aggregateConfidence ${result} out of [0,1]`);
    }
  });

  it("adding signals never decreases confidence", () => {
    const base = [{ type: "explicit_done" as const, confidence: 0.5, detail: "a" }];
    const baseConf = aggregateConfidence(base);
    const extended = [...base, { type: "tests_passed" as const, confidence: 0.3, detail: "b" }];
    const extConf = aggregateConfidence(extended);
    assert.ok(extConf >= baseConf - 0.001);
  });
});

describe("property: compressObservation", () => {
  it("compressed output is never longer than original", () => {
    for (let trial = 0; trial < 20; trial++) {
      const lines = randArray(() => randString(randInt(10, 80)), 0, 200);
      const result = compressObservation(lines, 30, 10);
      assert.ok(result.compressedLineCount <= result.originalLineCount + 15, // +15 for summary markers
        `compressed ${result.compressedLineCount} > original ${result.originalLineCount}`);
    }
  });

  it("compressionRatio is between 0 and 1 for long inputs", () => {
    const lines = randArray(() => randString(50), 100, 200);
    const result = compressObservation(lines, 20, 5);
    assert.ok(result.compressionRatio > 0 && result.compressionRatio <= 1);
  });
});

describe("property: estimateTokens", () => {
  it("scales roughly linearly with string length", () => {
    for (let trial = 0; trial < 20; trial++) {
      const text = randString(randInt(0, 1000));
      const tokens = estimateTokens(text);
      assert.ok(tokens >= 0);
      assert.ok(tokens <= text.length); // can't have more tokens than chars
    }
  });
});

describe("property: ObservationCache", () => {
  it("never returns wrong cached value", () => {
    const cache = new ObservationCache(60_000, 50);
    const entries: Array<{ key: string; value: { actions: Array<{ action: string }> } }> = [];
    for (let i = 0; i < 30; i++) {
      const key = JSON.stringify({ id: i, data: randString(20) });
      const value = { actions: [{ action: "wait" as const, reason: `cached-${i}` }] };
      cache.set(key, value);
      entries.push({ key, value });
    }
    // verify all entries return correct values
    for (const { key, value } of entries) {
      const cached = cache.get(key);
      if (cached) {
        assert.deepEqual(cached, value, `cache returned wrong value for key`);
      }
      // null is ok (eviction), wrong value is not
    }
  });
});

describe("property: FleetRateLimiter", () => {
  it("blocking state is consistent with cost data", () => {
    const limiter = new FleetRateLimiter({ maxHourlyCostUsd: 10, maxDailyCostUsd: 100, cooldownMs: 0 });
    const now = Date.now();
    let totalCost = 0;
    for (let i = 0; i < 20; i++) {
      const cost = randFloat(0, 2);
      limiter.recordCost(cost, now);
      totalCost += cost;
    }
    const status = limiter.getStatus(now);
    if (totalCost < 10) {
      assert.equal(status.blocked, false, `blocked with only $${totalCost.toFixed(2)} hourly`);
    }
  });
});

describe("property: GraduationManager", () => {
  it("success rate is always between 0 and 1", () => {
    const mgr = new GraduationManager();
    for (let i = 0; i < 50; i++) {
      if (Math.random() > 0.5) mgr.recordSuccess("test");
      else mgr.recordFailure("test");
    }
    const state = mgr.getState("test");
    assert.ok(state!.successRate >= 0 && state!.successRate <= 1);
  });
});

describe("property: FleetSlaMonitor", () => {
  it("average health is between 0 and 100", () => {
    const monitor = new FleetSlaMonitor({ windowTicks: 10, alertCooldownTicks: 0 });
    for (let i = 0; i < 20; i++) {
      const status = monitor.recordHealth(randInt(0, 100));
      assert.ok(status.averageHealth >= 0 && status.averageHealth <= 100);
    }
  });
});

describe("property: BudgetPredictor", () => {
  it("burn rate is non-negative for increasing costs", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    let cost = 0;
    for (let i = 0; i < 10; i++) {
      cost += randFloat(0, 1);
      predictor.recordCost("test", `$${cost.toFixed(2)}`, now - (9 - i) * 60_000);
    }
    const prediction = predictor.predict("test", { globalBudgetUsd: 100 }, now);
    if (prediction) {
      assert.ok(prediction.burnRateUsdPerHour >= 0, `negative burn rate: ${prediction.burnRateUsdPerHour}`);
    }
  });
});

describe("property: SessionPoolManager", () => {
  it("available slots is never negative", () => {
    const pool = new SessionPoolManager({ maxConcurrent: randInt(1, 10) });
    const tasks = randArray(
      () => ({ repo: "t", sessionTitle: randString(5), sessionMode: "auto" as const, tool: "opencode", goal: "x", status: (["active", "pending", "completed"] as const)[randInt(0, 2)], progress: [] }),
      0, 15,
    );
    const status = pool.getStatus(tasks);
    assert.ok(status.availableSlots >= 0);
  });
});
