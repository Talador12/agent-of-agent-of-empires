import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveTitle, formatAgo, formatTaskTable, formatProgressDigest, readNextRoadmapItems, taskStateKey, resolveTaskRepoPath, shouldReconcileTasks, injectGoalToSession, areDependenciesMet, findNewlyUnblockedTasks } from "./task-manager.js";
import { normalizeGoal, goalToList } from "./types.js";
import type { TaskState } from "./types.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── deriveTitle ─────────────────────────────────────────────────────────────

describe("deriveTitle", () => {
  it("extracts basename and lowercases", () => {
    assert.equal(deriveTitle("github/Adventure"), "adventure");
  });

  it("handles deeply nested paths", () => {
    assert.equal(deriveTitle("org/group/sub/my-project"), "my-project");
  });

  it("replaces special characters with dashes", () => {
    assert.equal(deriveTitle("My Cool Project!"), "my-cool-project-");
  });

  it("keeps hyphens and underscores", () => {
    assert.equal(deriveTitle("my_cool-repo"), "my_cool-repo");
  });

  it("handles bare name (no path separator)", () => {
    assert.equal(deriveTitle("adventure"), "adventure");
  });

  it("handles trailing slash", () => {
    // basename("foo/bar/") returns "" on some platforms, but Node returns "bar"
    // for "foo/bar/" — basename strips the trailing slash first
    const result = deriveTitle("foo/bar/");
    // Node basename("foo/bar/") = "bar"
    assert.equal(result, "bar");
  });
});

// ── taskStateKey ───────────────────────────────────────────────────────────

describe("taskStateKey", () => {
  it("includes repo and normalized title", () => {
    assert.equal(taskStateKey("/repos", "Cloud-Hypervisor"), "/repos::cloud-hypervisor");
  });

  it("distinguishes sessions sharing the same repo", () => {
    const a = taskStateKey("/repos", "cloud-hypervisor");
    const b = taskStateKey("/repos", "cloudchamber");
    assert.notEqual(a, b);
  });
});

// ── resolveTaskRepoPath ────────────────────────────────────────────────────

