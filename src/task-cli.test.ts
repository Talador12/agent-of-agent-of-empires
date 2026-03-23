import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTask, handleTaskSlashCommand } from "./task-cli.js";
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
});
