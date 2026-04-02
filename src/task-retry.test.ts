import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { TaskRetryManager, computeRetryDelayDeterministic } from "./task-retry.js";

describe("computeRetryDelayDeterministic", () => {
  it("doubles delay with each attempt", () => {
    const config = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 };
    assert.equal(computeRetryDelayDeterministic(0, config), 1000);
    assert.equal(computeRetryDelayDeterministic(1, config), 2000);
    assert.equal(computeRetryDelayDeterministic(2, config), 4000);
    assert.equal(computeRetryDelayDeterministic(3, config), 8000);
  });

  it("caps at maxDelay", () => {
    const config = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 5000, jitterFraction: 0 };
    assert.equal(computeRetryDelayDeterministic(0, config), 1000);
    assert.equal(computeRetryDelayDeterministic(10, config), 5000); // capped
  });
});

describe("TaskRetryManager", () => {
  it("starts with no retries", () => {
    const manager = new TaskRetryManager();
    assert.equal(manager.getAllStates().length, 0);
  });

  it("records first failure and schedules retry", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 });
    const now = Date.now();
    const state = manager.recordFailure("test", now);
    assert.equal(state.retryCount, 1);
    assert.equal(state.exhausted, false);
    assert.ok(state.nextRetryAt > now);
  });

  it("increments retry count on subsequent failures", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 });
    manager.recordFailure("test");
    const state2 = manager.recordFailure("test");
    assert.equal(state2.retryCount, 2);
    assert.equal(state2.exhausted, false);
  });

  it("marks exhausted after max retries", () => {
    const manager = new TaskRetryManager({ maxRetries: 2, baseDelayMs: 100, maxDelayMs: 1000, jitterFraction: 0 });
    manager.recordFailure("test");
    manager.recordFailure("test");
    const state3 = manager.recordFailure("test"); // 3rd failure, maxRetries=2
    assert.equal(state3.retryCount, 3);
    assert.equal(state3.exhausted, true);
  });

  it("isDueForRetry returns false before scheduled time", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 60_000, maxDelayMs: 600_000, jitterFraction: 0 });
    const now = Date.now();
    manager.recordFailure("test", now);
    assert.equal(manager.isDueForRetry("test", now), false); // delay hasn't elapsed
  });

  it("isDueForRetry returns true after scheduled time", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 });
    const now = Date.now();
    manager.recordFailure("test", now);
    assert.equal(manager.isDueForRetry("test", now + 2000), true); // 2s > 1s delay
  });

  it("isDueForRetry returns false for exhausted tasks", () => {
    const manager = new TaskRetryManager({ maxRetries: 1, baseDelayMs: 100, maxDelayMs: 1000, jitterFraction: 0 });
    const now = Date.now();
    manager.recordFailure("test", now);
    manager.recordFailure("test", now); // exhausted
    assert.equal(manager.isDueForRetry("test", now + 100_000), false);
  });

  it("getDueRetries returns only eligible tasks", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 });
    const now = Date.now();
    manager.recordFailure("ready", now - 60_000); // failed long ago, delay passed
    manager.recordFailure("not-ready", now); // just failed, delay not elapsed

    const due = manager.getDueRetries(now + 500); // 500ms after failures
    // "ready" should be due (failed 60s ago, delay is 1s)
    // "not-ready" should not (failed just now, delay is 1s)
    assert.ok(due.some((s) => s.sessionTitle === "ready"));
    assert.ok(!due.some((s) => s.sessionTitle === "not-ready"));
  });

  it("clearRetry removes retry state", () => {
    const manager = new TaskRetryManager();
    manager.recordFailure("test");
    assert.ok(manager.getState("test"));
    manager.clearRetry("test");
    assert.equal(manager.getState("test"), undefined);
  });

  it("formatRetries handles empty state", () => {
    const manager = new TaskRetryManager();
    const lines = manager.formatRetries();
    assert.ok(lines.some((l) => l.includes("no tasks pending")));
  });

  it("formatRetries shows retry info", () => {
    const manager = new TaskRetryManager({ maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000, jitterFraction: 0 });
    manager.recordFailure("adventure");
    const lines = manager.formatRetries();
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("1/3")));
  });
});
