import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { aggregateFederation, formatFederationOverview } from "./fleet-federation.js";
import type { FederatedFleetState } from "./fleet-federation.js";

describe("aggregateFederation", () => {
  it("aggregates across peers", () => {
    const states: FederatedFleetState[] = [
      { peer: "host1", sessions: 5, activeTasks: 3, fleetHealth: 80, totalCostUsd: 10, lastUpdatedAt: Date.now() },
      { peer: "host2", sessions: 3, activeTasks: 2, fleetHealth: 60, totalCostUsd: 5, lastUpdatedAt: Date.now() },
    ];
    const overview = aggregateFederation(states);
    assert.equal(overview.totalSessions, 8);
    assert.equal(overview.totalActiveTasks, 5);
    assert.equal(overview.averageHealth, 70);
    assert.equal(overview.totalCostUsd, 15);
  });
  it("handles empty peers", () => {
    const overview = aggregateFederation([]);
    assert.equal(overview.totalSessions, 0);
    assert.equal(overview.averageHealth, 0);
  });
});

describe("formatFederationOverview", () => {
  it("shows peer details", () => {
    const overview = aggregateFederation([
      { peer: "prod-1", sessions: 10, activeTasks: 5, fleetHealth: 90, totalCostUsd: 20, lastUpdatedAt: Date.now() },
    ]);
    const lines = formatFederationOverview(overview);
    assert.ok(lines.some((l) => l.includes("prod-1")));
    assert.ok(lines.some((l) => l.includes("10 sessions")));
  });
  it("handles no peers", () => {
    const lines = formatFederationOverview(aggregateFederation([]));
    assert.ok(lines[0].includes("no federation"));
  });
});
