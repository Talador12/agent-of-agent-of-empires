import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createCanaryState, startCanary, recordCanaryHealth,
  evaluateCanary, promoteCanary, rollbackCanary, formatCanaryState,
} from "./daemon-canary-mode.js";

describe("createCanaryState", () => {
  it("starts inactive", () => {
    const state = createCanaryState();
    assert.equal(state.canary, null);
    assert.equal(state.status, "rolled-back");
  });
});

describe("startCanary", () => {
  it("activates a canary", () => {
    const state = createCanaryState();
    startCanary(state, "alpha", { verbose: true }, 80, 2.0, 60_000, 1000);
    assert.ok(state.canary);
    assert.equal(state.canary!.sessionTitle, "alpha");
    assert.equal(state.status, "active");
    assert.equal(state.baselineHealth, 80);
  });
});

describe("recordCanaryHealth", () => {
  it("records health samples", () => {
    const state = createCanaryState();
    startCanary(state, "alpha", {}, 80, 2.0);
    recordCanaryHealth(state, 85, 2.5);
    recordCanaryHealth(state, 90, 2.5);
    assert.equal(state.healthSamples.length, 2);
  });

  it("ignores when no active canary", () => {
    const state = createCanaryState();
    recordCanaryHealth(state, 85, 2.5);
    assert.equal(state.healthSamples.length, 0);
  });

  it("clamps health to 0-100", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0);
    recordCanaryHealth(state, 150, 1.0);
    recordCanaryHealth(state, -10, 1.0);
    assert.equal(state.healthSamples[0], 100);
    assert.equal(state.healthSamples[1], 0);
  });
});

describe("evaluateCanary", () => {
  it("recommends continue with insufficient data", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0, 60_000, 1000);
    recordCanaryHealth(state, 85, 2.0);
    const result = evaluateCanary(state, 5000);
    assert.equal(result.recommendation, "continue");
  });

  it("recommends rollback when health degraded", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0, 60_000, 1000);
    recordCanaryHealth(state, 30, 2.0);
    recordCanaryHealth(state, 35, 2.0);
    recordCanaryHealth(state, 25, 2.0);
    const result = evaluateCanary(state, 5000);
    assert.equal(result.recommendation, "rollback");
  });

  it("recommends rollback when cost too high", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0, 60_000, 1000);
    recordCanaryHealth(state, 80, 5.0);
    recordCanaryHealth(state, 80, 5.0);
    recordCanaryHealth(state, 80, 5.0);
    const result = evaluateCanary(state, 5000);
    assert.equal(result.recommendation, "rollback");
  });

  it("recommends promote when duration complete and healthy", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0, 5000, 1000);
    recordCanaryHealth(state, 85, 2.0);
    recordCanaryHealth(state, 90, 2.0);
    recordCanaryHealth(state, 88, 2.0);
    const result = evaluateCanary(state, 10_000); // past duration
    assert.equal(result.recommendation, "promote");
  });

  it("recommends continue when not yet complete", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0, 60_000, 1000);
    recordCanaryHealth(state, 85, 2.0);
    recordCanaryHealth(state, 90, 2.0);
    recordCanaryHealth(state, 88, 2.0);
    const result = evaluateCanary(state, 5000); // not past duration
    assert.equal(result.recommendation, "continue");
  });
});

describe("promoteCanary", () => {
  it("returns overrides on promote", () => {
    const state = createCanaryState();
    startCanary(state, "a", { verbose: true, pollIntervalMs: 3000 }, 80, 2.0);
    const overrides = promoteCanary(state);
    assert.ok(overrides);
    assert.equal(overrides!.verbose, true);
    assert.equal(state.status, "promoted");
  });

  it("returns null with no canary", () => {
    const state = createCanaryState();
    assert.equal(promoteCanary(state), null);
  });
});

describe("rollbackCanary", () => {
  it("clears canary state", () => {
    const state = createCanaryState();
    startCanary(state, "a", {}, 80, 2.0);
    rollbackCanary(state);
    assert.equal(state.canary, null);
    assert.equal(state.status, "rolled-back");
    assert.equal(state.healthSamples.length, 0);
  });
});

describe("formatCanaryState", () => {
  it("shows inactive message when no canary", () => {
    const state = createCanaryState();
    const lines = formatCanaryState(state);
    assert.ok(lines[0].includes("inactive"));
  });

  it("shows active canary details", () => {
    const state = createCanaryState();
    startCanary(state, "alpha", { verbose: true }, 80, 2.0, 60_000);
    recordCanaryHealth(state, 85, 2.5);
    const lines = formatCanaryState(state);
    assert.ok(lines[0].includes("alpha"));
    assert.ok(lines.some((l) => l.includes("Health")));
    assert.ok(lines.some((l) => l.includes("Recommendation")));
  });
});
