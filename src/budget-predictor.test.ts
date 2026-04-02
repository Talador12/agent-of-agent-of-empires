import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { BudgetPredictor } from "./budget-predictor.js";
import type { CostBudgetConfig } from "./cost-budget.js";

describe("BudgetPredictor", () => {
  it("returns null with no budget configured", () => {
    const predictor = new BudgetPredictor();
    predictor.recordCost("test", "$3.00");
    predictor.recordCost("test", "$4.00");
    const result = predictor.predict("test", {});
    assert.equal(result, null);
  });

  it("returns null with fewer than 2 samples", () => {
    const predictor = new BudgetPredictor();
    predictor.recordCost("test", "$3.00");
    const result = predictor.predict("test", { globalBudgetUsd: 10 });
    assert.equal(result, null);
  });

  it("predicts exhaustion with steady burn rate", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    // $1/hour burn rate: $0 at T-0, $1 at T+1h
    predictor.recordCost("test", "$5.00", now - 60 * 60_000);
    predictor.recordCost("test", "$6.00", now);

    const result = predictor.predict("test", { globalBudgetUsd: 10 }, now);
    assert.ok(result);
    assert.equal(result.currentCostUsd, 6);
    assert.equal(result.budgetUsd, 10);
    assert.ok(result.burnRateUsdPerHour > 0.9 && result.burnRateUsdPerHour < 1.1); // ~$1/hr
    assert.ok(result.estimatedExhaustionMs > 0);
    // $4 remaining at $1/hr = ~4 hours
    const hoursToExhaustion = result.estimatedExhaustionMs / 3_600_000;
    assert.ok(hoursToExhaustion > 3.5 && hoursToExhaustion < 4.5);
    assert.equal(result.warningLevel, "ok");
  });

  it("detects imminent exhaustion", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    predictor.recordCost("test", "$8.00", now - 30 * 60_000);
    predictor.recordCost("test", "$9.50", now);

    const result = predictor.predict("test", { globalBudgetUsd: 10 }, now);
    assert.ok(result);
    assert.equal(result.warningLevel, "imminent");
  });

  it("detects already exceeded budget", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    predictor.recordCost("test", "$8.00", now - 60 * 60_000);
    predictor.recordCost("test", "$12.00", now);

    const result = predictor.predict("test", { globalBudgetUsd: 10 }, now);
    assert.ok(result);
    assert.equal(result.warningLevel, "exceeded");
    assert.equal(result.estimatedExhaustionMs, 0);
  });

  it("returns stable when cost is not increasing", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    predictor.recordCost("test", "$3.00", now - 60 * 60_000);
    predictor.recordCost("test", "$3.00", now - 30 * 60_000);
    // cost didn't change — deduped, so only 1 sample
    // need a different amount to get a second sample
    predictor.recordCost("test", "$3.01", now);

    const result = predictor.predict("test", { globalBudgetUsd: 10 }, now);
    assert.ok(result);
    // very low burn rate, so should be ok
    assert.equal(result.warningLevel, "ok");
  });

  it("deduplicates identical cost readings", () => {
    const predictor = new BudgetPredictor();
    predictor.recordCost("test", "$3.00");
    predictor.recordCost("test", "$3.00");
    predictor.recordCost("test", "$3.00");
    assert.equal(predictor.getSampleCount("test"), 1); // deduped
  });

  it("skips null/undefined cost strings", () => {
    const predictor = new BudgetPredictor();
    predictor.recordCost("test", undefined);
    predictor.recordCost("test", "no cost");
    assert.equal(predictor.getSampleCount("test"), 0);
  });

  it("predictAll returns predictions for all sessions", () => {
    const predictor = new BudgetPredictor();
    const now = Date.now();
    predictor.recordCost("a", "$1.00", now - 60_000);
    predictor.recordCost("a", "$2.00", now);
    predictor.recordCost("b", "$5.00", now - 60_000);
    predictor.recordCost("b", "$6.00", now);

    const config: CostBudgetConfig = { globalBudgetUsd: 10 };
    const results = predictor.predictAll(config, now);
    assert.equal(results.length, 2);
  });

  it("format produces readable output", () => {
    const prediction = {
      sessionTitle: "adventure",
      currentCostUsd: 7.5,
      budgetUsd: 10,
      burnRateUsdPerHour: 2.5,
      estimatedExhaustionMs: 3_600_000,
      estimatedExhaustionLabel: "1h",
      warningLevel: "approaching" as const,
    };
    const formatted = BudgetPredictor.format(prediction);
    assert.ok(formatted.includes("adventure"));
    assert.ok(formatted.includes("$7.50"));
    assert.ok(formatted.includes("$2.50/hr"));
    assert.ok(formatted.includes("1h"));
  });
});
