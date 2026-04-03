import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { compareResults, ABReasoningTracker } from "./ab-reasoning.js";
import type { ReasonerResult } from "./types.js";

describe("compareResults", () => {
  it("prefers non-wait actions over wait", () => {
    const a: ReasonerResult = { actions: [{ action: "send_input", session: "x", text: "go" }] };
    const b: ReasonerResult = { actions: [{ action: "wait", reason: "idle" }] };
    const result = compareResults(a, b, "opencode", "claude-code");
    assert.equal(result.winner, "a");
  });

  it("prefers higher confidence", () => {
    const a: ReasonerResult = { actions: [{ action: "wait", reason: "ok" }], confidence: "high" };
    const b: ReasonerResult = { actions: [{ action: "wait", reason: "ok" }], confidence: "low" };
    const result = compareResults(a, b, "opencode", "claude-code");
    assert.equal(result.winner, "a");
  });

  it("returns tie when equal", () => {
    const a: ReasonerResult = { actions: [{ action: "wait", reason: "ok" }], confidence: "medium" };
    const b: ReasonerResult = { actions: [{ action: "wait", reason: "ok" }], confidence: "medium" };
    const result = compareResults(a, b, "opencode", "claude-code");
    assert.equal(result.winner, "tie");
  });

  it("prefers more non-wait actions (more decisive)", () => {
    const a: ReasonerResult = { actions: [{ action: "send_input", session: "x", text: "one" }, { action: "send_input", session: "y", text: "two" }] };
    const b: ReasonerResult = { actions: [{ action: "send_input", session: "x", text: "one" }] };
    const result = compareResults(a, b, "a", "b");
    // A has more non-wait actions (+2), B has fewer total (+1) → A wins net
    assert.equal(result.winner, "a");
  });
});

describe("ABReasoningTracker", () => {
  it("starts with no trials", () => {
    const tracker = new ABReasoningTracker("opencode", "claude-code");
    assert.equal(tracker.getStats().totalTrials, 0);
  });

  it("tracks wins correctly", () => {
    const tracker = new ABReasoningTracker("opencode", "claude-code");
    tracker.recordTrial({ timestamp: Date.now(), backendA: "opencode", backendB: "claude-code", actionsA: [], actionsB: [], winner: "a", reason: "test" });
    tracker.recordTrial({ timestamp: Date.now(), backendA: "opencode", backendB: "claude-code", actionsA: [], actionsB: [], winner: "b", reason: "test" });
    tracker.recordTrial({ timestamp: Date.now(), backendA: "opencode", backendB: "claude-code", actionsA: [], actionsB: [], winner: "a", reason: "test" });
    const stats = tracker.getStats();
    assert.equal(stats.winsA, 2);
    assert.equal(stats.winsB, 1);
    assert.equal(stats.totalTrials, 3);
  });

  it("formatStats shows winner", () => {
    const tracker = new ABReasoningTracker("opencode", "claude");
    tracker.recordTrial({ timestamp: Date.now(), backendA: "opencode", backendB: "claude", actionsA: [], actionsB: [], winner: "a", reason: "" });
    const lines = tracker.formatStats();
    assert.ok(lines.some((l) => l.includes("opencode") && l.includes("performing better")));
  });

  it("formatStats handles empty", () => {
    const tracker = new ABReasoningTracker("a", "b");
    const lines = tracker.formatStats();
    assert.ok(lines[0].includes("no A/B trials"));
  });
});
