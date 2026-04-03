import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildDashboardData, formatOpsDashboard } from "./fleet-ops-dashboard.js";

describe("buildDashboardData", () => {
  it("builds data with timestamp", () => {
    const d = buildDashboardData({
      sessions: [{ title: "alpha", status: "active", healthPct: 80, costUsd: 5, progressPct: 60, sentiment: "progress", idleMinutes: 0 }],
      fleetHealth: 85, totalCostUsd: 25, unresolvedIncidents: 0,
      poolUtilizationPct: 40, readinessGrade: "READY",
      recentEvents: ["goal completed"], uptimeHours: 12, tickCount: 500,
    });
    assert.ok(d.timestamp > 0);
    assert.equal(d.sessions.length, 1);
    assert.equal(d.fleetHealth, 85);
  });
});

describe("formatOpsDashboard", () => {
  it("renders dashboard with box drawing", () => {
    const d = buildDashboardData({
      sessions: [
        { title: "alpha", status: "active", healthPct: 80, costUsd: 5, progressPct: 60, sentiment: "progress", idleMinutes: 0 },
        { title: "beta", status: "error", healthPct: 30, costUsd: 10, progressPct: 20, sentiment: "error", idleMinutes: 15 },
      ],
      fleetHealth: 55, totalCostUsd: 15, unresolvedIncidents: 2,
      poolUtilizationPct: 60, readinessGrade: "CAUTION",
      recentEvents: ["error in beta", "alpha progressing"], uptimeHours: 8, tickCount: 300,
    });
    const lines = formatOpsDashboard(d);
    assert.ok(lines[0].includes("╔"));
    assert.ok(lines.some((l) => l.includes("Fleet Operations")));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("beta")));
    assert.ok(lines.some((l) => l.includes("Recent Events")));
    assert.ok(lines[lines.length - 1].includes("╚"));
  });

  it("handles empty sessions", () => {
    const d = buildDashboardData({
      sessions: [], fleetHealth: 100, totalCostUsd: 0, unresolvedIncidents: 0,
      poolUtilizationPct: 0, readinessGrade: "READY", recentEvents: [],
      uptimeHours: 1, tickCount: 50,
    });
    const lines = formatOpsDashboard(d);
    assert.ok(lines.length > 3);
  });

  it("truncates many sessions", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      title: `session-${i}`, status: "active", healthPct: 80,
      costUsd: 1, progressPct: 50, sentiment: "progress", idleMinutes: 0,
    }));
    const d = buildDashboardData({
      sessions, fleetHealth: 80, totalCostUsd: 12, unresolvedIncidents: 0,
      poolUtilizationPct: 80, readinessGrade: "READY", recentEvents: [],
      uptimeHours: 5, tickCount: 200,
    });
    const lines = formatOpsDashboard(d);
    assert.ok(lines.some((l) => l.includes("more sessions")));
  });
});
