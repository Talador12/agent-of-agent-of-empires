import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildCostAttributions, computeCostReport, formatCostReport } from "./cost-attribution.js";
import type { TaskState } from "./types.js";

function makeTask(title: string, repo: string, status = "active", progressCount = 3): TaskState {
  return {
    repo, sessionTitle: title, sessionMode: "auto", tool: "opencode",
    goal: "test goal", status: status as any,
    progress: Array.from({ length: progressCount }, (_, i) => ({ at: Date.now(), summary: `step ${i}` })),
  };
}

describe("buildCostAttributions", () => {
  it("parses costs and computes efficiency", () => {
    const tasks = [makeTask("a", "repo/a", "active", 10)];
    const costs = new Map([["a", "$5.00"]]);
    const attrs = buildCostAttributions(tasks, costs);
    assert.equal(attrs.length, 1);
    assert.equal(attrs[0].costUsd, 5);
    assert.equal(attrs[0].costPerProgressEntry, 0.5); // $5 / 10 entries
    assert.equal(attrs[0].efficiency, "high"); // <= $0.50
  });

  it("handles missing cost data", () => {
    const tasks = [makeTask("a", "repo/a")];
    const attrs = buildCostAttributions(tasks, new Map());
    assert.equal(attrs[0].costUsd, 0);
  });

  it("classifies efficiency correctly", () => {
    const tasks = [
      makeTask("cheap", "r", "active", 10),
      makeTask("mid", "r", "active", 2),
      makeTask("expensive", "r", "active", 1),
    ];
    const costs = new Map([["cheap", "$1.00"], ["mid", "$3.00"], ["expensive", "$10.00"]]);
    const attrs = buildCostAttributions(tasks, costs);
    assert.equal(attrs.find((a) => a.sessionTitle === "cheap")?.efficiency, "high");
    assert.equal(attrs.find((a) => a.sessionTitle === "mid")?.efficiency, "medium");
    assert.equal(attrs.find((a) => a.sessionTitle === "expensive")?.efficiency, "low");
  });
});

describe("computeCostReport", () => {
  it("aggregates by repo", () => {
    const tasks = [makeTask("a", "repo/frontend"), makeTask("b", "repo/frontend"), makeTask("c", "repo/backend")];
    const costs = new Map([["a", "$2.00"], ["b", "$1.00"], ["c", "$8.00"]]);
    const attrs = buildCostAttributions(tasks, costs);
    const report = computeCostReport(attrs);
    assert.equal(report.byRepo.length, 2);
    assert.equal(report.byRepo[0].repo, "repo/backend"); // highest cost first
    assert.equal(report.byRepo[0].costUsd, 8);
  });

  it("aggregates by status", () => {
    const tasks = [makeTask("a", "r", "active"), makeTask("b", "r", "completed"), makeTask("c", "r", "active")];
    const costs = new Map([["a", "$1.00"], ["b", "$2.00"], ["c", "$3.00"]]);
    const report = computeCostReport(buildCostAttributions(tasks, costs));
    assert.ok(report.byStatus.length >= 1);
  });

  it("identifies top spenders", () => {
    const tasks = [makeTask("big", "r", "active", 1), makeTask("small", "r", "active", 10)];
    const costs = new Map([["big", "$100.00"], ["small", "$1.00"]]);
    const report = computeCostReport(buildCostAttributions(tasks, costs));
    assert.equal(report.topSpenders[0].sessionTitle, "big");
  });

  it("computes total cost", () => {
    const tasks = [makeTask("a", "r"), makeTask("b", "r")];
    const costs = new Map([["a", "$3.50"], ["b", "$6.50"]]);
    const report = computeCostReport(buildCostAttributions(tasks, costs));
    assert.equal(report.totalCostUsd, 10);
  });
});

describe("formatCostReport", () => {
  it("handles empty", () => {
    const lines = formatCostReport(computeCostReport([]));
    assert.ok(lines[0].includes("no cost attribution"));
  });

  it("formats populated report", () => {
    const tasks = [makeTask("a", "repo/a")];
    const costs = new Map([["a", "$5.00"]]);
    const report = computeCostReport(buildCostAttributions(tasks, costs));
    const lines = formatCostReport(report);
    assert.ok(lines.some((l) => l.includes("$5.00")));
    assert.ok(lines.some((l) => l.includes("repo/a")));
  });
});
