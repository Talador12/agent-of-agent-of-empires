import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  projectCosts,
  evaluateCostAlerts,
  formatCostForecastAlerts,
  formatCostProjections,
} from "./cost-forecast-alert.js";

describe("projectCosts", () => {
  it("projects daily/weekly/monthly costs from burn rate", () => {
    const p = projectCosts("test", 5.0, 1.0); // $1/hr
    assert.equal(p.currentCostUsd, 5.0);
    assert.equal(p.projectedDailyCostUsd, 5 + 24); // $29
    assert.equal(p.projectedWeeklyCostUsd, 5 + 24 * 7); // $173
    assert.equal(p.projectedMonthlyCostUsd, 5 + 24 * 30); // $725
  });

  it("handles zero burn rate", () => {
    const p = projectCosts("idle", 3.0, 0);
    assert.equal(p.projectedDailyCostUsd, 3.0);
    assert.equal(p.burnRatePerHr, 0);
  });

  it("clamps negative burn rate to zero", () => {
    const p = projectCosts("refund", 5.0, -2.0);
    assert.equal(p.burnRatePerHr, 0);
  });
});

describe("evaluateCostAlerts", () => {
  it("returns empty when within all limits", () => {
    const projections = [projectCosts("cheap", 1.0, 0.1)]; // $3.4/day
    const alerts = evaluateCostAlerts(projections, { dailyLimitUsd: 50 });
    assert.equal(alerts.length, 0);
  });

  it("fires daily exceed alert", () => {
    const projections = [projectCosts("expensive", 10.0, 2.0)]; // $58/day
    const alerts = evaluateCostAlerts(projections, { dailyLimitUsd: 25 });
    assert.ok(alerts.some((a) => a.alertType === "daily-exceed"));
  });

  it("fires weekly exceed alert", () => {
    const projections = [projectCosts("pricey", 0, 1.0)]; // $168/week
    const alerts = evaluateCostAlerts(projections, { weeklyLimitUsd: 100 });
    assert.ok(alerts.some((a) => a.alertType === "weekly-exceed"));
  });

  it("fires monthly exceed alert", () => {
    const projections = [projectCosts("spendy", 0, 0.5)]; // $360/month
    const alerts = evaluateCostAlerts(projections, { monthlyLimitUsd: 300 });
    assert.ok(alerts.some((a) => a.alertType === "monthly-exceed"));
  });

  it("marks critical when breach is imminent (<2h)", () => {
    // current: $24, burn: $1/hr, daily limit: $25 → breach in 1h
    const projections = [projectCosts("urgent", 24.0, 1.0)];
    const alerts = evaluateCostAlerts(projections, { dailyLimitUsd: 25 });
    const daily = alerts.find((a) => a.alertType === "daily-exceed");
    assert.ok(daily);
    assert.equal(daily!.severity, "critical");
    assert.ok(daily!.etaHours !== undefined && daily!.etaHours <= 2);
  });

  it("sorts critical before warning", () => {
    const projections = [
      projectCosts("urgent", 24.0, 1.0),
      projectCosts("normal", 0, 2.0),
    ];
    const alerts = evaluateCostAlerts(projections, { dailyLimitUsd: 25 });
    if (alerts.length >= 2) {
      assert.equal(alerts[0].severity, "critical");
    }
  });

  it("handles empty projections", () => {
    assert.deepEqual(evaluateCostAlerts([]), []);
  });
});

describe("formatCostForecastAlerts", () => {
  it("shows all-clear message when no alerts", () => {
    const lines = formatCostForecastAlerts([]);
    assert.ok(lines[0].includes("within limits"));
  });

  it("shows alert details", () => {
    const projections = [projectCosts("expensive", 10.0, 3.0)];
    const alerts = evaluateCostAlerts(projections, { dailyLimitUsd: 25 });
    const lines = formatCostForecastAlerts(alerts);
    assert.ok(lines.some((l) => l.includes("expensive")));
    assert.ok(lines.some((l) => l.includes("daily-exceed")));
  });
});

describe("formatCostProjections", () => {
  it("shows no-data message when empty", () => {
    const lines = formatCostProjections([]);
    assert.ok(lines[0].includes("no session data"));
  });

  it("shows projection table", () => {
    const projections = [projectCosts("test", 5.0, 1.0)];
    const lines = formatCostProjections(projections);
    assert.ok(lines[0].includes("Cost Projections"));
    assert.ok(lines.some((l) => l.includes("test")));
  });
});
