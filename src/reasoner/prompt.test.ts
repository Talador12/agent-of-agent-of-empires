import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatObservation, detectPermissionPrompt, buildSystemPrompt, sliceToByteLimit, formatTaskContext } from "./prompt.js";
import type { Observation, SessionSnapshot, AoeSessionStatus, SessionChange, TaskState } from "../types.js";

// helper to build a minimal observation
function makeObs(overrides?: Partial<Observation>): Observation {
  return {
    timestamp: 1700000000000,
    sessions: [],
    changes: [],
    ...overrides,
  };
}

function makeSnap(id: string, title: string, tool = "opencode", status: AoeSessionStatus = "working", output = ""): SessionSnapshot {
  return {
    session: { id, title, path: "/tmp", tool, status, tmux_name: `aoe_${title}_${id.slice(0, 8)}` },
    output,
    outputHash: "abcd1234",
    capturedAt: 1700000000000,
  };
}

describe("formatObservation", () => {
  it("includes timestamp and session count", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "agent-1")] });
    const result = formatObservation(obs);
    assert.ok(result.includes("Observation at"));
    assert.ok(result.includes("Active sessions: 1"));
  });

  it("lists sessions with truncated IDs", () => {
    const obs = makeObs({
      sessions: [makeSnap("abcdef1234567890", "my-agent", "claude", "working")],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes('[abcdef12] "my-agent" tool=claude status=working'));
  });

  it("reports no changes when empty", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "a")] });
    const result = formatObservation(obs);
    assert.ok(result.includes("No new output from any session since last poll."));
  });

  it("shows change details", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      changes: [{
        sessionId: "abc12345",
        title: "agent-1",
        tool: "opencode",
        status: "working",
        newLines: "compiling...\ndone!",
      }],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Changes detected in 1 session(s):"));
    assert.ok(result.includes("compiling..."));
    assert.ok(result.includes("done!"));
  });

  it("truncates long change output to last 50 lines", () => {
    const longOutput = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      changes: [{
        sessionId: "abc12345",
        title: "agent-1",
        tool: "opencode",
        status: "working",
        newLines: longOutput,
      }],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("[80 lines, showing last 50]"));
    assert.ok(result.includes("line 79"));
    assert.ok(!result.includes("line 0\n"));
  });

  it("includes operator message with priority note", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "a")],
      userMessage: "focus on the auth bug",
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("OPERATOR MESSAGE"));
    assert.ok(result.includes("focus on the auth bug"));
    assert.ok(result.includes("takes priority"));
  });

  it("includes IDLE policy alert when session exceeds threshold", () => {
    const obs = makeObs({
      timestamp: 1700000200000, // 200s after lastOutputChangeAt
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000, // 200s idle
          consecutiveErrorPolls: 0,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Policy alerts:"));
    assert.ok(result.includes("IDLE: session abc12345"));
    assert.ok(result.includes("200s"));
    assert.ok(result.includes("threshold: 120s"));
  });

  it("includes ERROR policy alert when error count exceeds threshold", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 5,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("ERROR: session abc12345"));
    assert.ok(result.includes("5 consecutive polls"));
  });

  it("includes PERMISSION policy alert", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 0,
          hasPermissionPrompt: true,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("PERMISSION: session abc12345"));
    assert.ok(result.includes("Auto-answer policy is enabled"));
  });

  it("omits policy alerts when below thresholds", () => {
    const obs = makeObs({
      timestamp: 1700000050000, // 50s after lastOutputChangeAt (below 120s)
      sessions: [makeSnap("abc12345", "agent-1")],
      policyContext: {
        policies: { maxIdleBeforeNudgeMs: 120000, maxErrorsBeforeRestart: 3, autoAnswerPermissions: true },
        sessionStates: [{
          sessionId: "abc12345",
          lastOutputChangeAt: 1700000000000,
          consecutiveErrorPolls: 1,
          hasPermissionPrompt: false,
        }],
      },
    });
    const result = formatObservation(obs);
    assert.ok(!result.includes("Policy alerts:"));
  });

  it("omits policy alerts when no policyContext", () => {
    const obs = makeObs({ sessions: [makeSnap("abc12345", "a")] });
    const result = formatObservation(obs);
    assert.ok(!result.includes("Policy alerts:"));
  });
});

