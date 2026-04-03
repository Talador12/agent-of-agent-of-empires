import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildFleetSummary, formatFleetSummaryText, formatFleetSummaryTui } from "./fleet-summary-report.js";

describe("buildFleetSummary", () => {
  it("computes summary from sessions and tasks", () => {
    const sessions = [
      { id: "1", title: "a", tool: "opencode", status: "working" as const, costStr: "$5.00" },
      { id: "2", title: "b", tool: "opencode", status: "error" as const },
    ];
    const tasks = [
      { repo: "t", sessionTitle: "a", sessionMode: "auto" as const, tool: "opencode", goal: "g", status: "completed" as const, progress: [] },
      { repo: "t", sessionTitle: "b", sessionMode: "auto" as const, tool: "opencode", goal: "g", status: "failed" as const, progress: [] },
    ];
    const summary = buildFleetSummary(sessions, tasks);
    assert.equal(summary.totalSessions, 2);
    assert.equal(summary.activeSessions, 1);
    assert.equal(summary.completedTasks, 1);
    assert.equal(summary.failedTasks, 1);
    assert.equal(summary.totalCostUsd, 5);
    assert.ok(summary.topIssues.length > 0);
  });
});

describe("formatFleetSummaryText", () => {
  it("produces multi-line text", () => {
    const summary = buildFleetSummary(
      [{ id: "1", title: "a", tool: "opencode", status: "working" as const, costStr: "$3.00" }],
      [{ repo: "t", sessionTitle: "a", sessionMode: "auto" as const, tool: "opencode", goal: "g", status: "active" as const, progress: [] }],
    );
    const text = formatFleetSummaryText(summary);
    assert.ok(text.includes("Health"));
    assert.ok(text.includes("$3.00"));
    assert.ok(text.includes("No issues"));
  });
});

describe("formatFleetSummaryTui", () => {
  it("prefixes with spaces", () => {
    const summary = buildFleetSummary([], []);
    const lines = formatFleetSummaryTui(summary);
    assert.ok(lines.every((l) => l.startsWith("  ")));
  });
});
