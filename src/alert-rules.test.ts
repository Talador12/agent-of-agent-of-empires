import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { defaultAlertRules, evaluateAlertRules, formatFiredAlerts, formatAlertRules } from "./alert-rules.js";
import type { AlertContext } from "./alert-rules.js";

function makeContext(overrides: Partial<AlertContext> = {}): AlertContext {
  return { fleetHealth: 80, activeSessions: 5, errorSessions: 0, totalCostUsd: 10, hourlyCostRate: 1, stuckSessions: 0, idleMinutes: new Map(), ...overrides };
}

describe("evaluateAlertRules", () => {
  it("fires no alerts for healthy fleet", () => {
    const rules = defaultAlertRules();
    const alerts = evaluateAlertRules(rules, makeContext());
    assert.equal(alerts.length, 0);
  });

  it("fires critical alert for low health", () => {
    const rules = defaultAlertRules();
    const alerts = evaluateAlertRules(rules, makeContext({ fleetHealth: 20 }));
    assert.ok(alerts.some((a) => a.ruleName === "fleet-health-critical"));
  });

  it("fires high-error-rate alert", () => {
    const rules = defaultAlertRules();
    const alerts = evaluateAlertRules(rules, makeContext({ activeSessions: 4, errorSessions: 3 }));
    assert.ok(alerts.some((a) => a.ruleName === "high-error-rate"));
  });

  it("fires cost-spike alert", () => {
    const rules = defaultAlertRules();
    const alerts = evaluateAlertRules(rules, makeContext({ hourlyCostRate: 10 }));
    assert.ok(alerts.some((a) => a.ruleName === "cost-spike"));
  });

  it("fires all-stuck alert", () => {
    const rules = defaultAlertRules();
    const alerts = evaluateAlertRules(rules, makeContext({ activeSessions: 3, stuckSessions: 3 }));
    assert.ok(alerts.some((a) => a.ruleName === "all-stuck"));
  });

  it("respects cooldown", () => {
    const rules = defaultAlertRules();
    const now = Date.now();
    evaluateAlertRules(rules, makeContext({ fleetHealth: 20 }), now); // fires
    const alerts2 = evaluateAlertRules(rules, makeContext({ fleetHealth: 20 }), now + 1000); // cooldown
    assert.ok(!alerts2.some((a) => a.ruleName === "fleet-health-critical"));
  });
});

describe("formatFiredAlerts", () => {
  it("shows clean message for no alerts", () => {
    const lines = formatFiredAlerts([]);
    assert.ok(lines[0].includes("no alerts"));
  });
  it("shows alert with severity icon", () => {
    const alerts = [{ ruleName: "test", severity: "critical" as const, message: "bad", timestamp: Date.now() }];
    const lines = formatFiredAlerts(alerts);
    assert.ok(lines[0].includes("🚨"));
  });
});

describe("formatAlertRules", () => {
  it("lists all default rules", () => {
    const lines = formatAlertRules(defaultAlertRules());
    assert.ok(lines.length >= 5);
    assert.ok(lines.some((l) => l.includes("fleet-health-critical")));
  });
});