describe("detectPermissionPrompt", () => {
  it("detects y/n prompts", () => {
    assert.equal(detectPermissionPrompt("Do something? (y/n)"), true);
  });

  it("detects yes/no prompts", () => {
    assert.equal(detectPermissionPrompt("Continue? (yes/no)"), true);
  });

  it("detects allow/deny prompts", () => {
    assert.equal(detectPermissionPrompt("Allow access to /home?\n"), true);
  });

  it("detects press enter to continue", () => {
    assert.equal(detectPermissionPrompt("Press enter to continue"), true);
  });

  it("detects approve/reject", () => {
    assert.equal(detectPermissionPrompt("Approve this change?\n"), true);
  });

  it("returns false for normal output", () => {
    assert.equal(detectPermissionPrompt("compiling...\nBuild succeeded\n"), false);
  });

  it("only checks last 10 lines", () => {
    // permission prompt buried above 10 lines of other output
    const lines = ["Allow access? (y/n)", ...Array.from({ length: 15 }, (_, i) => `output ${i}`)];
    assert.equal(detectPermissionPrompt(lines.join("\n")), false);
  });

  it("detects prompt in last 10 lines", () => {
    const lines = [...Array.from({ length: 5 }, (_, i) => `output ${i}`), "Do you want to continue?"];
    assert.equal(detectPermissionPrompt(lines.join("\n")), true);
  });

  it("detects opencode TUI 'Permission required'", () => {
    const screen = [
      "┃  △ Permission required",
      "┃    → Edit hello.txt",
      "┃",
      "┃   Allow once   Allow always   Reject",
    ].join("\n");
    assert.equal(detectPermissionPrompt(screen), true);
  });

  it("detects opencode TUI 'Allow once' action row", () => {
    assert.equal(detectPermissionPrompt("  Allow once   Allow always   Reject"), true);
  });
});

describe("buildSystemPrompt", () => {
  it("returns base prompt when no global context", () => {
    const result = buildSystemPrompt();
    assert.ok(result.includes("You are a supervisor"));
    assert.ok(!result.includes("GLOBAL PROJECT CONTEXT"));
  });

  it("returns base prompt for undefined context", () => {
    const result = buildSystemPrompt(undefined);
    assert.ok(result.includes("You are a supervisor"));
  });

  it("appends global context to base prompt", () => {
    const result = buildSystemPrompt("\n\n--- GLOBAL PROJECT CONTEXT ---\n# My project rules");
    assert.ok(result.includes("You are a supervisor"));
    assert.ok(result.includes("GLOBAL PROJECT CONTEXT"));
    assert.ok(result.includes("# My project rules"));
  });
});

describe("formatObservation with project context", () => {
  it("includes per-session project context", () => {
    const obs = makeObs({
      sessions: [{
        ...makeSnap("abc12345", "agent-1"),
        projectContext: "# AGENTS.md\nShip ship ship.",
      }],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Project context for sessions:"));
    assert.ok(result.includes("agent-1"));
    assert.ok(result.includes("Ship ship ship."));
  });

  it("includes session path in session table", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1", "opencode", "working")],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("path=/tmp"));
  });

  it("omits project context section when no sessions have context", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
    });
    const result = formatObservation(obs);
    assert.ok(!result.includes("Project context for sessions:"));
  });

  it("only shows context for sessions that have it", () => {
    const obs = makeObs({
      sessions: [
        makeSnap("abc12345", "agent-1"),
        { ...makeSnap("def67890", "agent-2"), projectContext: "# Context for agent-2" },
      ],
    });
    const result = formatObservation(obs);
    assert.ok(result.includes("Project context for sessions:"));
    assert.ok(result.includes("agent-2"));
    assert.ok(result.includes("# Context for agent-2"));
    // agent-1 shouldn't appear in context section
    assert.ok(!result.includes("agent-1 [abc12345] project context"));
  });

  it("truncates project context when total exceeds budget", () => {
    // create sessions with large context — 60KB each, budget is 50KB
    const bigContext = "x".repeat(60_000);
    const obs = makeObs({
      sessions: [
        { ...makeSnap("abc12345", "agent-1"), projectContext: bigContext },
        { ...makeSnap("def67890", "agent-2"), projectContext: "# Small context" },
      ],
    });
    const result = formatObservation(obs);
    // first session's context should be truncated
    assert.ok(result.includes("truncated"), "should indicate truncation");
    // second session's project context should not appear (no budget left)
    // (note: agent-2 still appears in the session summary table, just not in context)
    assert.ok(!result.includes("# Small context"), "second session context should be omitted");
  });

  it("prioritizes changed sessions for context budget", () => {
    const obs = makeObs({
      sessions: [
        { ...makeSnap("abc12345", "unchanged-agent"), projectContext: "# Unchanged context" },
        { ...makeSnap("def67890", "changed-agent"), projectContext: "# Changed context" },
      ],
      changes: [{ sessionId: "def67890", title: "changed-agent", tool: "opencode", status: "working", newLines: "new output" }],
    });
    const result = formatObservation(obs);
    // changed session should appear before unchanged in context section
    const changedIdx = result.indexOf("changed-agent");
    const unchangedIdx = result.indexOf("unchanged-agent");
    // both should appear, but in the context section, changed should be first
    const contextSection = result.slice(result.indexOf("Project context"));
    const changedCtxIdx = contextSection.indexOf("changed-agent");
    const unchangedCtxIdx = contextSection.indexOf("unchanged-agent");
    assert.ok(changedCtxIdx < unchangedCtxIdx, "changed session context should appear first");
  });
});

