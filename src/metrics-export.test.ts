import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { formatPrometheusMetrics, buildMetricsSnapshot } from "./metrics-export.js";

describe("formatPrometheusMetrics", () => {
  it("produces valid Prometheus format", () => {
    const m = buildMetricsSnapshot({ fleetHealth: 80, totalSessions: 5, activeSessions: 3, totalCostUsd: 12.5, uptimeMs: 3_600_000 });
    const text = formatPrometheusMetrics(m);
    assert.ok(text.includes("# HELP aoaoe_fleet_health"));
    assert.ok(text.includes("# TYPE aoaoe_fleet_health gauge"));
    assert.ok(text.includes("aoaoe_fleet_health 80"));
    assert.ok(text.includes("aoaoe_sessions_total 5"));
    assert.ok(text.includes("aoaoe_cost_usd_total 12.5"));
    assert.ok(text.includes("aoaoe_uptime_seconds 3600"));
  });

  it("handles zero values", () => {
    const m = buildMetricsSnapshot({});
    const text = formatPrometheusMetrics(m);
    assert.ok(text.includes("aoaoe_fleet_health 0"));
  });
});

describe("buildMetricsSnapshot", () => {
  it("fills defaults for missing fields", () => {
    const m = buildMetricsSnapshot({ fleetHealth: 90 });
    assert.equal(m.fleetHealth, 90);
    assert.equal(m.totalSessions, 0);
    assert.equal(m.pollIntervalMs, 10_000);
  });
});
