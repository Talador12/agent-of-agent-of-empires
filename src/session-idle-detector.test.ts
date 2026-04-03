import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createIdleDetector,
  recordActivity,
  removeSession,
  detectIdleSessions,
  formatIdleAlerts,
} from "./session-idle-detector.js";

describe("createIdleDetector", () => {
  it("returns empty state", () => {
    const state = createIdleDetector();
    assert.equal(state.lastActivityMap.size, 0);
    assert.equal(state.alertedSessions.size, 0);
  });
});

describe("recordActivity", () => {
  it("records timestamp for session", () => {
    const state = createIdleDetector();
    recordActivity(state, "adventure", 1000);
    assert.equal(state.lastActivityMap.get("adventure"), 1000);
  });
  it("clears alert flag on activity", () => {
    const state = createIdleDetector();
    state.alertedSessions.add("adventure");
    recordActivity(state, "adventure", 2000);
    assert.ok(!state.alertedSessions.has("adventure"));
  });
});

describe("removeSession", () => {
  it("cleans up all tracking data", () => {
    const state = createIdleDetector();
    recordActivity(state, "adventure", 1000);
    state.alertedSessions.add("adventure");
    removeSession(state, "adventure");
    assert.ok(!state.lastActivityMap.has("adventure"));
    assert.ok(!state.alertedSessions.has("adventure"));
  });
});

describe("detectIdleSessions", () => {
  it("returns empty for active sessions", () => {
    const state = createIdleDetector();
    const now = 10_000;
    recordActivity(state, "a", now - 1000); // 1s ago
    const idles = detectIdleSessions(state, ["a"], 5000, now);
    assert.equal(idles.length, 0);
  });

  it("detects nudge-level idle", () => {
    const state = createIdleDetector();
    const now = 400_000;
    recordActivity(state, "a", now - 6000); // 6s ago
    const idles = detectIdleSessions(state, ["a"], 5000, now);
    assert.equal(idles.length, 1);
    assert.equal(idles[0].recommendation, "nudge");
  });

  it("detects pause-level idle (2x threshold)", () => {
    const state = createIdleDetector();
    const now = 400_000;
    recordActivity(state, "a", now - 12_000); // 12s > 10s = 2x5s
    const idles = detectIdleSessions(state, ["a"], 5000, now);
    assert.equal(idles.length, 1);
    assert.equal(idles[0].recommendation, "pause");
  });

  it("detects reclaim-level idle (3x threshold)", () => {
    const state = createIdleDetector();
    const now = 400_000;
    recordActivity(state, "a", now - 20_000); // 20s > 15s = 3x5s
    const idles = detectIdleSessions(state, ["a"], 5000, now);
    assert.equal(idles.length, 1);
    assert.equal(idles[0].recommendation, "reclaim");
  });

  it("starts tracking new sessions without flagging them", () => {
    const state = createIdleDetector();
    const idles = detectIdleSessions(state, ["new-session"], 5000, 10_000);
    assert.equal(idles.length, 0);
    assert.ok(state.lastActivityMap.has("new-session"));
  });

  it("sorts by longest idle first", () => {
    const state = createIdleDetector();
    const now = 400_000;
    recordActivity(state, "a", now - 6000);
    recordActivity(state, "b", now - 20_000);
    const idles = detectIdleSessions(state, ["a", "b"], 5000, now);
    assert.equal(idles[0].sessionTitle, "b");
    assert.equal(idles[1].sessionTitle, "a");
  });
});

describe("formatIdleAlerts", () => {
  it("shows all-active message when no idles", () => {
    const lines = formatIdleAlerts([]);
    assert.ok(lines[0].includes("all sessions active"));
  });
  it("shows idle sessions with icons", () => {
    const lines = formatIdleAlerts([{
      sessionTitle: "test", idleDurationMs: 600_000, lastActivityAt: 0, recommendation: "pause",
    }]);
    assert.ok(lines.some((l) => l.includes("test")));
    assert.ok(lines.some((l) => l.includes("10m")));
    assert.ok(lines.some((l) => l.includes("pause")));
  });
});