describe("resolveTaskRepoPath", () => {
  function makeTmpDir(): string {
    const dir = join(tmpdir(), `aoaoe-test-taskrepo-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function cleanup(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  it("resolves a matching project directory by session title", () => {
    const dir = makeTmpDir();
    try {
      const project = join(dir, "cloud-hypervisor");
      mkdirSync(project, { recursive: true });
      const resolved = resolveTaskRepoPath(process.cwd(), dir, "cloud-hypervisor");
      assert.equal(resolved, project);
    } finally { cleanup(dir); }
  });

  it("falls back to session root when no match exists", () => {
    const dir = makeTmpDir();
    try {
      const resolved = resolveTaskRepoPath(process.cwd(), dir, "does-not-exist");
      assert.equal(resolved, dir);
    } finally { cleanup(dir); }
  });
});

// ── shouldReconcileTasks ───────────────────────────────────────────────────

describe("shouldReconcileTasks", () => {
  it("runs on first poll", () => {
    assert.equal(shouldReconcileTasks(1), true);
  });

  it("runs every 6 polls by default", () => {
    assert.equal(shouldReconcileTasks(7), true);
    assert.equal(shouldReconcileTasks(13), true);
    assert.equal(shouldReconcileTasks(6), false);
  });

  it("supports custom cadence", () => {
    assert.equal(shouldReconcileTasks(5, 4), true);
    assert.equal(shouldReconcileTasks(4, 4), false);
  });

  it("returns false for invalid inputs", () => {
    assert.equal(shouldReconcileTasks(0), false);
    assert.equal(shouldReconcileTasks(1, 0), false);
  });
});

// ── formatAgo ───────────────────────────────────────────────────────────────

describe("formatAgo", () => {
  it("formats sub-minute as seconds", () => {
    assert.equal(formatAgo(5000), "5s ago");
    assert.equal(formatAgo(45_000), "45s ago");
  });

  it("formats minutes", () => {
    assert.equal(formatAgo(120_000), "2m ago");
    assert.equal(formatAgo(300_000), "5m ago");
  });

  it("formats hours", () => {
    assert.equal(formatAgo(3_600_000), "1h ago");
    assert.equal(formatAgo(7_200_000), "2h ago");
  });

  it("formats days", () => {
    assert.equal(formatAgo(86_400_000), "1d ago");
    assert.equal(formatAgo(172_800_000), "2d ago");
  });

  it("formats zero as 0s", () => {
    assert.equal(formatAgo(0), "0s ago");
  });
});

// ── formatTaskTable ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "github/test-project",
    sessionTitle: "test-project",
    sessionMode: "auto",
    tool: "opencode",
    goal: "Continue the roadmap",
    status: "pending",
    progress: [],
    ...overrides,
  };
}

describe("formatTaskTable", () => {
  it("returns placeholder for empty array", () => {
    const result = formatTaskTable([]);
    assert.ok(result.includes("no tasks defined"));
  });

  it("returns placeholder for empty map", () => {
    const result = formatTaskTable(new Map());
    assert.ok(result.includes("no tasks defined"));
  });

  it("renders a single pending task", () => {
    const result = formatTaskTable([makeTask()]);
    assert.ok(result.includes("github/test-project"));
    assert.ok(result.includes("pending"));
    assert.ok(result.includes("not started"));
  });

  it("renders an active task with progress", () => {
    const task = makeTask({
      status: "active",
      sessionId: "abcdef1234567890",
      progress: [{ at: Date.now() - 60_000, summary: "Fixed the bug" }],
    });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("active"));
    assert.ok(result.includes("abcdef12")); // first 8 chars of session ID
    assert.ok(result.includes("Fixed the bug"));
  });

  it("renders a completed task", () => {
    const task = makeTask({ status: "completed" });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("completed"));
  });

  it("truncates long repo names", () => {
    const task = makeTask({ repo: "very/deeply/nested/organization/project-name-that-is-very-long" });
    const result = formatTaskTable([task]);
    // repo column is max 27 chars, should truncate from the left
    assert.ok(result.includes("project-name-that-is-very-long".slice(-27)));
  });

  it("truncates long progress summaries", () => {
    const task = makeTask({
      status: "active",
      progress: [{ at: Date.now(), summary: "A".repeat(60) }],
    });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("..."));
  });

  it("shows goal as bulleted list for active and pending tasks", () => {
    const result = formatTaskTable([makeTask({ status: "active", goal: "Build the thing" })]);
    assert.ok(result.includes("goal:"));
    assert.ok(result.includes("- Build the thing"));
  });

  it("accepts a Map as input", () => {
    const map = new Map<string, TaskState>();
    map.set("github/foo", makeTask({ repo: "github/foo" }));
    const result = formatTaskTable(map);
    assert.ok(result.includes("github/foo"));
  });

  it("renders header with REPO STATUS MODE PROFILE SESSION PROGRESS", () => {
    const result = formatTaskTable([makeTask()]);
    assert.ok(result.includes("REPO"));
    assert.ok(result.includes("STATUS"));
    assert.ok(result.includes("MODE"));
    assert.ok(result.includes("PROFILE"));
    assert.ok(result.includes("SESSION"));
    assert.ok(result.includes("PROGRESS"));
  });

  it("shows context line with session title and repo", () => {
    const result = formatTaskTable([makeTask({ sessionTitle: "adventure", repo: "github/adventure" })]);
    assert.ok(result.includes("context: adventure @ github/adventure [default]"));
  });

  it("shows task profile in context line", () => {
    const result = formatTaskTable([makeTask({ profile: "work" })]);
    assert.ok(result.includes("[work]"));
  });

  it("shows single-item goal as a bullet", () => {
    const result = formatTaskTable([makeTask({ goal: "do the thing" })]);
    assert.ok(result.includes("goal:"));
    assert.ok(result.includes("- do the thing"));
    // must NOT show flat "goal: do the thing" (no colon-on-same-line)
    assert.ok(!result.includes("goal: do the thing"));
  });

  it("shows multi-item goal as bullet list", () => {
    const goal = "- item one\n- item two\n- item three";
    const result = formatTaskTable([makeTask({ goal })]);
    assert.ok(result.includes("goal:"));
    assert.ok(result.includes("item one"));
    assert.ok(result.includes("item two"));
    assert.ok(result.includes("item three"));
  });
});

// ── normalizeGoal ────────────────────────────────────────────────────────────

describe("normalizeGoal", () => {
  it("returns fallback for undefined", () => {
    assert.equal(normalizeGoal(undefined), "Continue the roadmap in claude.md");
  });

  it("returns custom fallback for undefined", () => {
    assert.equal(normalizeGoal(undefined, "custom fallback"), "custom fallback");
  });

  it("returns string as-is", () => {
    assert.equal(normalizeGoal("do the thing"), "do the thing");
  });

  it("trims whitespace from string", () => {
    assert.equal(normalizeGoal("  trim me  "), "trim me");
  });

  it("returns fallback for empty string", () => {
    assert.equal(normalizeGoal(""), "Continue the roadmap in claude.md");
  });

  it("returns fallback for whitespace-only string", () => {
    assert.equal(normalizeGoal("   "), "Continue the roadmap in claude.md");
  });

  it("single-item array returns item without bullet", () => {
    assert.equal(normalizeGoal(["do the thing"]), "do the thing");
  });

  it("multi-item array joins with bullet prefix", () => {
    const result = normalizeGoal(["first", "second", "third"]);
    assert.equal(result, "- first\n- second\n- third");
  });

  it("trims items and filters empty strings in array", () => {
    const result = normalizeGoal(["  first  ", "", "  third  "]);
    assert.equal(result, "- first\n- third");
  });

  it("returns fallback for empty array", () => {
    assert.equal(normalizeGoal([]), "Continue the roadmap in claude.md");
  });

  it("returns fallback for array of only empty strings", () => {
    assert.equal(normalizeGoal(["", "  "]), "Continue the roadmap in claude.md");
  });
});

// ── goalToList ───────────────────────────────────────────────────────────────

describe("goalToList", () => {
  it("wraps plain string in 1-element array", () => {
    assert.deepEqual(goalToList("do the thing"), ["do the thing"]);
  });

  it("splits bullet lines into array", () => {
    const goal = "- first\n- second\n- third";
    assert.deepEqual(goalToList(goal), ["first", "second", "third"]);
  });

  it("strips leading dash and whitespace", () => {
    assert.deepEqual(goalToList("- item one"), ["item one"]);
  });

  it("handles mixed lines (some with dash, some without)", () => {
    const goal = "- first\nsecond (no dash)";
    assert.deepEqual(goalToList(goal), ["first", "second (no dash)"]);
  });

  it("filters empty lines", () => {
    const goal = "- first\n\n- third";
    assert.deepEqual(goalToList(goal), ["first", "third"]);
  });

  it("round-trips through normalizeGoal for multi-item", () => {
    const original = ["step one", "step two", "step three"];
    const normalized = normalizeGoal(original);
    const restored = goalToList(normalized);
    assert.deepEqual(restored, original);
  });

  it("round-trips through normalizeGoal for single item", () => {
    const normalized = normalizeGoal(["only step"]);
    const restored = goalToList(normalized);
    assert.deepEqual(restored, ["only step"]);
  });
});

// ── readNextRoadmapItems ──────────────────────────────────────────────────────

describe("readNextRoadmapItems", () => {
  function makeTmpDir(): string {
    const dir = join(tmpdir(), `aoaoe-test-roadmap-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function cleanup(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  it("returns fallback when no claude.md exists", () => {
    const dir = makeTmpDir();
    try {
      const result = readNextRoadmapItems(dir);
      assert.ok(result.includes("roadmap"), `expected roadmap fallback, got: ${result}`);
    } finally { cleanup(dir); }
  });

  it("extracts items from Ideas Backlog section", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "claude.md"), [
        "# Status",
        "",
        "### Ideas Backlog",
        "- **Feature A** — do something cool",
        "- **Feature B** — another thing",
        "- **Feature C** — yet another",
        "",
        "### Shipped",
      ].join("\n"));
      const result = readNextRoadmapItems(dir, 2);
      assert.ok(result.includes("Feature A"), `should include Feature A, got: ${result}`);
      assert.ok(result.includes("Feature B"), `should include Feature B, got: ${result}`);
      assert.ok(!result.includes("Feature C"), `should not include Feature C (maxItems=2), got: ${result}`);
    } finally { cleanup(dir); }
  });

  it("falls back when backlog section is empty", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "claude.md"), "### Ideas Backlog\n\n### Shipped\n");
      const result = readNextRoadmapItems(dir);
      assert.ok(result.includes("roadmap"), `expected fallback when empty, got: ${result}`);
    } finally { cleanup(dir); }
  });

  it("handles items without description", () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, "claude.md"), "### Ideas Backlog\n- **Feature X**\n");
      const result = readNextRoadmapItems(dir, 1);
      assert.ok(result.includes("Feature X"), `should include Feature X, got: ${result}`);
    } finally { cleanup(dir); }
  });
});

