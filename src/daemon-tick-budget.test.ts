import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createTickBudget, getPhaseBudget, checkBudgets, recentOverruns, worstPhase, formatTickBudget } from "./daemon-tick-budget.js";

describe("createTickBudget", () => {
  it("creates with default allocations", () => {
    const s = createTickBudget();
    assert.equal(s.config.totalBudgetMs, 10_000);
    assert.ok(s.config.phaseAllocations.size >= 4);
  });
});

describe("getPhaseBudget", () => {
  it("computes budget from percentage", () => {
    const s = createTickBudget(10_000);
    assert.equal(getPhaseBudget(s, "poll"), 3000); // 30%
    assert.equal(getPhaseBudget(s, "reason"), 4000); // 40%
  });
  it("returns default for unknown phase", () => {
    const s = createTickBudget(10_000);
    assert.equal(getPhaseBudget(s, "unknown"), 1000); // 10% default
  });
});

describe("checkBudgets", () => {
  it("detects overruns", () => {
    const s = createTickBudget(10_000);
    const actuals = new Map([["poll", 5000], ["reason", 3000]]); // poll exceeds 3000ms budget
    const results = checkBudgets(s, 1, actuals);
    const pollResult = results.find((r) => r.phase === "poll");
    assert.ok(pollResult?.overrun);
  });
  it("no overrun when within budget", () => {
    const s = createTickBudget(10_000);
    const actuals = new Map([["poll", 2000], ["reason", 3000]]);
    const results = checkBudgets(s, 1, actuals);
    assert.ok(!results.find((r) => r.phase === "poll")?.overrun);
  });
  it("records overruns in state", () => {
    const s = createTickBudget(10_000);
    checkBudgets(s, 1, new Map([["poll", 5000]]));
    assert.equal(s.overruns.length, 1);
  });
});

describe("recentOverruns", () => {
  it("returns last N overruns", () => {
    const s = createTickBudget(1000);
    for (let i = 0; i < 10; i++) checkBudgets(s, i, new Map([["poll", 500]])); // 500 > 300 (30% of 1000)
    assert.equal(recentOverruns(s, 3).length, 3);
  });
});

describe("worstPhase", () => {
  it("identifies most overrun phase", () => {
    const s = createTickBudget(1000);
    checkBudgets(s, 1, new Map([["poll", 500]]));
    checkBudgets(s, 2, new Map([["poll", 500]]));
    checkBudgets(s, 3, new Map([["reason", 600]]));
    const worst = worstPhase(s);
    assert.ok(worst);
    assert.equal(worst!.phase, "poll");
    assert.equal(worst!.count, 2);
  });
  it("returns null with no overruns", () => {
    assert.equal(worstPhase(createTickBudget()), null);
  });
});

describe("formatTickBudget", () => {
  it("shows budget allocations", () => {
    const s = createTickBudget();
    const lines = formatTickBudget(s);
    assert.ok(lines[0].includes("Tick Budget"));
    assert.ok(lines.some((l) => l.includes("poll")));
    assert.ok(lines.some((l) => l.includes("reason")));
  });
  it("shows overruns when present", () => {
    const s = createTickBudget(1000);
    checkBudgets(s, 1, new Map([["poll", 500]]));
    const lines = formatTickBudget(s);
    assert.ok(lines.some((l) => l.includes("overrun")));
  });
});
