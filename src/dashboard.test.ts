import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { Observation, SessionSnapshot, AoeSession, AoaoeConfig } from "./types.js";
import type { ActionLogEntry } from "./executor.js";

// dashboard.ts calls readState() + console.error(); we test the formatting
// logic by capturing stderr output. The function is pure aside from the
// readState + console.error side effects.

// helper factories
function makeSession(overrides?: Partial<AoeSession>): AoeSession {
  return {
    id: "abc12345-dead-beef-cafe-000000000001",
    title: "test-agent",
    path: "/tmp/test",
    tool: "opencode",
    status: "working",
    tmux_name: "aoe_test-agent_abc12345",
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    session: overrides?.session ?? makeSession(),
    output: "working on stuff...\n",
    outputHash: "aabbccdd",
    capturedAt: Date.now(),
    ...overrides,
  };
}

function makeObservation(snapshots: SessionSnapshot[]): Observation {
  return {
    timestamp: Date.now(),
    sessions: snapshots,
    changes: [],
  };
}

function defaultConfig(overrides?: Partial<AoaoeConfig>): AoaoeConfig {
  return {
    reasoner: "opencode",
    pollIntervalMs: 10_000,
    opencode: { port: 4097 },
    claudeCode: { yolo: true, resume: true },
    aoe: { profile: "default" },
    policies: {
      maxIdleBeforeNudgeMs: 120_000,
      maxErrorsBeforeRestart: 3,
      autoAnswerPermissions: true,
    },
    contextFiles: [],
    sessionDirs: {},
    captureLinesCount: 100,
    verbose: false,
    dryRun: false,
    ...overrides,
  };
}

function makeActionEntry(overrides?: Partial<ActionLogEntry>): ActionLogEntry {
  return {
    timestamp: Date.now(),
    action: { action: "send_input", session: "abc", text: "do stuff" },
    success: true,
    detail: "sent input to test-agent",
    ...overrides,
  } as ActionLogEntry;
}

