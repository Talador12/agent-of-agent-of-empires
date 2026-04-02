import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  parseCostUsd,
  getEffectiveBudget,
  computeBudgetStatus,
  findOverBudgetSessions,
  formatBudgetAlert,
  formatBudgetSummary,
} from "./cost-budget.js";
import type { CostBudgetConfig } from "./cost-budget.js";

describe("parseCostUsd", () => {
  it("parses $3.42", () => {
    assert.equal(parseCostUsd("$3.42"), 3.42);
  });

  it("parses $3.42 spent", () => {
    assert.equal(parseCostUsd("$3.42 spent"), 3.42);
  });

  it("parses $0.00", () => {
    assert.equal(parseCostUsd("$0.00"), 0);
  });

  it("parses $12.50", () => {
    assert.equal(parseCostUsd("$12.50"), 12.5);
  });

  it("parses integer amounts", () => {
    assert.equal(parseCostUsd("$5"), 5);
  });

  it("returns null for empty string", () => {
    assert.equal(parseCostUsd(""), null);
  });

  it("returns null for undefined", () => {
    assert.equal(parseCostUsd(undefined), null);
  });

  it("returns null for null", () => {
    assert.equal(parseCostUsd(null), null);
  });

  it("returns null for non-cost string", () => {
    assert.equal(parseCostUsd("no cost here"), null);
  });

  it("returns null for NaN", () => {
    assert.equal(parseCostUsd("$NaN"), null);
  });
});

describe("getEffectiveBudget", () => {
  it("returns global budget when no per-session override", () => {
    const config: CostBudgetConfig = { globalBudgetUsd: 10 };
    assert.equal(getEffectiveBudget("session-a", config), 10);
  });

  it("returns per-session budget when configured", () => {
    const config: CostBudgetConfig = {
      globalBudgetUsd: 10,
      sessionBudgets: { "session-a": 5 },
    };
    assert.equal(getEffectiveBudget("session-a", config), 5);
  });

  it("per-session lookup is case-insensitive", () => {
    const config: CostBudgetConfig = {
      globalBudgetUsd: 10,
      sessionBudgets: { "Session-A": 5 },
    };
    assert.equal(getEffectiveBudget("session-a", config), 5);
  });

  it("returns null when no budget configured", () => {
    const config: CostBudgetConfig = {};
    assert.equal(getEffectiveBudget("session-a", config), null);
  });

  it("falls back to global when per-session key not found", () => {
    const config: CostBudgetConfig = {
      globalBudgetUsd: 15,
      sessionBudgets: { "other-session": 5 },
    };
    assert.equal(getEffectiveBudget("session-a", config), 15);
  });
});

describe("computeBudgetStatus", () => {
  it("returns null when no budget configured", () => {
    assert.equal(computeBudgetStatus("test", "$5.00", {}), null);
  });

  it("returns null when no cost data", () => {
    assert.equal(computeBudgetStatus("test", undefined, { globalBudgetUsd: 10 }), null);
  });

  it("computes ok status under budget", () => {
    const result = computeBudgetStatus("test", "$3.00", { globalBudgetUsd: 10 });
    assert.ok(result);
    assert.equal(result.overBudget, false);
    assert.equal(result.warningLevel, "ok");
    assert.equal(result.currentCostUsd, 3);
    assert.equal(result.budgetUsd, 10);
    assert.equal(result.percentUsed, 30);
  });

  it("computes warning at 75%", () => {
    const result = computeBudgetStatus("test", "$7.50", { globalBudgetUsd: 10 });
    assert.ok(result);
    assert.equal(result.warningLevel, "warning");
    assert.equal(result.overBudget, false);
  });

  it("computes critical at 90%", () => {
    const result = computeBudgetStatus("test", "$9.00", { globalBudgetUsd: 10 });
    assert.ok(result);
    assert.equal(result.warningLevel, "critical");
    assert.equal(result.overBudget, false);
  });

  it("computes exceeded at 100%", () => {
    const result = computeBudgetStatus("test", "$10.00", { globalBudgetUsd: 10 });
    assert.ok(result);
    assert.equal(result.warningLevel, "exceeded");
    assert.equal(result.overBudget, true);
  });

  it("computes exceeded over 100%", () => {
    const result = computeBudgetStatus("test", "$15.00", { globalBudgetUsd: 10 });
    assert.ok(result);
    assert.equal(result.overBudget, true);
    assert.equal(result.percentUsed, 150);
  });
});

describe("findOverBudgetSessions", () => {
  it("returns empty for no sessions", () => {
    const result = findOverBudgetSessions([], { globalBudgetUsd: 10 });
    assert.deepEqual(result, []);
  });

  it("returns empty when all under budget", () => {
    const sessions = [
      { title: "a", costStr: "$3.00", status: "active" },
      { title: "b", costStr: "$5.00", status: "active" },
    ];
    const result = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(result.length, 0);
  });

  it("returns over-budget active sessions", () => {
    const sessions = [
      { title: "cheap", costStr: "$3.00", status: "active" },
      { title: "expensive", costStr: "$15.00", status: "active" },
    ];
    const result = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(result.length, 1);
    assert.equal(result[0].sessionTitle, "expensive");
  });

  it("skips non-active sessions", () => {
    const sessions = [
      { title: "stopped", costStr: "$15.00", status: "stopped" },
    ];
    const result = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(result.length, 0);
  });

  it("uses per-session budgets", () => {
    const sessions = [
      { title: "low-budget", costStr: "$6.00", status: "active" },
      { title: "high-budget", costStr: "$6.00", status: "active" },
    ];
    const config: CostBudgetConfig = {
      globalBudgetUsd: 10,
      sessionBudgets: { "low-budget": 5 },
    };
    const result = findOverBudgetSessions(sessions, config);
    assert.equal(result.length, 1);
    assert.equal(result[0].sessionTitle, "low-budget");
  });

  it("handles working and running statuses as active", () => {
    const sessions = [
      { title: "a", costStr: "$15.00", status: "working" },
      { title: "b", costStr: "$15.00", status: "running" },
    ];
    const result = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(result.length, 2);
  });
});

describe("formatBudgetAlert", () => {
  it("includes session title and cost", () => {
    const status = {
      sessionTitle: "adventure",
      currentCostUsd: 15,
      budgetUsd: 10,
      percentUsed: 150,
      overBudget: true,
      warningLevel: "exceeded" as const,
    };
    const alert = formatBudgetAlert(status);
    assert.ok(alert.includes("adventure"));
    assert.ok(alert.includes("$15.00"));
    assert.ok(alert.includes("$10.00"));
    assert.ok(alert.includes("EXCEEDED"));
  });
});

describe("formatBudgetSummary", () => {
  it("returns placeholder for empty list", () => {
    const lines = formatBudgetSummary([]);
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("includes all sessions", () => {
    const statuses = [
      { sessionTitle: "a", currentCostUsd: 3, budgetUsd: 10, percentUsed: 30, overBudget: false, warningLevel: "ok" as const },
      { sessionTitle: "b", currentCostUsd: 9.5, budgetUsd: 10, percentUsed: 95, overBudget: false, warningLevel: "critical" as const },
    ];
    const lines = formatBudgetSummary(statuses);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes("a"));
    assert.ok(lines[1].includes("b"));
  });
});