describe("sliceToByteLimit", () => {
  it("returns string unchanged when within byte limit", () => {
    assert.equal(sliceToByteLimit("hello", 100), "hello");
  });

  it("truncates ASCII string to byte limit", () => {
    const result = sliceToByteLimit("abcdefghij", 5);
    assert.equal(result, "abcde");
    assert.ok(Buffer.byteLength(result, "utf-8") <= 5);
  });

  it("handles multi-byte UTF-8 characters (emoji)", () => {
    // Each emoji is 4 bytes in UTF-8
    const emoji = "🚀🚀🚀🚀🚀"; // 20 bytes
    const result = sliceToByteLimit(emoji, 8);
    assert.ok(Buffer.byteLength(result, "utf-8") <= 8);
    assert.equal(result, "🚀🚀"); // exactly 8 bytes = 2 emoji
  });

  it("handles multi-byte UTF-8 characters (CJK)", () => {
    // Each CJK char is 3 bytes in UTF-8
    const cjk = "你好世界测试"; // 18 bytes
    const result = sliceToByteLimit(cjk, 9);
    assert.ok(Buffer.byteLength(result, "utf-8") <= 9);
    assert.equal(result, "你好世"); // exactly 9 bytes = 3 chars
  });

  it("does not split multi-byte characters", () => {
    const emoji = "🚀abc"; // 4 + 3 = 7 bytes
    const result = sliceToByteLimit(emoji, 5);
    // can't fit emoji (4 bytes) + 2 chars, should keep emoji + 'a'
    assert.ok(Buffer.byteLength(result, "utf-8") <= 5);
    assert.equal(result, "🚀a");
  });

  it("returns empty string when limit is 0", () => {
    assert.equal(sliceToByteLimit("hello", 0), "");
  });

  it("handles empty string", () => {
    assert.equal(sliceToByteLimit("", 100), "");
  });

  it("handles mixed ASCII and multi-byte", () => {
    const mixed = "abc🚀def"; // 3 + 4 + 3 = 10 bytes
    const result = sliceToByteLimit(mixed, 7);
    assert.ok(Buffer.byteLength(result, "utf-8") <= 7);
    assert.equal(result, "abc🚀"); // 3 + 4 = 7 bytes exactly
  });
});