describe("printDashboard", () => {
  let captured: string[];
  const origError = console.error;

  beforeEach(() => {
    captured = [];
    console.error = (...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.error = origError;
  });

  it("prints header with poll count and time", async () => {
    // dynamic import to allow mocking of readState
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    printDashboard(obs, [], 42, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("poll #42"), "should contain poll count");
    assert.ok(output.includes("aoaoe dashboard"), "should contain header");
  });

  it("shows 'no active sessions' when empty", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    printDashboard(obs, [], 1, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("no active sessions"), "should show empty state");
  });

  it("renders session rows with icon, tool, title, id", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const snap = makeSnapshot({
      session: makeSession({ status: "working", title: "my-project", id: "deadbeef12345678" }),
    });
    const obs = makeObservation([snap]);
    printDashboard(obs, [], 5, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("~"), "working status should show ~ icon");
    assert.ok(output.includes("opencode"), "should show tool");
    assert.ok(output.includes("my-project"), "should show title");
    assert.ok(output.includes("deadbeef"), "should show first 8 chars of id");
  });

  it("shows DRY RUN banner when dryRun is true", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    printDashboard(obs, [], 1, defaultConfig({ dryRun: true }));
    const output = captured.join("\n");
    assert.ok(output.includes("DRY RUN"), "should show dry run banner");
  });

  it("does not show DRY RUN banner when dryRun is false", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    printDashboard(obs, [], 1, defaultConfig({ dryRun: false }));
    const output = captured.join("\n");
    assert.ok(!output.includes("DRY RUN"), "should not show dry run banner");
  });

  it("filters wait actions from recent actions", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    const actions: ActionLogEntry[] = [
      makeActionEntry({ action: { action: "wait", reason: "all good" } }),
      makeActionEntry({ action: { action: "send_input", session: "abc", text: "hi" }, detail: "sent to test" }),
    ];
    printDashboard(obs, actions, 1, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("recent actions"), "should show recent actions section");
    assert.ok(output.includes("send_input"), "should show non-wait action");
  });

  it("does not show recent actions section when all are wait", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    const actions: ActionLogEntry[] = [
      makeActionEntry({ action: { action: "wait", reason: "idle" } }),
    ];
    printDashboard(obs, actions, 1, defaultConfig());
    const output = captured.join("\n");
    assert.ok(!output.includes("recent actions"), "should not show recent actions when all are wait");
  });

  it("shows success/failure icons for actions", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    const actions: ActionLogEntry[] = [
      makeActionEntry({ success: true, detail: "ok", action: { action: "start_session", session: "s1" } }),
      makeActionEntry({ success: false, detail: "failed", action: { action: "stop_session", session: "s2" } }),
    ];
    printDashboard(obs, actions, 1, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("+ start_session"), "success should show +");
    assert.ok(output.includes("! stop_session"), "failure should show !");
  });

  it("shows at most 5 recent meaningful actions", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const obs = makeObservation([]);
    const actions: ActionLogEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeActionEntry({
        action: { action: "send_input", session: `s${i}`, text: `msg${i}` },
        detail: `action-${i}`,
      }),
    );
    printDashboard(obs, actions, 1, defaultConfig());
    const output = captured.join("\n");
    // should show actions 5-9 (last 5)
    assert.ok(output.includes("action-9"), "should show last action");
    assert.ok(output.includes("action-5"), "should show 5th from end");
    assert.ok(!output.includes("action-4"), "should NOT show 6th from end");
  });

  it("renders all status icons correctly", async () => {
    const { printDashboard } = await import("./dashboard.js");
    const statuses = ["working", "idle", "waiting", "done", "error", "stopped"];
    const expectedIcons = ["~", ".", "?", "+", "!", "x"];

    for (let i = 0; i < statuses.length; i++) {
      captured = [];
      const snap = makeSnapshot({
        session: makeSession({ status: statuses[i], id: `id${i}`.padEnd(16, "0") }),
      });
      const obs = makeObservation([snap]);
      printDashboard(obs, [], 1, defaultConfig());
      const output = captured.join("\n");
      // look for the icon in the session row (column before the pipe)
      const lines = output.split("\n");
      const sessionLine = lines.find((l) => l.includes(`id${i}`));
      assert.ok(sessionLine, `should have a line for status ${statuses[i]}`);
      assert.ok(
        sessionLine!.includes(expectedIcons[i]),
        `status ${statuses[i]} should have icon ${expectedIcons[i]}, got line: ${sessionLine}`,
      );
    }
  });

  it("uses ? icon for unknown status", async () => {
    const { printDashboard } = await import("./dashboard.js");
    captured = [];
    const snap = makeSnapshot({
      session: makeSession({ status: "banana", id: "unkn1234" + "0".repeat(8) }),
    });
    const obs = makeObservation([snap]);
    printDashboard(obs, [], 1, defaultConfig());
    const output = captured.join("\n");
    const sessionLine = output.split("\n").find((l) => l.includes("unkn1234"));
    assert.ok(sessionLine, "should find the session line");
    // the icon should be ? (default for unknown status)
    assert.ok(sessionLine!.trimStart().startsWith("?"), `unknown status should show ?, got: ${sessionLine}`);
  });

  it("truncates long titles to 20 chars", async () => {
    const { printDashboard } = await import("./dashboard.js");
    captured = [];
    const longTitle = "a-very-long-session-title-that-exceeds-twenty";
    const snap = makeSnapshot({
      session: makeSession({ title: longTitle }),
    });
    const obs = makeObservation([snap]);
    printDashboard(obs, [], 1, defaultConfig());
    const output = captured.join("\n");
    // title is padEnd(20).slice(0,20) so exactly 20 chars
    assert.ok(!output.includes(longTitle), "full long title should not appear");
    assert.ok(output.includes(longTitle.slice(0, 20)), "first 20 chars should appear");
  });

  it("multiple sessions render on separate lines", async () => {
    const { printDashboard } = await import("./dashboard.js");
    captured = [];
    const snaps = [
      makeSnapshot({ session: makeSession({ id: "s1".padEnd(16, "0"), title: "session-one" }) }),
      makeSnapshot({ session: makeSession({ id: "s2".padEnd(16, "0"), title: "session-two" }) }),
    ];
    const obs = makeObservation(snaps);
    printDashboard(obs, [], 1, defaultConfig());
    const output = captured.join("\n");
    assert.ok(output.includes("session-one"), "should show first session");
    assert.ok(output.includes("session-two"), "should show second session");
  });
});

// test the truncate helper used internally by dashboard (we replicate it here)
describe("truncate (logic)", () => {
  function truncate(s: string, max: number): string {
    const line = s.replace(/\n/g, " ").trim();
    return line.length > max ? line.slice(0, max - 3) + "..." : line;
  }

  it("returns short strings unchanged", () => {
    assert.equal(truncate("hello", 30), "hello");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "a".repeat(50);
    const result = truncate(long, 30);
    assert.equal(result.length, 30);
    assert.ok(result.endsWith("..."));
  });

  it("collapses newlines to spaces", () => {
    assert.equal(truncate("line1\nline2\nline3", 30), "line1 line2 line3");
  });

  it("trims whitespace", () => {
    assert.equal(truncate("  hello  ", 30), "hello");
  });

  it("handles empty string", () => {
    assert.equal(truncate("", 30), "");
  });
});