// ── injectGoalToSession ────────────────────────────────────────────────────

describe("injectGoalToSession", () => {
  it("returns false for empty goal", async () => {
    const ok = await injectGoalToSession("abc12345", "test-session", "");
    assert.equal(ok, false);
  });

  it("returns false for whitespace-only goal", async () => {
    const ok = await injectGoalToSession("abc12345", "test-session", "   ");
    assert.equal(ok, false);
  });
});

// ── areDependenciesMet ─────────────────────────────────────────────────────

describe("areDependenciesMet", () => {
  it("returns true when no dependencies", () => {
    const task = makeTask({ dependsOn: undefined });
    assert.equal(areDependenciesMet(task, []), true);
  });

  it("returns true when empty deps array", () => {
    const task = makeTask({ dependsOn: [] });
    assert.equal(areDependenciesMet(task, []), true);
  });

  it("returns true when all deps completed", () => {
    const task = makeTask({ dependsOn: ["dep-a", "dep-b"] });
    const allTasks = [
      task,
      makeTask({ sessionTitle: "dep-a", status: "completed" }),
      makeTask({ sessionTitle: "dep-b", status: "completed" }),
    ];
    assert.equal(areDependenciesMet(task, allTasks), true);
  });

  it("returns false when a dep is still active", () => {
    const task = makeTask({ dependsOn: ["dep-a"] });
    const allTasks = [
      task,
      makeTask({ sessionTitle: "dep-a", status: "active" }),
    ];
    assert.equal(areDependenciesMet(task, allTasks), false);
  });

  it("returns false when a dep doesn't exist", () => {
    const task = makeTask({ dependsOn: ["nonexistent"] });
    assert.equal(areDependenciesMet(task, [task]), false);
  });

  it("matches dep titles case-insensitively", () => {
    const task = makeTask({ dependsOn: ["DEP-A"] });
    const allTasks = [
      task,
      makeTask({ sessionTitle: "dep-a", status: "completed" }),
    ];
    assert.equal(areDependenciesMet(task, allTasks), true);
  });
});

