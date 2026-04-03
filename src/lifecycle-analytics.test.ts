import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildLifecycleRecords, computeLifecycleStats, formatLifecycleStats } from "./lifecycle-analytics.js";
import type { TaskState } from "./types.js";

function makeTask(title: string, status: string, created?: number, completed?: number, progressCount = 0): TaskState {
  return {
    repo: "test/" + title, sessionTitle: title, sessionMode: "auto", tool: "opencode",
    goal: "test goal", status: status as any, progress: Array.from({ length: progressCount }, (_, i) => ({ at: Date.now(), summary: `step ${i}` })),
    createdAt: created, completedAt: completed,
  };
}

describe("buildLifecycleRecords", () => {
  it("computes duration for completed tasks", () => {
    const tasks = [makeTask("a", "completed", 1000, 5000)];
    const records = buildLifecycleRecords(tasks);
    assert.equal(records[0].durationMs, 4000);
  });
  it("returns undefined duration for active tasks", () => {
    const records = buildLifecycleRecords([makeTask("a", "active", 1000)]);
    assert.equal(records[0].durationMs, undefined);
  });
});

describe("computeLifecycleStats", () => {
  it("handles empty input", () => {
    const stats = computeLifecycleStats([]);
    assert.equal(stats.totalTasks, 0);
  });

  it("computes stats for completed tasks", () => {
    const now = Date.now();
    const tasks = [
      makeTask("fast", "completed", now - 3_600_000, now - 3_000_000, 5), // 10min
      makeTask("slow", "completed", now - 7_200_000, now - 3_600_000, 3), // 1hr
      makeTask("active", "active", now - 60_000, undefined, 2),
      makeTask("failed", "failed", now - 120_000, undefined, 1),
    ];
    const records = buildLifecycleRecords(tasks);
    const stats = computeLifecycleStats(records);
    assert.equal(stats.totalTasks, 4);
    assert.equal(stats.completedTasks, 2);
    assert.equal(stats.failedTasks, 1);
    assert.equal(stats.activeTasks, 1);
    assert.ok(stats.avgDurationMs > 0);
    assert.ok(stats.successRate > 0.5);
  });

  it("identifies longest and fastest", () => {
    const now = Date.now();
    const tasks = [
      makeTask("quick", "completed", now - 60_000, now - 30_000), // 30s
      makeTask("long", "completed", now - 7_200_000, now), // 2hr
    ];
    const stats = computeLifecycleStats(buildLifecycleRecords(tasks));
    assert.equal(stats.longestTask?.title, "long");
    assert.equal(stats.fastestTask?.title, "quick");
  });

  it("computes success rate", () => {
    const now = Date.now();
    const tasks = [
      makeTask("ok1", "completed", now, now + 1000),
      makeTask("ok2", "completed", now, now + 1000),
      makeTask("bad", "failed", now),
    ];
    const stats = computeLifecycleStats(buildLifecycleRecords(tasks));
    assert.ok(Math.abs(stats.successRate - 0.667) < 0.01);
  });
});

describe("formatLifecycleStats", () => {
  it("handles empty stats", () => {
    const lines = formatLifecycleStats(computeLifecycleStats([]));
    assert.ok(lines[0].includes("no task lifecycle"));
  });

  it("formats populated stats", () => {
    const now = Date.now();
    const tasks = [makeTask("a", "completed", now - 3_600_000, now, 5)];
    const stats = computeLifecycleStats(buildLifecycleRecords(tasks));
    const lines = formatLifecycleStats(stats);
    assert.ok(lines.some((l) => l.includes("1 tasks")));
    assert.ok(lines.some((l) => l.includes("Success rate")));
  });
});
