import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildShiftHandoff, formatHandoffTui, formatHandoffMarkdown } from "./operator-shift-handoff.js";
import type { TaskState } from "./types.js";

function makeTasks(): TaskState[] {
  return [
    { repo: "github/adventure", sessionTitle: "adventure", profile: "default", sessionMode: "auto", tool: "opencode", goal: "Add dark mode", status: "active", progress: [{ at: 1000, summary: "started css changes" }] },
    { repo: "github/aoaoe", sessionTitle: "aoaoe", profile: "default", sessionMode: "auto", tool: "opencode", goal: "Fix bug", status: "completed", completedAt: 5000, progress: [{ at: 2000, summary: "done" }] },
    { repo: "github/api", sessionTitle: "api", profile: "default", sessionMode: "auto", tool: "opencode", goal: "Deploy v2", status: "failed", progress: [] },
  ];
}

describe("buildShiftHandoff", () => {
  it("produces valid handoff with mixed task states", () => {
    const tasks = makeTasks();
    const health = new Map([["adventure", 80], ["aoaoe", 100], ["api", 20]]);
    const costs = new Map([["adventure", 5.0], ["aoaoe", 2.0], ["api", 8.0]]);
    const handoff = buildShiftHandoff(tasks, health, costs, ["recent alert 1"], ["approve restart api"]);
    assert.equal(handoff.fleetSummary.totalSessions, 3);
    assert.equal(handoff.fleetSummary.activeSessions, 1);
    assert.equal(handoff.fleetSummary.completedSessions, 1);
    assert.ok(handoff.fleetSummary.totalCostUsd > 0);
    assert.equal(handoff.sessions.length, 3);
  });

  it("generates critical alert for failed tasks", () => {
    const tasks = makeTasks();
    const handoff = buildShiftHandoff(tasks, new Map(), new Map(), [], []);
    const criticals = handoff.alerts.filter((a) => a.severity === "critical");
    assert.ok(criticals.length > 0);
    assert.ok(criticals.some((a) => a.message.includes("api")));
  });

  it("generates recommendations for failed and paused tasks", () => {
    const tasks = makeTasks();
    const handoff = buildShiftHandoff(tasks, new Map(), new Map(), [], []);
    assert.ok(handoff.recommendations.some((r) => r.includes("failed")));
  });

  it("includes pending decisions", () => {
    const tasks = makeTasks();
    const handoff = buildShiftHandoff(tasks, new Map(), new Map(), [], ["approve X"]);
    assert.equal(handoff.pendingDecisions.length, 1);
    assert.ok(handoff.recommendations.some((r) => r.includes("approval")));
  });

  it("handles empty input gracefully", () => {
    const handoff = buildShiftHandoff([], new Map(), new Map(), [], []);
    assert.equal(handoff.fleetSummary.totalSessions, 0);
    assert.equal(handoff.sessions.length, 0);
  });

  it("flags low fleet health", () => {
    const tasks = makeTasks();
    const health = new Map([["adventure", 20], ["aoaoe", 30], ["api", 10]]);
    const handoff = buildShiftHandoff(tasks, health, new Map(), [], []);
    assert.ok(handoff.alerts.some((a) => a.message.includes("health")));
  });
});

describe("formatHandoffTui", () => {
  it("produces header with timestamp", () => {
    const handoff = buildShiftHandoff(makeTasks(), new Map(), new Map(), [], []);
    const lines = formatHandoffTui(handoff);
    assert.ok(lines[0].includes("Shift Handoff"));
  });

  it("lists sessions", () => {
    const handoff = buildShiftHandoff(makeTasks(), new Map(), new Map(), [], []);
    const lines = formatHandoffTui(handoff);
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("api")));
  });
});

describe("formatHandoffMarkdown", () => {
  it("produces markdown with header", () => {
    const handoff = buildShiftHandoff(makeTasks(), new Map(), new Map(), [], []);
    const md = formatHandoffMarkdown(handoff);
    assert.ok(md.startsWith("# Shift Handoff"));
    assert.ok(md.includes("Fleet:"));
  });

  it("includes alerts section when present", () => {
    const tasks = makeTasks();
    const handoff = buildShiftHandoff(tasks, new Map(), new Map(), [], []);
    const md = formatHandoffMarkdown(handoff);
    assert.ok(md.includes("## Alerts"));
  });
});
