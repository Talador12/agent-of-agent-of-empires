import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTask, handleTaskSlashCommand, parseTaskNewIntent, suggestNewTasks } from "./task-cli.js";
import type { TaskState } from "./types.js";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "github/adventure",
    sessionTitle: "adventure",
    sessionMode: "auto",
    tool: "opencode",
    goal: "Build the game",
    status: "active",
    sessionId: "a1b2c3d4-full-id",
    createdAt: Date.now(),
    progress: [],
    ...overrides,
  };
}

describe("resolveTask", () => {
  const tasks = [
    makeTask({ repo: "github/adventure", sessionTitle: "adventure", sessionId: "a1b2c3d4" }),
    makeTask({ repo: "github/cloudchamber", sessionTitle: "cloudchamber", sessionId: "e5f6g7h8" }),
    makeTask({ repo: "cc/aoaoe", sessionTitle: "agent-of-agent-of-empires", sessionId: "99887766" }),
  ];

  it("matches by exact session title", () => {
    const result = resolveTask("adventure", tasks);
    assert.equal(result?.sessionTitle, "adventure");
  });

  it("matches case-insensitively", () => {
    const result = resolveTask("Adventure", tasks);
    assert.equal(result?.sessionTitle, "adventure");
  });

  it("matches by repo basename", () => {
    const result = resolveTask("cloudchamber", tasks);
    assert.equal(result?.sessionTitle, "cloudchamber");
  });

  it("matches by session ID prefix", () => {
    const result = resolveTask("99887766", tasks);
    assert.equal(result?.sessionTitle, "agent-of-agent-of-empires");
  });

  it("matches by partial title (substring)", () => {
    const result = resolveTask("agent-of", tasks);
    assert.equal(result?.sessionTitle, "agent-of-agent-of-empires");
  });

  it("returns undefined for no match", () => {
    const result = resolveTask("nonexistent", tasks);
    assert.equal(result, undefined);
  });

  it("prefers exact title over substring", () => {
    const tasks2 = [
      makeTask({ sessionTitle: "app", sessionId: "111" }),
      makeTask({ sessionTitle: "my-app", sessionId: "222", repo: "foo/my-app" }),
    ];
    const result = resolveTask("app", tasks2);
    assert.equal(result?.sessionTitle, "app");
  });
});

describe("handleTaskSlashCommand", () => {
  it("returns usage hint for unknown subcommand", async () => {
    const result = await handleTaskSlashCommand("bogus");
    assert.ok(result.includes("usage"));
  });

  it("returns task list for empty input", async () => {
    const result = await handleTaskSlashCommand("");
    // either shows tasks or "(no tasks)"
    assert.ok(typeof result === "string");
  });

  it("returns task list for 'list'", async () => {
    const result = await handleTaskSlashCommand("list");
    assert.ok(typeof result === "string");
  });

  it("returns command help for 'help'", async () => {
    const result = await handleTaskSlashCommand("help");
    assert.ok(result.includes("/task reconcile"));
    assert.ok(result.includes("step-in quick path"));
  });
});

// ── parseTaskNewIntent ──────────────────────────────────────────────────────

describe("parseTaskNewIntent", () => {
  it("returns null for empty input", () => {
    assert.equal(parseTaskNewIntent(""), null);
  });

  it("parses title only", () => {
    const r = parseTaskNewIntent("myproject");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, null);
    assert.equal(r.tool, "opencode");
    assert.equal(r.goal, null);
  });

  it("parses title + path", () => {
    const r = parseTaskNewIntent("myproject /repos/myproject");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, "/repos/myproject");
    assert.equal(r.tool, "opencode");
  });

  it("parses title + path + tool", () => {
    const r = parseTaskNewIntent("myproject /repos/myproject claude-code");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, "/repos/myproject");
    assert.equal(r.tool, "claude-code");
  });

  it("parses with inline goal via ::", () => {
    const r = parseTaskNewIntent("myproject :: implement login");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.goal, "implement login");
  });

  it("parses title + path + goal", () => {
    const r = parseTaskNewIntent("myproject /repos/proj :: fix tests");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, "/repos/proj");
    assert.equal(r.goal, "fix tests");
  });

  it("skips leading 'new' keyword", () => {
    const r = parseTaskNewIntent("new myproject /repos/proj");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, "/repos/proj");
  });

  it("detects tool name in path position", () => {
    const r = parseTaskNewIntent("myproject claude-code");
    assert.ok(r);
    assert.equal(r.title, "myproject");
    assert.equal(r.path, null);
    assert.equal(r.tool, "claude-code");
  });

  it("returns null for just 'new' with no title", () => {
    assert.equal(parseTaskNewIntent("new"), null);
  });

  it("sets mode to auto", () => {
    const r = parseTaskNewIntent("myproject");
    assert.ok(r);
    assert.equal(r.mode, "auto");
  });

  it("handles empty goal after ::", () => {
    const r = parseTaskNewIntent("myproject ::");
    assert.ok(r);
    assert.equal(r.goal, null);
  });
});

// ── suggestNewTasks ─────────────────────────────────────────────────────────

describe("suggestNewTasks", () => {
  const sessions = [
    { title: "Alpha", id: "s1", tool: "opencode", path: "/repos/alpha" },
    { title: "Bravo", id: "s2", tool: "opencode", path: "/repos/bravo" },
    { title: "Charlie", id: "s3", tool: "claude-code" },
  ];

  it("returns all sessions when no tasks exist", () => {
    const suggestions = suggestNewTasks(sessions, []);
    assert.equal(suggestions.length, 3);
  });

  it("filters out sessions that already have tasks", () => {
    const tasks: TaskState[] = [makeTask({ sessionTitle: "Alpha" })];
    const suggestions = suggestNewTasks(sessions, tasks);
    assert.equal(suggestions.length, 2);
    assert.ok(!suggestions.some((s) => s.title === "Alpha"));
  });

  it("matches case-insensitively", () => {
    const tasks: TaskState[] = [makeTask({ sessionTitle: "BRAVO" })];
    const suggestions = suggestNewTasks(sessions, tasks);
    assert.ok(!suggestions.some((s) => s.title === "Bravo"));
  });

  it("returns empty when all sessions tracked", () => {
    const tasks: TaskState[] = sessions.map((s) =>
      makeTask({ sessionTitle: s.title })
    );
    const suggestions = suggestNewTasks(sessions, tasks);
    assert.equal(suggestions.length, 0);
  });

  it("returns empty for empty sessions list", () => {
    assert.deepEqual(suggestNewTasks([], []), []);
  });

  it("includes tool and path from session", () => {
    const suggestions = suggestNewTasks(sessions.slice(2), []);
    assert.equal(suggestions[0].tool, "claude-code");
    assert.equal(suggestions[0].path, undefined);
  });
});
