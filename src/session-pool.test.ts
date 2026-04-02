import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SessionPoolManager } from "./session-pool.js";
import type { TaskState } from "./types.js";

function makeTask(title: string, status: string, createdAt = Date.now()): TaskState {
  return { repo: "test", sessionTitle: title, sessionMode: "auto", tool: "opencode", goal: "test", status: status as any, progress: [], createdAt };
}

describe("SessionPoolManager", () => {
  it("reports correct pool status", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 3 });
    const tasks = [makeTask("a", "active"), makeTask("b", "active"), makeTask("c", "pending")];
    const status = pool.getStatus(tasks);
    assert.equal(status.activeCount, 2);
    assert.equal(status.pendingCount, 1);
    assert.equal(status.availableSlots, 1);
    assert.equal(status.atCapacity, false);
  });

  it("detects at capacity", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 2 });
    const tasks = [makeTask("a", "active"), makeTask("b", "active"), makeTask("c", "pending")];
    assert.equal(pool.shouldBlock(tasks), true);
  });

  it("returns activatable tasks ordered by createdAt", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 3 });
    const now = Date.now();
    const tasks = [
      makeTask("active-1", "active"),
      makeTask("old-pending", "pending", now - 60_000),
      makeTask("new-pending", "pending", now),
    ];
    const activatable = pool.getActivatable(tasks);
    assert.equal(activatable.length, 2); // 2 slots available
    assert.equal(activatable[0], "old-pending"); // older first
  });

  it("respects maxConcurrent limit for activation", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 2 });
    const tasks = [
      makeTask("a", "active"),
      makeTask("b", "active"),
      makeTask("c", "pending"),
    ];
    assert.deepEqual(pool.getActivatable(tasks), []); // at capacity
  });

  it("skips pending tasks with unmet dependencies", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 5 });
    const tasks = [
      { ...makeTask("blocked", "pending"), dependsOn: ["prereq"] },
      makeTask("free", "pending"),
    ];
    const activatable = pool.getActivatable(tasks);
    assert.deepEqual(activatable, ["free"]); // blocked is skipped
  });

  it("setMaxConcurrent updates the limit", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 2 });
    pool.setMaxConcurrent(5);
    const tasks = [makeTask("a", "active")];
    assert.equal(pool.getStatus(tasks).maxConcurrent, 5);
  });

  it("setMaxConcurrent clamps to minimum 1", () => {
    const pool = new SessionPoolManager();
    pool.setMaxConcurrent(0);
    const tasks: TaskState[] = [];
    assert.equal(pool.getStatus(tasks).maxConcurrent, 1);
  });

  it("formatStatus shows pool state", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 3 });
    const tasks = [makeTask("a", "active"), makeTask("b", "pending")];
    const lines = pool.formatStatus(tasks);
    assert.ok(lines.some((l) => l.includes("1/3 active")));
    assert.ok(lines.some((l) => l.includes("1 pending")));
  });

  it("formatStatus warns when at capacity", () => {
    const pool = new SessionPoolManager({ maxConcurrent: 1 });
    const tasks = [makeTask("a", "active"), makeTask("b", "pending")];
    const lines = pool.formatStatus(tasks);
    assert.ok(lines.some((l) => l.includes("At capacity")));
  });

  it("handles empty task list", () => {
    const pool = new SessionPoolManager();
    const status = pool.getStatus([]);
    assert.equal(status.activeCount, 0);
    assert.equal(status.availableSlots, 5);
  });
});
