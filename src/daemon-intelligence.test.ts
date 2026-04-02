// daemon-intelligence.test.ts — integration tests for v0.197 intelligence wiring:
// session summarizer, conflict detector, goal completion, and cost budget
// enforcement as they flow through the daemon observation pipeline.

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SessionSummarizer } from "./session-summarizer.js";
import { ConflictDetector } from "./conflict-detector.js";
import { detectCompletionSignals, shouldAutoComplete } from "./goal-detector.js";
import { findOverBudgetSessions, computeBudgetStatus, parseCostUsd } from "./cost-budget.js";
import type { TaskState } from "./types.js";
import type { CostBudgetConfig } from "./cost-budget.js";

// ── Simulated daemon observation flow ───────────────────────────────────────
// These tests simulate what happens when observation.changes arrive in the
// daemonTick loop and get processed by each intelligence module.

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "github/test-project",
    sessionTitle: "test-project",
    sessionMode: "auto",
    tool: "opencode",
    goal: "implement the feature",
    status: "active",
    progress: [],
    ...overrides,
  };
}

describe("daemon intelligence: session summarizer pipeline", () => {
  it("updates summaries when new output arrives from multiple sessions", () => {
    const summarizer = new SessionSummarizer();

    // simulate two sessions with different activity
    summarizer.update("adventure", ["Edit src/auth.ts", "Write src/login.tsx"]);
    summarizer.update("code-music", ["ℹ tests 2708", "ℹ pass 2708", "ℹ fail 0"]);

    const adventureSummary = summarizer.get("adventure");
    const musicSummary = summarizer.get("code-music");

    assert.ok(adventureSummary);
    assert.equal(adventureSummary.activity, "coding");
    assert.ok(musicSummary);
    assert.equal(musicSummary.activity, "testing");
  });

  it("retains last meaningful summary across empty polls", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("session-a", ["[main abc1234] fix: the bug"]);
    assert.equal(summarizer.get("session-a")?.activity, "committing");

    // next poll: no new output
    summarizer.update("session-a", []);
    assert.equal(summarizer.get("session-a")?.activity, "committing"); // retained
  });

  it("upgrades summary when higher-priority activity is detected", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("session-a", ["Edit src/foo.ts"]);
    assert.equal(summarizer.get("session-a")?.activity, "coding");

    // error appears — should override coding
    summarizer.update("session-a", ["error: module not found"]);
    assert.equal(summarizer.get("session-a")?.activity, "error");
  });

  it("getAll returns all tracked sessions", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("a", ["npm test"]);
    summarizer.update("b", ["Edit x.ts"]);
    summarizer.update("c", ["npm install express"]);
    assert.equal(summarizer.getAll().size, 3);
  });
});

describe("daemon intelligence: conflict detector pipeline", () => {
  it("detects conflicts when two sessions edit the same file in sequence", () => {
    const detector = new ConflictDetector();
    const now = Date.now();

    // session A edits src/shared.ts
    detector.recordEdits("adventure", "id-1", ["Edit src/shared.ts"], now);
    assert.equal(detector.detectConflicts(now).length, 0);

    // session B also edits src/shared.ts
    detector.recordEdits("code-music", "id-2", ["Edit src/shared.ts"], now + 1000);
    const conflicts = detector.detectConflicts(now + 1000);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filePath, "src/shared.ts");
    assert.equal(conflicts[0].sessions.length, 2);
  });

  it("does not alert when edits are to different files", () => {
    const detector = new ConflictDetector();
    detector.recordEdits("a", "1", ["Edit src/auth.ts"]);
    detector.recordEdits("b", "2", ["Edit src/music.ts"]);
    assert.equal(detector.detectConflicts().length, 0);
  });

  it("prunes old edits beyond window", () => {
    const detector = new ConflictDetector(5 * 60_000); // 5 min window
    const now = Date.now();

    // old edit (10 min ago)
    detector.recordEdits("a", "1", ["Edit src/foo.ts"], now - 10 * 60_000);
    // recent edit (now)
    detector.recordEdits("b", "2", ["Edit src/foo.ts"], now);

    // old edit is pruned — no conflict
    assert.equal(detector.detectConflicts(now).length, 0);
  });
});

