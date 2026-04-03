import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { planBudget, formatBudgetPlan } from "./fleet-budget-planner.js";
import type { BudgetPlanInput } from "./fleet-budget-planner.js";

function makeInput(overrides: Partial<BudgetPlanInput> = {}): BudgetPlanInput {
  return {
    sessionTitle: "alpha", priorityScore: 50, progressPct: 30,
    costUsd: 5.0, burnRatePerHr: 1.0, status: "active",
    ...overrides,
  };
}

describe("planBudget", () => {
  it("distributes budget across sessions", () => {
    const inputs = [
      makeInput({ sessionTitle: "a", priorityScore: 80 }),
      makeInput({ sessionTitle: "b", priorityScore: 40 }),
    ];
    const plan = planBudget(inputs, 100);
    assert.equal(plan.allocations.length, 2);
    assert.ok(plan.allocations[0].allocatedBudgetUsd > 0);
    assert.ok(plan.allocations[1].allocatedBudgetUsd > 0);
  });

  it("gives more to higher priority sessions", () => {
    const inputs = [
      makeInput({ sessionTitle: "high", priorityScore: 90, progressPct: 10 }),
      makeInput({ sessionTitle: "low", priorityScore: 10, progressPct: 10 }),
    ];
    const plan = planBudget(inputs, 100);
    const high = plan.allocations.find((a) => a.sessionTitle === "high")!;
    const low = plan.allocations.find((a) => a.sessionTitle === "low")!;
    assert.ok(high.allocatedBudgetUsd > low.allocatedBudgetUsd);
  });

  it("reduces allocation for near-complete tasks", () => {
    const inputs = [
      makeInput({ sessionTitle: "almost", priorityScore: 50, progressPct: 95 }),
      makeInput({ sessionTitle: "starting", priorityScore: 50, progressPct: 5 }),
    ];
    const plan = planBudget(inputs, 100);
    const almost = plan.allocations.find((a) => a.sessionTitle === "almost")!;
    const starting = plan.allocations.find((a) => a.sessionTitle === "starting")!;
    assert.ok(starting.allocatedBudgetUsd > almost.allocatedBudgetUsd);
  });

  it("reserves emergency budget", () => {
    const plan = planBudget([makeInput()], 100, 10);
    assert.equal(plan.reserveUsd, 10);
  });

  it("handles empty inputs", () => {
    const plan = planBudget([], 100);
    assert.equal(plan.allocations.length, 0);
    assert.equal(plan.unallocatedUsd, 100);
  });

  it("handles zero budget", () => {
    const plan = planBudget([makeInput()], 0);
    assert.equal(plan.allocations.length, 0);
  });

  it("skips non-active sessions", () => {
    const inputs = [
      makeInput({ sessionTitle: "active", status: "active" }),
      makeInput({ sessionTitle: "done", status: "completed" }),
    ];
    const plan = planBudget(inputs, 100);
    assert.equal(plan.allocations.length, 1);
    assert.equal(plan.allocations[0].sessionTitle, "active");
  });

  it("computes remaining budget correctly", () => {
    const inputs = [makeInput({ costUsd: 10 })];
    const plan = planBudget(inputs, 100);
    const alloc = plan.allocations[0];
    assert.ok(alloc.remainingBudgetUsd >= 0);
    assert.ok(alloc.remainingBudgetUsd <= alloc.allocatedBudgetUsd);
  });

  it("assigns percentage of total", () => {
    const plan = planBudget([makeInput()], 100);
    assert.ok(plan.allocations[0].pctOfTotal > 0);
    assert.ok(plan.allocations[0].pctOfTotal <= 100);
  });
});

describe("formatBudgetPlan", () => {
  it("shows budget plan header", () => {
    const plan = planBudget([makeInput()], 100);
    const lines = formatBudgetPlan(plan);
    assert.ok(lines[0].includes("Fleet Budget Plan"));
    assert.ok(lines[0].includes("$100"));
  });

  it("shows no-sessions message when empty", () => {
    const plan = planBudget([], 100);
    const lines = formatBudgetPlan(plan);
    assert.ok(lines.some((l) => l.includes("No eligible")));
  });

  it("shows allocation table", () => {
    const plan = planBudget([makeInput({ sessionTitle: "alpha" })], 100);
    const lines = formatBudgetPlan(plan);
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
