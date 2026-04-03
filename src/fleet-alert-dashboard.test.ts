import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createAlertDashboard, addAlert, acknowledgeAlert, dismissAlert, activeAlerts, alertsBySource, alertCounts, formatAlertDashboard } from "./fleet-alert-dashboard.js";

describe("createAlertDashboard", () => {
  it("starts empty", () => { assert.equal(createAlertDashboard().alerts.length, 0); });
});

describe("addAlert", () => {
  it("adds an alert with incremental ID", () => {
    const s = createAlertDashboard();
    const a = addAlert(s, "incident", "error", "compile failed", "alpha");
    assert.equal(a.id, 1);
    assert.equal(s.alerts.length, 1);
  });
  it("enforces max alerts", () => {
    const s = createAlertDashboard(3);
    for (let i = 0; i < 5; i++) addAlert(s, "cost", "warning", `alert ${i}`);
    assert.equal(s.alerts.length, 3);
  });
});

describe("acknowledgeAlert", () => {
  it("acknowledges an alert", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "error", "bad");
    assert.ok(acknowledgeAlert(s, 1));
    assert.ok(s.alerts[0].acknowledged);
  });
  it("returns false for already ack'd", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "error", "bad");
    acknowledgeAlert(s, 1);
    assert.ok(!acknowledgeAlert(s, 1));
  });
  it("returns false for invalid ID", () => {
    assert.ok(!acknowledgeAlert(createAlertDashboard(), 999));
  });
});

describe("dismissAlert", () => {
  it("removes an alert", () => {
    const s = createAlertDashboard();
    addAlert(s, "cost", "info", "note");
    assert.ok(dismissAlert(s, 1));
    assert.equal(s.alerts.length, 0);
  });
});

describe("activeAlerts", () => {
  it("filters to unacknowledged", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "error", "a");
    addAlert(s, "cost", "warning", "b");
    acknowledgeAlert(s, 1);
    assert.equal(activeAlerts(s).length, 1);
  });
});

describe("alertsBySource", () => {
  it("filters by source", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "error", "a");
    addAlert(s, "cost", "warning", "b");
    assert.equal(alertsBySource(s, "incident").length, 1);
  });
});

describe("alertCounts", () => {
  it("counts active by severity", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "critical", "a");
    addAlert(s, "cost", "warning", "b");
    addAlert(s, "health", "error", "c");
    const c = alertCounts(s);
    assert.equal(c.critical, 1);
    assert.equal(c.warning, 1);
    assert.equal(c.error, 1);
  });
});

describe("formatAlertDashboard", () => {
  it("shows no-alerts message when empty", () => {
    const lines = formatAlertDashboard(createAlertDashboard());
    assert.ok(lines.some((l) => l.includes("No active")));
  });
  it("shows alerts with details", () => {
    const s = createAlertDashboard();
    addAlert(s, "incident", "error", "compile failed", "alpha");
    const lines = formatAlertDashboard(s);
    assert.ok(lines[0].includes("Alert Dashboard"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
