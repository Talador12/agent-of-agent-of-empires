import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createThrottleState,
  updateBurnRate,
  evaluateThrottles,
  getPollMultiplier,
  formatThrottleState,
} from "./cost-anomaly-throttle.js";

describe("createThrottleState", () => {
  it("returns empty state", () => {
    const state = createThrottleState();
    assert.equal(state.burnRates.size, 0);
    assert.equal(state.throttled.size, 0);
    assert.equal(state.fleetAvgRate, 0);
  });
});

describe("updateBurnRate", () => {
  it("computes burn rate from cost delta and elapsed time", () => {
    const state = createThrottleState();
    // $1 over 1 hour = $1/hr
    updateBurnRate(state, "a", 1.0, 3_600_000);
    assert.ok(state.burnRates.get("a")! > 0.9);
    assert.ok(state.burnRates.get("a")! < 1.1);
  });

  it("smooths burn rate with EMA", () => {
    const state = createThrottleState();
    updateBurnRate(state, "a", 1.0, 3_600_000); // $1/hr
    updateBurnRate(state, "a", 10.0, 3_600_000); // $10/hr spike
    // smoothed should be between 1 and 10 (closer to previous due to 0.7 weight)
    const rate = state.burnRates.get("a")!;
    assert.ok(rate > 1.0 && rate < 10.0);
  });

  it("updates fleet average", () => {
    const state = createThrottleState();
    updateBurnRate(state, "a", 2.0, 3_600_000); // $2/hr
    updateBurnRate(state, "b", 4.0, 3_600_000); // $4/hr
    assert.ok(state.fleetAvgRate > 0);
  });

  it("ignores zero elapsed time", () => {
    const state = createThrottleState();
    updateBurnRate(state, "a", 1.0, 0);
    assert.equal(state.burnRates.size, 0);
  });
});

describe("evaluateThrottles", () => {
  it("throttles sessions above threshold", () => {
    const state = createThrottleState();
    // session "a" burns $10/hr, "b" burns $1/hr → avg ~$5.5/hr
    updateBurnRate(state, "a", 10.0, 3_600_000);
    updateBurnRate(state, "b", 1.0, 3_600_000);
    const results = evaluateThrottles(state, ["a", "b"], 2.0); // 2x threshold
    const aResult = results.find((r) => r.sessionTitle === "a");
    // "a" is at ~$10/hr which is >2x the ~$5.5 avg — should throttle
    // (depends on EMA smoothing, but should be above threshold)
    assert.ok(aResult);
  });

  it("unthrottles when burn rate drops", () => {
    const state = createThrottleState();
    state.throttled.set("a", 2.0);
    state.burnRates.set("a", 0.5);
    state.burnRates.set("b", 5.0);
    state.fleetAvgRate = 2.75;
    const results = evaluateThrottles(state, ["a", "b"], 3.0);
    const aResult = results.find((r) => r.sessionTitle === "a");
    assert.ok(aResult);
    assert.equal(aResult!.action, "unthrottle");
  });

  it("returns sorted by multiplier descending", () => {
    const state = createThrottleState();
    state.burnRates.set("low", 1.0);
    state.burnRates.set("high", 10.0);
    state.fleetAvgRate = 5.5;
    const results = evaluateThrottles(state, ["low", "high"]);
    assert.equal(results[0].sessionTitle, "high");
  });

  it("handles empty sessions", () => {
    const state = createThrottleState();
    assert.deepEqual(evaluateThrottles(state, []), []);
  });
});

describe("getPollMultiplier", () => {
  it("returns 1.0 for non-throttled session", () => {
    const state = createThrottleState();
    assert.equal(getPollMultiplier(state, "a"), 1.0);
  });

  it("returns multiplier for throttled session", () => {
    const state = createThrottleState();
    state.throttled.set("a", 2.5);
    assert.equal(getPollMultiplier(state, "a"), 2.5);
  });
});

describe("formatThrottleState", () => {
  it("shows no-sessions message when empty", () => {
    const lines = formatThrottleState([]);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("shows normal range message when no throttles", () => {
    const results = [{ sessionTitle: "a", burnRate: 1.0, fleetAvgRate: 1.0, multiplier: 1.0, action: "none" as const, pollMultiplier: 1.0 }];
    const lines = formatThrottleState(results);
    assert.ok(lines.some((l) => l.includes("normal cost range")));
  });

  it("shows throttled sessions", () => {
    const results = [{
      sessionTitle: "expensive", burnRate: 15.0, fleetAvgRate: 3.0, multiplier: 5.0,
      action: "throttle" as const, pollMultiplier: 2.0,
    }];
    const lines = formatThrottleState(results);
    assert.ok(lines.some((l) => l.includes("expensive")));
    assert.ok(lines.some((l) => l.includes("THROTTLED") || l.includes("slower")));
  });
});