// ── findNewlyUnblockedTasks ────────────────────────────────────────────────

describe("findNewlyUnblockedTasks", () => {
  it("returns empty when no tasks depend on completed title", () => {
    const tasks = [
      makeTask({ sessionTitle: "a", status: "active" }),
      makeTask({ sessionTitle: "b", status: "pending" }),
    ];
    assert.deepEqual(findNewlyUnblockedTasks("c", tasks), []);
  });

  it("returns pending tasks whose deps are now fully met", () => {
    const tasks = [
      makeTask({ sessionTitle: "upstream", status: "completed" }),
      makeTask({ sessionTitle: "downstream", status: "pending", dependsOn: ["upstream"] }),
    ];
    const unblocked = findNewlyUnblockedTasks("upstream", tasks);
    assert.equal(unblocked.length, 1);
    assert.equal(unblocked[0].sessionTitle, "downstream");
  });

  it("does not return tasks with partially met deps", () => {
    const tasks = [
      makeTask({ sessionTitle: "a", status: "completed" }),
      makeTask({ sessionTitle: "b", status: "active" }),
      makeTask({ sessionTitle: "c", status: "pending", dependsOn: ["a", "b"] }),
    ];
    const unblocked = findNewlyUnblockedTasks("a", tasks);
    assert.equal(unblocked.length, 0);
  });

  it("does not return already-active tasks", () => {
    const tasks = [
      makeTask({ sessionTitle: "upstream", status: "completed" }),
      makeTask({ sessionTitle: "downstream", status: "active", dependsOn: ["upstream"] }),
    ];
    assert.deepEqual(findNewlyUnblockedTasks("upstream", tasks), []);
  });

  it("handles diamond dependencies correctly", () => {
    const tasks = [
      makeTask({ sessionTitle: "a", status: "completed" }),
      makeTask({ sessionTitle: "b", status: "completed" }),
      makeTask({ sessionTitle: "c", status: "pending", dependsOn: ["a", "b"] }),
    ];
    const unblocked = findNewlyUnblockedTasks("b", tasks);
    assert.equal(unblocked.length, 1);
    assert.equal(unblocked[0].sessionTitle, "c");
  });
});

// ── formatProgressDigest ───────────────────────────────────────────────────

describe("formatProgressDigest", () => {
  it("returns no-tasks message for empty array", () => {
    assert.ok(formatProgressDigest([]).includes("no tasks"));
  });

  it("shows session title and status for each task", () => {
    const result = formatProgressDigest([makeTask({ sessionTitle: "adventure", status: "active" })]);
    assert.ok(result.includes("adventure"));
    assert.ok(result.includes("active"));
  });

  it("shows recent progress entries within time window", () => {
    const result = formatProgressDigest([makeTask({
      progress: [{ at: Date.now() - 5 * 60_000, summary: "shipped auth feature" }],
    })], 60 * 60 * 1000);
    assert.ok(result.includes("shipped auth feature"));
  });

  it("filters out progress older than time window", () => {
    const result = formatProgressDigest([makeTask({
      progress: [{ at: Date.now() - 48 * 60 * 60_000, summary: "ancient progress" }],
    })], 24 * 60 * 60 * 1000);
    assert.ok(!result.includes("ancient progress"));
    assert.ok(result.includes("no progress in time window") || result.includes("no recent progress"));
  });

  it("shows dependency info", () => {
    const result = formatProgressDigest([makeTask({ dependsOn: ["upstream-task"] })]);
    assert.ok(result.includes("depends on: upstream-task"));
  });
});