describe("daemon intelligence: goal completion pipeline", () => {
  it("detects completion from combined push + tests passing + done signals", () => {
    const task = makeTask({
      progress: [
        { at: Date.now() - 10 * 60_000, summary: "started" },
        { at: Date.now() - 5 * 60_000, summary: "implemented" },
      ],
      lastProgressAt: Date.now() - 5 * 60_000,
    });
    const lines = [
      "[main abc1234] feat: add new feature",
      "   abc1234..def5678  main -> main",
      "ℹ tests 150",
      "ℹ pass 150",
      "ℹ fail 0",
      "I've completed all the requested changes",
    ];
    const signals = detectCompletionSignals(lines, task);
    assert.ok(signals.length >= 3); // push + tests + explicit done

    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, true);
    assert.ok(result.confidence > 0.7);
  });

  it("does not auto-complete from weak signals alone", () => {
    const task = makeTask();
    const lines = ["Edit src/foo.ts"];
    const signals = detectCompletionSignals(lines, task);
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, false);
  });

  it("does not auto-complete non-active tasks", () => {
    const task = makeTask({ status: "paused" });
    const lines = ["all tasks done"];
    const signals = detectCompletionSignals(lines, task);
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, false);
  });

  it("detects completion from explicit done message + todos", () => {
    const task = makeTask();
    const lines = [
      "[✓] implement auth",
      "[✓] add tests",
      "[✓] update docs",
      "I've completed all the requested changes",
    ];
    const signals = detectCompletionSignals(lines, task);
    assert.ok(signals.some((s) => s.type === "explicit_done"));
    assert.ok(signals.some((s) => s.type === "all_todos_done"));

    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, true);
  });
});

describe("daemon intelligence: cost budget enforcement pipeline", () => {
  it("detects over-budget sessions with global budget", () => {
    const sessions = [
      { title: "expensive", costStr: "$15.00", status: "active" },
      { title: "cheap", costStr: "$3.00", status: "active" },
    ];
    const config: CostBudgetConfig = { globalBudgetUsd: 10 };
    const violations = findOverBudgetSessions(sessions, config);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].sessionTitle, "expensive");
    assert.equal(violations[0].overBudget, true);
  });

  it("per-session budget overrides global", () => {
    const sessions = [
      { title: "limited", costStr: "$6.00", status: "active" },
      { title: "generous", costStr: "$6.00", status: "active" },
    ];
    const config: CostBudgetConfig = {
      globalBudgetUsd: 10,
      sessionBudgets: { limited: 5 },
    };
    const violations = findOverBudgetSessions(sessions, config);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].sessionTitle, "limited");
  });

  it("skips non-active sessions for enforcement", () => {
    const sessions = [
      { title: "stopped", costStr: "$100.00", status: "stopped" },
    ];
    const violations = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(violations.length, 0);
  });

  it("handles missing cost data gracefully", () => {
    const sessions = [
      { title: "no-data", costStr: undefined, status: "active" },
    ];
    const violations = findOverBudgetSessions(sessions, { globalBudgetUsd: 10 });
    assert.equal(violations.length, 0);
  });

  it("computes correct warning levels", () => {
    const ok = computeBudgetStatus("test", "$5.00", { globalBudgetUsd: 10 });
    assert.ok(ok);
    assert.equal(ok.warningLevel, "ok");

    const warning = computeBudgetStatus("test", "$7.60", { globalBudgetUsd: 10 });
    assert.ok(warning);
    assert.equal(warning.warningLevel, "warning");

    const critical = computeBudgetStatus("test", "$9.10", { globalBudgetUsd: 10 });
    assert.ok(critical);
    assert.equal(critical.warningLevel, "critical");

    const exceeded = computeBudgetStatus("test", "$11.00", { globalBudgetUsd: 10 });
    assert.ok(exceeded);
    assert.equal(exceeded.warningLevel, "exceeded");
  });

  it("parses cost strings from pane output", () => {
    assert.equal(parseCostUsd("$3.42 spent"), 3.42);
    assert.equal(parseCostUsd("$0.00"), 0);
    assert.equal(parseCostUsd(undefined), null);
    assert.equal(parseCostUsd("no cost"), null);
  });
});

describe("daemon intelligence: end-to-end multi-module scenario", () => {
  it("handles a full observation cycle with all modules active", () => {
    const summarizer = new SessionSummarizer();
    const detector = new ConflictDetector();

    // session A: coding
    const aLines = ["Edit src/shared.ts", "Edit src/auth.ts"];
    summarizer.update("adventure", aLines);
    detector.recordEdits("adventure", "id-a", aLines);

    // session B: also editing shared.ts
    const bLines = ["Edit src/shared.ts", "npm test"];
    summarizer.update("code-music", bLines);
    detector.recordEdits("code-music", "id-b", bLines);

    // verify summaries
    assert.equal(summarizer.get("adventure")?.activity, "coding");
    assert.equal(summarizer.get("code-music")?.activity, "testing"); // higher priority

    // verify conflict
    const conflicts = detector.detectConflicts();
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].filePath, "src/shared.ts");

    // goal detection on session B
    const task = makeTask({ sessionTitle: "code-music" });
    const completionLines = [
      "[main abc1234] feat: done",
      "   abc1234..def5678  main -> main",
      "ℹ fail 0",
    ];
    const signals = detectCompletionSignals(completionLines, task);
    assert.ok(signals.length >= 2);
  });
});
