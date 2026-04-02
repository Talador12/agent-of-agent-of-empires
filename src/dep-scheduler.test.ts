import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeSchedulingActions, getActivatableTasks, formatSchedulingActions } from "./dep-scheduler.js";
import type { TaskState } from "./types.js";

function makeTask(title: string, status: string, deps?: string[], createdAt = Date.now()): TaskState {
  return { repo: "test", sessionTitle: title, sessionMode: "auto", tool: "opencode", goal: "test", status: status as any, progress: [], dependsOn: deps, createdAt };
}

describe("computeSchedulingActions", () => {
  it("activates pending tasks with no deps", () => {
    const tasks = [makeTask("a", "pending"), makeTask("b", "active")];
    const actions = computeSchedulingActions(tasks, 3);
    assert.ok(actions.some((a) => a.sessionTitle === "a" && a.action === "activate"));
  });

  it("blocks tasks with unmet dependencies", () => {
    const tasks = [
      makeTask("prereq", "active"),
      makeTask("blocked", "pending", ["prereq"]),
    ];
    const actions = computeSchedulingActions(tasks, 5);
    assert.ok(actions.some((a) => a.sessionTitle === "blocked" && a.action === "block"));
  });

  it("activates tasks when dependencies are completed", () => {
    const tasks = [
      makeTask("prereq", "completed"),
      makeTask("ready", "pending", ["prereq"]),
    ];
    const actions = computeSchedulingActions(tasks, 5);
    assert.ok(actions.some((a) => a.sessionTitle === "ready" && a.action === "activate"));
  });

  it("skips tasks when pool is at capacity", () => {
    const tasks = [
      makeTask("a1", "active"),
      makeTask("a2", "active"),
      makeTask("waiting", "pending"),
    ];
    const actions = computeSchedulingActions(tasks, 2);
    assert.ok(actions.some((a) => a.sessionTitle === "waiting" && a.action === "skip"));
  });

  it("activates oldest pending first", () => {
    const now = Date.now();
    const tasks = [
      makeTask("newer", "pending", undefined, now),
      makeTask("older", "pending", undefined, now - 60_000),
    ];
    const actions = computeSchedulingActions(tasks, 1);
    const activations = actions.filter((a) => a.action === "activate");
    assert.equal(activations.length, 1);
    assert.equal(activations[0].sessionTitle, "older");
  });

  it("handles multi-dep chains", () => {
    const tasks = [
      makeTask("step1", "completed"),
      makeTask("step2", "completed"),
      makeTask("step3", "pending", ["step1", "step2"]),
    ];
    const actions = computeSchedulingActions(tasks, 5);
    assert.ok(actions.some((a) => a.sessionTitle === "step3" && a.action === "activate"));
  });

  it("blocks when only some deps are met", () => {
    const tasks = [
      makeTask("step1", "completed"),
      makeTask("step2", "active"),
      makeTask("step3", "pending", ["step1", "step2"]),
    ];
    const actions = computeSchedulingActions(tasks, 5);
    assert.ok(actions.some((a) => a.sessionTitle === "step3" && a.action === "block"));
  });
});

describe("getActivatableTasks", () => {
  it("returns only activatable titles", () => {
    const tasks = [
      makeTask("ready", "pending"),
      makeTask("blocked", "pending", ["prereq"]),
      makeTask("active", "active"),
    ];
    const titles = getActivatableTasks(tasks, 5);
    assert.deepEqual(titles, ["ready"]);
  });
});

describe("formatSchedulingActions", () => {
  it("shows no-tasks message for empty", () => {
    const lines = formatSchedulingActions([]);
    assert.ok(lines[0].includes("no pending"));
  });

  it("formats actions with icons", () => {
    const actions = [
      { sessionTitle: "go", action: "activate" as const, reason: "no deps" },
      { sessionTitle: "wait", action: "block" as const, reason: "waiting on: prereq" },
    ];
    const lines = formatSchedulingActions(actions);
    assert.ok(lines.some((l) => l.includes("▶") && l.includes("go")));
    assert.ok(lines.some((l) => l.includes("⏳") && l.includes("wait")));
  });
});
