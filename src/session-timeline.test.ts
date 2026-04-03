import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildTimeline, formatTimeline } from "./session-timeline.js";
import type { TaskState } from "./types.js";

describe("buildTimeline", () => {
  it("builds from task progress", () => {
    const now = Date.now();
    const task: TaskState = {
      repo: "t", sessionTitle: "test", sessionMode: "auto", tool: "opencode",
      goal: "g", status: "active", createdAt: now - 3_600_000,
      progress: [
        { at: now - 2_400_000, summary: "started implementation" },
        { at: now - 1_200_000, summary: "added tests" },
        { at: now, summary: "pushed to main" },
      ],
    };
    const events = buildTimeline(task);
    assert.equal(events.length, 4); // created + 3 progress
    assert.equal(events[0].category, "milestone"); // created
    assert.equal(events[1].category, "progress");
  });

  it("includes completion event", () => {
    const now = Date.now();
    const task: TaskState = {
      repo: "t", sessionTitle: "done", sessionMode: "auto", tool: "opencode",
      goal: "g", status: "completed", createdAt: now - 7_200_000, completedAt: now,
      progress: [{ at: now - 3_600_000, summary: "work" }],
    };
    const events = buildTimeline(task);
    assert.ok(events.some((e) => e.category === "milestone" && e.text.includes("completed")));
  });

  it("handles empty progress", () => {
    const task: TaskState = { repo: "t", sessionTitle: "empty", sessionMode: "auto", tool: "opencode", goal: "g", status: "pending", progress: [] };
    assert.equal(buildTimeline(task).length, 0);
  });
});

describe("formatTimeline", () => {
  it("shows events with icons", () => {
    const now = Date.now();
    const task: TaskState = {
      repo: "t", sessionTitle: "test", sessionMode: "auto", tool: "opencode",
      goal: "g", status: "active", createdAt: now,
      progress: [{ at: now, summary: "did thing" }],
    };
    const events = buildTimeline(task);
    const lines = formatTimeline("test", events);
    assert.ok(lines[0].includes("test"));
    assert.ok(lines.some((l) => l.includes("★"))); // milestone
    assert.ok(lines.some((l) => l.includes("→"))); // progress
  });

  it("handles empty", () => {
    const lines = formatTimeline("empty", []);
    assert.ok(lines[0].includes("no timeline"));
  });
});
