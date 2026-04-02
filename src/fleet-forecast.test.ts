import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeFleetForecast, formatFleetForecast } from "./fleet-forecast.js";
import type { BudgetPrediction } from "./budget-predictor.js";

function makePrediction(overrides: Partial<BudgetPrediction> = {}): BudgetPrediction {
  return {
    sessionTitle: "test",
    currentCostUsd: 5,
    budgetUsd: 10,
    burnRateUsdPerHour: 1,
    estimatedExhaustionMs: 5 * 3_600_000,
    estimatedExhaustionLabel: "5h",
    warningLevel: "ok",
    ...overrides,
  };
}

describe("computeFleetForecast", () => {
  it("handles empty predictions", () => {
    const forecast = computeFleetForecast([]);
    assert.equal(forecast.sessionCount, 0);
    assert.equal(forecast.totalCurrentCostUsd, 0);
    assert.equal(forecast.totalBurnRateUsdPerHour, 0);
    assert.equal(forecast.earliestExhaustion, null);
  });

  it("aggregates costs and burn rates", () => {
    const predictions = [
      makePrediction({ sessionTitle: "a", currentCostUsd: 3, budgetUsd: 10, burnRateUsdPerHour: 1 }),
      makePrediction({ sessionTitle: "b", currentCostUsd: 7, budgetUsd: 15, burnRateUsdPerHour: 2 }),
    ];
    const forecast = computeFleetForecast(predictions);
    assert.equal(forecast.sessionCount, 2);
    assert.equal(forecast.totalCurrentCostUsd, 10);
    assert.equal(forecast.totalBudgetUsd, 25);
    assert.equal(forecast.totalBurnRateUsdPerHour, 3);
    assert.equal(forecast.projectedDailyCostUsd, 72); // 3 * 24
    assert.equal(forecast.projectedWeeklyCostUsd, 504); // 3 * 24 * 7
  });

  it("finds earliest exhaustion", () => {
    const predictions = [
      makePrediction({ sessionTitle: "soon", estimatedExhaustionMs: 1_800_000, estimatedExhaustionLabel: "30m" }),
      makePrediction({ sessionTitle: "later", estimatedExhaustionMs: 7_200_000, estimatedExhaustionLabel: "2h" }),
    ];
    const forecast = computeFleetForecast(predictions);
    assert.ok(forecast.earliestExhaustion);
    assert.equal(forecast.earliestExhaustion.session, "soon");
    assert.equal(forecast.earliestExhaustion.label, "30m");
  });

  it("tracks over-budget and imminent sessions", () => {
    const predictions = [
      makePrediction({ sessionTitle: "exceeded", warningLevel: "exceeded" }),
      makePrediction({ sessionTitle: "imminent", warningLevel: "imminent" }),
      makePrediction({ sessionTitle: "ok", warningLevel: "ok" }),
    ];
    const forecast = computeFleetForecast(predictions);
    assert.deepEqual(forecast.overBudgetSessions, ["exceeded"]);
    assert.deepEqual(forecast.imminentSessions, ["imminent"]);
  });

  it("ignores sessions with zero exhaustion time", () => {
    const predictions = [
      makePrediction({ sessionTitle: "stable", estimatedExhaustionMs: 0 }),
      makePrediction({ sessionTitle: "counting", estimatedExhaustionMs: 3_600_000, estimatedExhaustionLabel: "1h" }),
    ];
    const forecast = computeFleetForecast(predictions);
    assert.ok(forecast.earliestExhaustion);
    assert.equal(forecast.earliestExhaustion.session, "counting");
  });
});

describe("formatFleetForecast", () => {
  it("formats a forecast with sessions", () => {
    const forecast = computeFleetForecast([
      makePrediction({ sessionTitle: "a", currentCostUsd: 5, budgetUsd: 10, burnRateUsdPerHour: 2 }),
    ]);
    const lines = formatFleetForecast(forecast);
    assert.ok(lines.some((l) => l.includes("$5.00")));
    assert.ok(lines.some((l) => l.includes("$2.00/hr")));
    assert.ok(lines.some((l) => l.includes("within budget")));
  });

  it("shows warnings for over-budget", () => {
    const forecast = computeFleetForecast([
      makePrediction({ sessionTitle: "hot", warningLevel: "exceeded" }),
    ]);
    const lines = formatFleetForecast(forecast);
    assert.ok(lines.some((l) => l.includes("Over budget") && l.includes("hot")));
  });
});