describe("formatObservation total prompt budget (MAX_PROMPT_BYTES)", () => {
  it("truncates assembled prompt when it exceeds 100KB", () => {
    // use changes (not context) to exceed 100KB, since per-session context budget is 50KB
    // each change with ~30KB of newLines * 4 = ~120KB of change data alone
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSnap(`id${i}pad1234567890`, `agent-${i}`),
    );
    const changes: SessionChange[] = Array.from({ length: 4 }, (_, i) => ({
      sessionId: `id${i}pad1234567890`,
      title: `agent-${i}`,
      tool: "opencode",
      status: "working" as const,
      newLines: "x".repeat(30_000),
    }));
    const obs = makeObs({ sessions, changes });
    const result = formatObservation(obs);
    const totalBytes = Buffer.byteLength(result, "utf-8");
    // should be capped near 100KB (MAX_PROMPT_BYTES)
    assert.ok(totalBytes <= 100_200, `expected <= ~100KB, got ${totalBytes}`);
    assert.ok(result.includes("[...prompt truncated to fit context budget]"));
  });

  it("does not truncate prompt under 100KB", () => {
    const obs = makeObs({
      sessions: [makeSnap("abc12345", "agent-1")],
      changes: [{
        sessionId: "abc12345",
        title: "agent-1",
        tool: "opencode",
        status: "working",
        newLines: "small output",
      } satisfies SessionChange],
    });
    const result = formatObservation(obs);
    assert.ok(!result.includes("[...prompt truncated to fit context budget]"));
  });

  it("preserves beginning of prompt (session table) when truncating", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      makeSnap(`id${i}pad1234567890`, `agent-${i}`),
    );
    const changes: SessionChange[] = Array.from({ length: 4 }, (_, i) => ({
      sessionId: `id${i}pad1234567890`,
      title: `agent-${i}`,
      tool: "opencode",
      status: "working" as const,
      newLines: "y".repeat(30_000),
    }));
    const obs = makeObs({ sessions, changes });
    const result = formatObservation(obs);
    // session table is at the start of the prompt — should survive truncation
    assert.ok(result.includes("Sessions:"));
    assert.ok(result.includes("Active sessions: 4"));
  });

  it("preserves operator message when truncating (truncates context, not changes)", () => {
    // build a prompt where project context is large but operator message + changes exist
    const bigContext = "x".repeat(80_000);
    const sessions = [
      { ...makeSnap("abc12345678901", "agent-1"), projectContext: bigContext },
    ];
    const changes: SessionChange[] = [{
      sessionId: "abc12345678901",
      title: "agent-1",
      tool: "opencode",
      status: "working",
      newLines: "IMPORTANT: test failure detected",
    }];
    const obs = makeObs({
      sessions,
      changes,
      userMessage: "fix the tests please",
    });
    const result = formatObservation(obs);
    const totalBytes = Buffer.byteLength(result, "utf-8");
    assert.ok(totalBytes <= 100_200, `expected <= ~100KB, got ${totalBytes}`);
    // operator message and changes should survive truncation
    assert.ok(result.includes("fix the tests please"), "operator message was truncated");
    assert.ok(result.includes("IMPORTANT: test failure detected"), "changes were truncated");
    // project context should be trimmed
    assert.ok(result.includes("truncated") || result.includes("omitted"), "should indicate context was trimmed");
  });

  it("respects byte budget with multi-byte context (emoji/CJK)", () => {
    // each emoji is 4 bytes but 1 .length char — old .slice() would overshoot
    const emojiContext = "🚀".repeat(15_000); // 60,000 bytes but only 15,000 chars
    const sessions = [
      { ...makeSnap("abc12345678901", "agent-1"), projectContext: emojiContext },
    ];
    const obs = makeObs({ sessions });
    const result = formatObservation(obs);
    const totalBytes = Buffer.byteLength(result, "utf-8");
    assert.ok(totalBytes <= 100_200, `expected <= ~100KB, got ${totalBytes}`);
  });

  it("preserves changes when only project context causes overflow", () => {
    const bigContext = "z".repeat(90_000);
    const sessions = [
      { ...makeSnap("def12345678901", "agent-2"), projectContext: bigContext },
    ];
    const changes: SessionChange[] = [{
      sessionId: "def12345678901",
      title: "agent-2",
      tool: "opencode",
      status: "working",
      newLines: "UNIQUE_CHANGE_MARKER_12345",
    }];
    const obs = makeObs({ sessions, changes });
    const result = formatObservation(obs);
    // changes should survive even when context is huge
    assert.ok(result.includes("UNIQUE_CHANGE_MARKER_12345"), "changes were lost during truncation");
  });
});

// ── formatTaskContext ───────────────────────────────────────────────────────

function makeTask(overrides?: Partial<TaskState>): TaskState {
  return {
    repo: "github/adventure",
    sessionTitle: "adventure",
    sessionMode: "auto",
    tool: "opencode",
    goal: "build the game",
    status: "active",
    progress: [],
    ...overrides,
  };
}

describe("formatTaskContext", () => {
  it("returns empty string for no tasks", () => {
    assert.equal(formatTaskContext([]), "");
  });

  it("includes task header line", () => {
    const result = formatTaskContext([makeTask()]);
    assert.ok(result.includes("Active tasks"));
  });

  it("includes session title and repo", () => {
    const result = formatTaskContext([makeTask()]);
    assert.ok(result.includes('"adventure"'));
    assert.ok(result.includes("github/adventure"));
  });

  it("includes goal as bulleted list", () => {
    const result = formatTaskContext([makeTask({ goal: "implement auth" })]);
    assert.ok(result.includes("Goal:"));
    assert.ok(result.includes("- implement auth"));
    // must not show flat single-line "Goal: implement auth"
    assert.ok(!result.includes("Goal: implement auth"));
  });

  it("shows ACTIVE status tag for active tasks", () => {
    const result = formatTaskContext([makeTask({ status: "active", lastProgressAt: Date.now() })]);
    assert.ok(result.includes("[ACTIVE]"));
    assert.ok(!result.includes("STUCK"), "recent progress should not be flagged as stuck");
  });

  it("shows COMPLETED status tag", () => {
    const result = formatTaskContext([makeTask({ status: "completed" })]);
    assert.ok(result.includes("[COMPLETED]"));
  });

  it("shows PENDING status tag", () => {
    const result = formatTaskContext([makeTask({ status: "pending" })]);
    assert.ok(result.includes("[PENDING]"));
  });

  it("shows recent progress entries (last 3)", () => {
    const now = Date.now();
    const result = formatTaskContext([makeTask({
      progress: [
        { at: now - 300_000, summary: "old entry" },
        { at: now - 120_000, summary: "second entry" },
        { at: now - 60_000, summary: "recent entry" },
        { at: now - 30_000, summary: "latest entry" },
      ],
    })]);
    // should show last 3, not the first one
    assert.ok(!result.includes("old entry"));
    assert.ok(result.includes("second entry"));
    assert.ok(result.includes("recent entry"));
    assert.ok(result.includes("latest entry"));
  });

  it("formats time ago correctly", () => {
    const now = Date.now();
    const result = formatTaskContext([makeTask({
      progress: [{ at: now - 10_000, summary: "just happened" }],
    })]);
    assert.ok(result.includes("just now") || result.includes("0m ago"));
  });

  it("handles multiple tasks", () => {
    const result = formatTaskContext([
      makeTask({ sessionTitle: "adventure", repo: "github/adventure" }),
      makeTask({ sessionTitle: "chv", repo: "github/cloud-hypervisor" }),
    ]);
    assert.ok(result.includes('"adventure"'));
    assert.ok(result.includes('"chv"'));
  });

  it("includes instruction lines about report_progress and complete_task", () => {
    const result = formatTaskContext([makeTask()]);
    assert.ok(result.includes("report_progress"));
    assert.ok(result.includes("complete_task"));
  });

  it("flags stuck tasks with no recent progress", () => {
    const result = formatTaskContext([makeTask({
      status: "active",
      lastProgressAt: Date.now() - (60 * 60 * 1000), // 1 hour ago
    })], 30 * 60 * 1000);
    assert.ok(result.includes("STUCK"), "should contain STUCK warning");
    assert.ok(result.includes("adventure"), "should name the stuck session");
  });

  it("does not flag active tasks with recent progress as stuck", () => {
    const result = formatTaskContext([makeTask({
      status: "active",
      lastProgressAt: Date.now() - (5 * 60 * 1000), // 5 min ago
    })], 30 * 60 * 1000);
    assert.ok(!result.includes("STUCK"), "should not flag recent progress as stuck");
  });

  it("does not flag completed tasks as stuck", () => {
    const result = formatTaskContext([makeTask({
      status: "completed",
      lastProgressAt: Date.now() - (120 * 60 * 1000),
    })], 30 * 60 * 1000);
    assert.ok(!result.includes("STUCK"), "completed tasks should never be stuck");
  });

  it("shows no-progress-yet for active tasks without any progress", () => {
    const result = formatTaskContext([makeTask({ status: "active", progress: [] })]);
    assert.ok(result.includes("No progress recorded"), "should note absence of progress");
  });

  it("includes stuck-task guidance for the reasoner", () => {
    const result = formatTaskContext([makeTask({
      status: "active",
      lastProgressAt: Date.now() - (60 * 60 * 1000),
    })], 30 * 60 * 1000);
    assert.ok(result.includes("send_input"), "should suggest sending input to stuck sessions");
  });

  it("shows dependency info for tasks with dependsOn", () => {
    const result = formatTaskContext([makeTask({ dependsOn: ["cloud-hypervisor", "code-music"] })]);
    assert.ok(result.includes("depends on: cloud-hypervisor, code-music"));
  });

  it("shows BLOCKED tag for pending tasks with unmet dependencies", () => {
    const result = formatTaskContext([makeTask({ status: "pending", dependsOn: ["upstream"] })]);
    assert.ok(result.includes("BLOCKED"), "pending task with deps should show BLOCKED");
  });

  it("does not show BLOCKED for active tasks", () => {
    const result = formatTaskContext([makeTask({ status: "active", dependsOn: ["upstream"], lastProgressAt: Date.now() })]);
    assert.ok(!result.includes("BLOCKED"), "active task should not show BLOCKED");
  });
});
